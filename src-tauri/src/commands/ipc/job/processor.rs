use futures::stream::{self, StreamExt};
use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

use super::state::{begin_spoofer_job, finish_spoofer_job, wait_if_paused};
use super::types::{AssetDetails, SpooferActionRequest};
use crate::commands::ipc::{append_log_entry, logging, redact_log_message};

struct JobContext {
    job_id: String,
    cookie: String,
    fallback_cookies: Option<Vec<String>>,
    api_key: String,
    group_id: Option<String>,
    upload_types: Vec<String>,
    account_id: Option<String>,
    forced_place_ids: Vec<String>,
    safe_place_name: String,
    place_name_raw: String,
    base_downloads_dir: std::path::PathBuf,
    universe_id: Option<String>,
    csrf_token: String,
    downloads_root: String,
    excluded_users: HashSet<String>,
    excluded_groups: HashSet<String>,
    proxy_url: Option<String>,
    batch_urls: HashMap<String, String>,
    batch_metadata: HashMap<String, AssetDetails>,
    enable_archive_recovery: bool,

    // Shared tracking state
    success_count: AtomicUsize,
    skip_count: AtomicUsize,
    fail_count: AtomicUsize,
    interrupted: AtomicBool,

    // Thread-safe caches & outputs
    creator_place_ids_cache: dashmap::DashMap<String, Vec<String>>,
    replacements: dashmap::DashMap<String, serde_json::Value>,
    asset_results: Mutex<Vec<serde_json::Value>>,
    log_file: Mutex<Option<File>>,

    // Concurrency controls
    download_semaphore: Arc<Semaphore>,
    discoveries: Mutex<Vec<(String, String)>>,

    // External handles
    client: reqwest::Client,
    app: AppHandle,
}

impl JobContext {
    fn log(&self, msg: &str, level: &str) {
        let _ = append_log_entry(&self.app, level, "spoofer", msg);
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let formatted =
            format!("[{}] [{}] {}", timestamp, level.to_uppercase(), redact_log_message(msg));

        if let Ok(mut lock) = self.log_file.lock() {
            if let Some(file) = lock.as_mut() {
                let _ = writeln!(file, "{formatted}");
            }
        }

        let _ = self.app.emit(
            "spoofer-log",
            serde_json::json!({
                "message": msg,
                "level": level
            }),
        );

        match level {
            "error" => log::error!("[Spoofer] {}", redact_log_message(msg)),
            "warn" => log::warn!("[Spoofer] {}", redact_log_message(msg)),
            _ => log::info!("[Spoofer] {}", redact_log_message(msg)),
        }
    }

    fn record_result(&self, result: serde_json::Value) {
        if let Ok(mut results) = self.asset_results.lock() {
            results.push(result);
        }
    }
}

fn valid_place_ids(raw: Option<&str>) -> Vec<String> {
    let Some(raw_str) = raw else { return vec![] };
    let mut ids = Vec::new();
    for candidate in raw_str.split(|c: char| c == ',' || c.is_whitespace()).map(str::trim) {
        if !candidate.is_empty() && candidate.chars().all(|c| c.is_ascii_digit()) {
            let cand_str = candidate.to_string();
            if !ids.contains(&cand_str) {
                ids.push(cand_str);
            }
        }
    }
    ids
}

fn first_valid_place_id(raw: Option<&str>) -> Option<String> {
    valid_place_ids(raw).into_iter().next()
}

fn numeric_value_to_string(value: &serde_json::Value) -> Option<String> {
    value
        .as_u64()
        .map(|number| number.to_string())
        .or_else(|| value.as_str().map(std::string::ToString::to_string))
        .filter(|id| !id.is_empty() && id.chars().all(|character| character.is_ascii_digit()))
}

fn selected_account_id(account: &serde_json::Value) -> Option<String> {
    account.get("id").and_then(numeric_value_to_string)
}

async fn fetch_asset_details(
    asset_id: &str,
    cookie: &str,
    client: &reqwest::Client,
) -> Option<AssetDetails> {
    let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
    let req = client.get(&url).header("Cookie", format!(".ROBLOSECURITY={cookie}"));
    let res = req.send().await.ok()?;
    let json: serde_json::Value = res.json().await.ok()?;

    let name = json.get("Name").and_then(|v| v.as_str()).unwrap_or("Spoofed Asset").to_string();
    let description = json
        .get("Description")
        .and_then(|v| v.as_str())
        .unwrap_or("Uploaded by ISpooferMotion.")
        .to_string();

    Some(AssetDetails { name, description })
}

/// Returned alongside [`AssetDetails`] so discovery can skip the per-asset
/// `/v2/assets/{id}/details` fetch. `creator_type` is `"User"` or `"Group"`;
/// `creator_id` is the corresponding numeric id.
type BatchCreatorInfo = HashMap<String, (String, u64)>;

async fn batch_fetch_asset_details(
    asset_ids: &[String],
    cookie: &str,
    csrf_token: &str,
    client: &reqwest::Client,
) -> (HashMap<String, AssetDetails>, BatchCreatorInfo) {
    let mut details = HashMap::new();
    let mut creators: BatchCreatorInfo = HashMap::new();
    let chunks = asset_ids.chunks(120);

    for chunk in chunks {
        let items: Vec<serde_json::Value> = chunk
            .iter()
            .filter_map(|id| {
                if let Ok(id_num) = id.parse::<u64>() {
                    Some(serde_json::json!({
                        "itemType": "Asset",
                        "id": id_num
                    }))
                } else {
                    None
                }
            })
            .collect();

        if items.is_empty() {
            continue;
        }

        let payload = serde_json::json!({ "items": items });
        let req = client
            .post("https://catalog.roblox.com/v1/catalog/items/details")
            .header("Cookie", format!(".ROBLOSECURITY={cookie}"))
            .header("X-CSRF-Token", csrf_token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&payload);

        if let Ok(res) = req.send().await {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
                    for item in data {
                        if let Some(id) = item.get("id").and_then(serde_json::Value::as_u64) {
                            let name = item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Spoofed Asset")
                                .to_string();
                            let description = item
                                .get("description")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Uploaded by ISpooferMotion.")
                                .to_string();
                            details.insert(id.to_string(), AssetDetails { name, description });

                            // Same response also carries the creator info we
                            // would otherwise refetch per-asset inside the
                            // discovery pass. Capture it now so the first-per-
                            // creator discovery skips that extra HTTP call.
                            let creator_type = item
                                .get("creatorType")
                                .and_then(|v| v.as_str())
                                .map(str::to_string);
                            let creator_id =
                                item.get("creatorTargetId").and_then(serde_json::Value::as_u64);
                            if let (Some(t), Some(cid)) = (creator_type, creator_id) {
                                if cid != 0 && !t.is_empty() {
                                    creators.insert(id.to_string(), (t, cid));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    (details, creators)
}

#[allow(clippy::too_many_lines)]
pub async fn process_spoofer_action(
    app: AppHandle,
    data: SpooferActionRequest,
) -> crate::error::Result<()> {
    let start_time = chrono::Utc::now();
    let job_id = format!("{}", start_time.timestamp_millis());
    let app_data_dir = app.path().app_data_dir()?;
    let logs_dir = app_data_dir.join("ispoofer_logs");
    std::fs::create_dir_all(&logs_dir)?;
    logging::cleanup_logs_dir(&logs_dir);

    let base_downloads_dir =
        if let Some(dp) = data.download_path.as_deref().filter(|s| !s.trim().is_empty()) {
            std::path::PathBuf::from(dp)
        } else {
            app_data_dir.join("downloads")
        };
    tokio::fs::create_dir_all(&base_downloads_dir).await?;

    let place_name_raw = data.place_name.clone().unwrap_or_else(|| "UnknownPlace".to_string());
    let safe_place_name =
        place_name_raw.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-', "_");

    begin_spoofer_job(&job_id)?;
    let job_log_path = logs_dir.join(format!("job-{job_id}.txt")).to_string_lossy().to_string();
    let _ = app.emit(
        "spoofer-started",
        serde_json::json!({ "jobId": job_id, "logFilePath": job_log_path }),
    );

    let log_file = OpenOptions::new().create(true).append(true).open(&job_log_path).ok();

    // Provide a minimal temporary context just for early logging before the full JobContext is built.
    let proxy_url = data.proxy_url.clone();
    let temp_log_file = Mutex::new(log_file);
    let temp_log = |msg: &str, level: &str| {
        let _ = append_log_entry(&app, level, "spoofer", msg);
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let formatted =
            format!("[{}] [{}] {}", timestamp, level.to_uppercase(), redact_log_message(msg));
        if let Ok(mut lock) = temp_log_file.lock() {
            if let Some(file) = lock.as_mut() {
                let _ = writeln!(file, "{formatted}");
            }
        }
        let _ = app.emit("spoofer-log", serde_json::json!({ "message": msg, "level": level }));
        match level {
            "error" => log::error!("[Spoofer] {}", redact_log_message(msg)),
            "warn" => log::warn!("[Spoofer] {}", redact_log_message(msg)),
            _ => log::info!("[Spoofer] {}", redact_log_message(msg)),
        }
    };

    temp_log("Starting spoofer job...", "info");

    if let Some(url) = proxy_url.as_deref().filter(|s| !s.trim().is_empty()) {
        temp_log(&format!("Using HTTP proxy: {url}"), "info");
    }
    let client = crate::utils::get_http_client_with_proxy(proxy_url.as_deref());

    let cookie = data.cookie.clone().unwrap_or_default();
    let api_key = data.api_key.clone().unwrap_or_default();

    if cookie.trim().len() < 50 {
        temp_log("A valid Roblox cookie is required before spoofing.", "error");
        let _ = app.emit("spoofer-result", serde_json::json!({"success": false, "output": "Missing Roblox cookie", "jobId": job_id, "logFilePath": job_log_path}));
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    let is_download_only_job = data.upload_types.as_ref().map_or(true, |types| {
        types.is_empty()
            || (types.contains(&"download".to_string()) && !types.contains(&"upload".to_string()))
    });

    if !is_download_only_job && api_key.trim().len() < 20 {
        temp_log("An Open Cloud API key is required before spoofing. Create one with Assets read/write access for the selected creator.", "error");
        let _ = app.emit("spoofer-result", serde_json::json!({"success": false, "output": "Missing Open Cloud API key", "jobId": job_id, "logFilePath": job_log_path}));
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    let assets_str = data.assets.clone().unwrap_or_default();
    let mut parsed_assets: Vec<(String, String, Option<String>, Option<String>)> = Vec::new();
    if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&assets_str) {
        for val in arr {
            if let (Some(id), Some(t)) =
                (val.get("id").and_then(|v| v.as_str()), val.get("type").and_then(|v| v.as_str()))
            {
                let raw_value =
                    val.get("rawValue").and_then(|v| v.as_str()).map(ToString::to_string);
                let name = val.get("name").and_then(|v| v.as_str()).map(ToString::to_string);
                parsed_assets.push((id.to_string(), t.to_string(), raw_value, name));
            }
        }
    } else {
        let parts: Vec<&str> = assets_str
            .split(|c: char| c.is_whitespace() || c == ',' || c == '[' || c == ']')
            .filter(|s| !s.is_empty())
            .collect();
        for p in parts {
            if let Ok(id) = p.parse::<u64>() {
                parsed_assets.push((
                    id.to_string(),
                    if data.spoof_sounds.unwrap_or(false) {
                        "audio".to_string()
                    } else {
                        "animation".to_string()
                    },
                    None,
                    Some(format!("Asset {id}")),
                ));
            }
        }
    }

    if parsed_assets.is_empty() {
        temp_log("No valid numeric asset IDs found in input.", "error");
        let _ = app.emit("spoofer-result", serde_json::json!({"success": false, "output": "No valid IDs", "jobId": job_id, "logFilePath": job_log_path}));
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    let skip_existing_replacements = data.skip_existing_replacements.unwrap_or(true);
    let existing_replacements: HashMap<String, String> = data
        .existing_replacements
        .as_ref()
        .and_then(|value| value.0.as_object().cloned())
        .map(|entries| {
            entries
                .into_iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|replacement| (key, replacement.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    let mut deduped_assets = Vec::new();
    let mut seen_asset_ids = HashSet::new();
    for (asset_id, asset_type, raw_value, name) in parsed_assets {
        if !seen_asset_ids.insert(asset_id.clone()) {
            continue;
        }
        if skip_existing_replacements && existing_replacements.contains_key(&asset_id) {
            continue;
        }
        deduped_assets.push((asset_id, asset_type, raw_value, name));
    }
    parsed_assets = deduped_assets;

    if parsed_assets.is_empty() {
        temp_log("No assets left to process after deduplication and replacement filters.", "warn");
        let _ = app.emit("spoofer-result", serde_json::json!({"success": true, "output": "Nothing to process", "jobId": job_id, "logFilePath": job_log_path, "replacements": {}, "assetResults": []}));
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    let total = parsed_assets.len();
    temp_log(&format!("Found {total} asset(s) to process."), "info");

    let forced_place_ids = valid_place_ids(data.force_place_ids.as_deref());
    let forced_place_id = first_valid_place_id(data.force_place_ids.as_deref());
    if let Some(place_id) = forced_place_id.as_deref() {
        temp_log(&format!("Using forced Place ID {place_id} for asset delivery."), "info");
    } else {
        temp_log("No forced Place ID specified; candidate Place IDs will be automatically resolved from asset creators.", "info");
    }

    let universe_id = if let Some(place_id) = forced_place_id.clone() {
        crate::commands::spoofer::get_universe_id_from_place_id(place_id, cookie.clone()).await.ok()
    } else {
        None
    };
    if let Some(ref uid) = universe_id {
        temp_log(&format!("Resolved universe {uid} for post-upload asset permissions."), "info");
    }

    let csrf_token = crate::commands::auth::get_csrf_token(app.clone(), cookie.clone())
        .await
        .unwrap_or_default();

    let mut batch_urls = HashMap::new();
    let batch_assets =
        parsed_assets.iter().map(|(id, t, _, _)| (id.clone(), t.clone())).collect::<Vec<_>>();
    if let Ok(urls) = crate::commands::spoofer::batch_get_download_urls_for_assets(
        app.clone(),
        batch_assets,
        cookie.clone(),
        forced_place_id.clone(),
    )
    .await
    {
        let total_assets = parsed_assets.len();
        if urls.is_empty() {
            temp_log(
                &format!(
                    "Batch download-URL endpoint returned 0 of {total_assets} URLs. Usually means the cookie or forced Place ID can't see these assets on Roblox -- falling back to per-asset resolution, but expect most downloads to fail if the auth issue is real."
                ),
                "warn",
            );
        } else if urls.len() < total_assets {
            temp_log(
                &format!(
                    "Batch endpoint resolved {}/{total_assets} download URLs; the remaining {} will fall back to per-asset resolution.",
                    urls.len(),
                    total_assets - urls.len()
                ),
                "info",
            );
        } else {
            temp_log(&format!("Batch endpoint resolved all {} download URLs.", urls.len()), "info");
        }
        batch_urls = urls;
    } else {
        temp_log("Failed to resolve download URLs via batch endpoint. Falling back to individual resolution.", "warn");
    }

    let mut batch_metadata = HashMap::new();
    let preserve_metadata = data.preserve_metadata.unwrap_or(true);
    let asset_ids: Vec<String> = parsed_assets.iter().map(|(id, _, _, _)| id.clone()).collect();
    if preserve_metadata {
        temp_log("Fetching asset metadata in batch...", "info");
        let (fetched_metadata, fetched_creators) =
            batch_fetch_asset_details(&asset_ids, &cookie, &csrf_token, &client).await;
        batch_metadata = fetched_metadata;
        // Warm the discovery cache with the creator info the batch already
        // returned. Without this, the first discovery pass per creator would
        // do its own serial `/v2/assets/{id}/details` fetch to learn who the
        // creator is -- one extra HTTP hop per unique creator that we can
        // skip entirely now that we already have the data.
        if !fetched_creators.is_empty() {
            let creator_count = fetched_creators.len();
            crate::commands::spoofer::download::resolution::prewarm_creator_info_cache(
                fetched_creators,
            );
            temp_log(
                &format!(
                    "Prewarmed creator info for {creator_count} assets -- discovery will skip the per-asset details fetch."
                ),
                "info",
            );
        }
        if batch_metadata.is_empty() {
            temp_log(
                &format!(
                    "Batch metadata endpoint returned 0 of {} results. This usually means Roblox refused to serve details for these assets to the current cookie -- downloads will still be attempted, but any placeholder-image responses will be skipped rather than uploaded as fake replacements.",
                    asset_ids.len()
                ),
                "warn",
            );
        } else if batch_metadata.len() < asset_ids.len() {
            temp_log(
                &format!(
                    "Resolved metadata for {}/{} assets ({} skipped by Roblox).",
                    batch_metadata.len(),
                    asset_ids.len(),
                    asset_ids.len() - batch_metadata.len()
                ),
                "info",
            );
        } else {
            temp_log(
                &format!("Resolved metadata for all {} assets.", batch_metadata.len()),
                "info",
            );
        }
    }

    // Fast-fail when the upfront batch calls signal broken auth. Both endpoints
    // returning zero (or near-zero) means Roblox refuses to serve details for
    // this account -- grinding through 217 assets with per-asset failure paths
    // wastes minutes and produces a wall of red warnings that all say the same
    // thing. Cut it off here with an actionable error, save the wall time.
    let total_pre = parsed_assets.len();
    if preserve_metadata && total_pre >= 5 && batch_metadata.is_empty() && batch_urls.is_empty() {
        temp_log(
            &format!(
                "Aborting: batch endpoints returned no results for any of {total_pre} assets. This is a Roblox auth refusal, not a per-asset issue. Check: (1) ROBLOSECURITY cookie is fresh -- log out and back in on Roblox.com, then paste the new cookie into Accounts; (2) forced Place ID {} is owned by you (or your group); (3) Open Cloud API key has 'Assets: Write' AND '0.0.0.0/0' in the Accepted IPs.",
                data.force_place_ids.clone().unwrap_or_else(|| "N/A".to_string())
            ),
            "error",
        );
        let _ = app.emit(
            "spoofer-result",
            serde_json::json!({
                "success": false,
                "output": "Auth check failed -- aborted before per-asset processing.",
                "jobId": job_id,
                "logFilePath": job_log_path,
                "replacements": {},
                "assetResults": []
            }),
        );
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    let concurrent_enabled = data.concurrent.unwrap_or(true);
    let concurrent_downloading = data.concurrent_downloading.unwrap_or(true);

    let max_concurrency =
        data.max_concurrency.unwrap_or(if concurrent_enabled { 100 } else { 5 }).clamp(1, 100)
            as usize;
    let max_download_concurrency = if concurrent_downloading {
        data.max_download_concurrency.unwrap_or(max_concurrency as u32).clamp(1, 100) as usize
    } else {
        1
    };
    crate::commands::spoofer::configure_adaptive_concurrency(max_concurrency);

    let mut excluded_users =
        crate::commands::spoofer::parse_excluded_id_list(data.excluded_user_ids.as_deref());
    excluded_users.insert("1".to_string());
    let excluded_groups =
        crate::commands::spoofer::parse_excluded_id_list(data.excluded_group_ids.as_deref());

    let account = data.account.clone().unwrap_or_else(|| {
        crate::commands::AnyValue(
            serde_json::json!({"id": "unknown", "name": "Unknown", "avatarUrl": ""}),
        )
    });

    let log_file_extracted = temp_log_file.into_inner().unwrap_or(None);

    let ctx = Arc::new(JobContext {
        job_id: job_id.clone(),
        cookie,
        fallback_cookies: data.fallback_cookies.clone(),
        api_key,
        group_id: data.group_id.clone(),
        upload_types: data.upload_types.clone().unwrap_or_else(|| {
            vec![
                "animation".into(),
                "audio".into(),
                "image".into(),
                "mesh".into(),
                "script_ref".into(),
            ]
        }),
        account_id: selected_account_id(&account.0),
        forced_place_ids,
        safe_place_name,
        place_name_raw,
        base_downloads_dir: base_downloads_dir.clone(),
        universe_id,
        csrf_token,
        downloads_root: base_downloads_dir.to_string_lossy().to_string(),
        excluded_users,
        excluded_groups,
        proxy_url,
        batch_urls,
        batch_metadata,
        enable_archive_recovery: data.enable_archive_recovery.unwrap_or(false),
        success_count: AtomicUsize::new(0),
        skip_count: AtomicUsize::new(0),
        fail_count: AtomicUsize::new(0),
        interrupted: AtomicBool::new(false),
        creator_place_ids_cache: dashmap::DashMap::new(),
        replacements: dashmap::DashMap::new(),
        asset_results: Mutex::new(Vec::new()),
        log_file: Mutex::new(log_file_extracted),
        download_semaphore: Arc::new(Semaphore::new(max_download_concurrency)),
        discoveries: Mutex::new(Vec::new()),
        client,
        app: app.clone(),
    });

    let skip_owned = data.skip_owned.unwrap_or(false);
    let stream = stream::iter(parsed_assets.into_iter().enumerate());

    // Belt-and-braces cap so a single asset's HTTP retry cascade cannot
    // stall the whole job. Individual HTTP requests have their own 15s
    // client timeout and retry-after values are now capped at 2 minutes,
    // but a task could still legitimately need ~5 minutes for a rate-
    // limited multi-step upload. 10 minutes is a comfortable ceiling
    // above that while still being far below the 20+ minute hangs users
    // have reported.
    const PER_ASSET_TIMEOUT_SECS: u64 = 600;

    stream
        .for_each_concurrent(max_concurrency, |(i, (asset_id, asset_type, raw_value, asset_name))| {
            let ctx = Arc::clone(&ctx);

            async move {
                let exact_name = ctx.batch_metadata
                    .get(&asset_id)
                    .map(|d| d.name.clone())
                    .or_else(|| asset_name.clone().filter(|n| n != "Unknown" && n != "Animations" && !n.starts_with("Asset ")))
                    .or_else(|| asset_name.clone())
                    .unwrap_or_else(|| format!("Asset {asset_id}"));

                let asset_id_for_timeout = asset_id.clone();
                let exact_name_for_timeout = exact_name.clone();
                let asset_type_for_timeout = asset_type.clone();
                let ctx_for_timeout = Arc::clone(&ctx);

                let task_body = async move {

                let _adaptive_permit = crate::commands::spoofer::acquire_adaptive_permit().await;
                if ctx.interrupted.load(Ordering::Relaxed) {
                    return;
                }
                if let Err(e) = wait_if_paused(&ctx.job_id).await {
                    let _ = append_log_entry(&ctx.app, "warn", "spoofer", &e.to_string());
                    ctx.interrupted.store(true, Ordering::Relaxed);
                    return;
                }

                let _ = ctx.app.emit(
                    "spoofer-progress",
                    serde_json::json!({ "jobId": ctx.job_id, "current": i + 1, "total": total }),
                );

                if crate::commands::spoofer::should_skip_asset_for_spoofing(
                    ctx.app.clone(),
                    &asset_id,
                    &ctx.cookie,
                    skip_owned,
                    ctx.account_id.as_deref(),
                    ctx.group_id.as_deref(),
                    &ctx.excluded_users,
                    &ctx.excluded_groups,
                )
                .await
                {
                    ctx.skip_count.fetch_add(1, Ordering::Relaxed);
                    ctx.record_result(serde_json::json!({
                        "id": asset_id, "name": exact_name, "type": asset_type, "success": true, "skipped": true, "reason": "filtered"
                    }));
                    return;
                }

                ctx.log(&format!("Processing asset {asset_id} ({}/{})", i + 1, total), "info");

                let mapped_type_name = match asset_type.as_str() {
                    "audio" => "Audio",
                    "mesh" => "Mesh",
                    "image" => "Image",
                    "script_ref" => "Script",
                    "plugin" => "Plugin",
                    _ => "Animation",
                };

                let folder_type_name = match mapped_type_name {
                    "Audio" => "Sounds",
                    "Animation" => "Animations",
                    "Mesh" => "Meshes",
                    "Image" => "Images",
                    "Script" => "Scripts",
                    "Plugin" => "Plugins",
                    _ => "Assets",
                };

                let downloads_dir = ctx.base_downloads_dir.join(&ctx.safe_place_name).join(folder_type_name);
                let _ = tokio::fs::create_dir_all(&downloads_dir).await;

                let file_ext = if mapped_type_name == "Audio" {
                    "ogg"
                } else if mapped_type_name == "Image" {
                    "png"
                } else if asset_type == "raw_keyframe_sequence" {
                    "rbxmx"
                } else {
                    "rbxm"
                };
                let direct_url = if asset_type == "plugin" { None } else { ctx.batch_urls.get(&asset_id).cloned() };

                let is_download_only = asset_type == "script_ref" || asset_type == "video" || !ctx.upload_types.contains(&asset_type) || asset_type == "plugin";
                let file_name = if is_download_only {
                    let safe_name = exact_name.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '_' && c != '-', "_");
                    format!("{safe_name}.{file_ext}")
                } else {
                    format!("{asset_id}.{file_ext}")
                };

                let file_path = downloads_dir.join(file_name).to_string_lossy().to_string();

                let place_ids_for_download = if ctx.forced_place_ids.is_empty() {
                    match crate::commands::spoofer::get_asset_creator_for_asset(ctx.app.clone(), asset_id.clone(), ctx.cookie.clone()).await {
                        Ok((creator_type, creator_id)) => {
                            let cache_key = format!("{creator_type}:{creator_id}");
                            if let Some(ids) = ctx.creator_place_ids_cache.get(&cache_key).map(|v| v.value().clone()) {
                                ids
                            } else {
                                if let Ok(ids) = crate::commands::spoofer::get_place_id_from_creator(
                                    ctx.app.clone(), creator_type.clone(), creator_id.clone(), ctx.cookie.clone(), Some(100), Some(ctx.place_name_raw.clone())
                                ).await {
                                    if !ids.is_empty() {
                                        ctx.log(&format!("Found {} candidate Place ID(s) for {} {}.", ids.len(), creator_type, creator_id), "info");
                                    }
                                    ctx.creator_place_ids_cache.insert(cache_key, ids.clone());
                                    ids
                                } else {
                                    let mut fallback_ids = Vec::new();
                                    if let Some(uid) = ctx.account_id.clone() {
                                        if uid != creator_id {
                                            if let Ok(ids) = crate::commands::spoofer::get_place_id_from_creator(
                                                ctx.app.clone(), "user".to_string(), uid.clone(), ctx.cookie.clone(), Some(100), Some(ctx.place_name_raw.clone())
                                            ).await {
                                                fallback_ids = ids;
                                            }
                                        }
                                    }
                                    if !fallback_ids.is_empty() {
                                        ctx.log(&format!("Asset creator has no valid places. Fell back to {} candidate Place ID(s) from your account.", fallback_ids.len()), "info");
                                    }
                                    ctx.creator_place_ids_cache.insert(cache_key, fallback_ids.clone());
                                    fallback_ids
                                }
                            }
                        }
                        Err(_) => Vec::new(),
                    }
                } else {
                    ctx.forced_place_ids.clone()
                };

                let place_id_arg = if place_ids_for_download.is_empty() { None } else { Some(place_ids_for_download.join(",")) };
                let mut remove_download_file = false;

                let dl_res = if asset_type == "raw_keyframe_sequence" {
                    if let Some(raw_xml) = &raw_value {
                        let full_xml = format!("<roblox xmlns:xmime=\"http://www.w3.org/2005/05/xmlmime\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:noNamespaceSchemaLocation=\"http://www.roblox.com/roblox.xsd\" version=\"4\">\n{}\n</roblox>", raw_xml);
                        if let Err(e) = tokio::fs::write(&file_path, full_xml).await {
                            Err(crate::error::AppError::Io(e))
                        } else {
                            Ok(crate::commands::spoofer::DownloadResult { success: true, file_path: Some(file_path.clone()), error: None, resolved_place_id: None })
                        }
                    } else {
                        Err(crate::error::AppError::Custom("Cannot spoof KeyframeSequences from binary .rbxl files. Please save the place as .rbxlx or use the Studio Plugin instead.".into()))
                    }
                } else {
                    let _dl_permit = ctx.download_semaphore.acquire().await.ok();
                    crate::commands::spoofer::download_animation_asset_with_progress(
                        ctx.app.clone(), direct_url, ctx.cookie.clone(), ctx.fallback_cookies.clone(), file_path.clone(), format!("dl_{asset_id}"), exact_name.clone(), asset_id.clone(), Some(asset_type.clone()), place_id_arg, ctx.enable_archive_recovery, ctx.proxy_url.clone()
                    ).await
                };

                match dl_res {
                    Ok(res) if res.success => {
                        let download_only = asset_type == "script_ref" || asset_type == "video" || !ctx.upload_types.contains(&asset_type) || asset_type == "plugin";
                        if download_only {
                            if let Some(place_id) = res.resolved_place_id {
                                if let Ok(mut disc) = ctx.discoveries.lock() {
                                    disc.push((asset_id.clone(), place_id));
                                }
                            }
                            ctx.success_count.fetch_add(1, Ordering::Relaxed);
                            ctx.skip_count.fetch_add(1, Ordering::Relaxed);
                            ctx.record_result(serde_json::json!({
                                "id": asset_id,
                                "name": exact_name,
                                "type": asset_type,
                                "success": true,
                                "skipped": true,
                                "reason": "already_uploaded",
                                "errorReason": "Already uploaded in a previous run -- reused the existing spoofed ID.",
                            }));
                            return;
                        }

                        if ctx.interrupted.load(Ordering::Relaxed) {
                            return;
                        }

                        let upload_user_id = if ctx.group_id.is_none() { ctx.account_id.clone() } else { None };
                        if ctx.group_id.is_none() && upload_user_id.is_none() {
                            ctx.fail_count.fetch_add(1, Ordering::Relaxed);
                            ctx.record_result(serde_json::json!({ "id": asset_id, "name": exact_name, "type": asset_type, "success": false, "stage": "upload", "errorReason": "No valid user ID" }));
                            return;
                        }

                        let mut details = ctx.batch_metadata.get(&asset_id).cloned();
                        if details.is_none() {
                            details = fetch_asset_details(&asset_id, &ctx.cookie, &ctx.client).await;
                        }
                        let details = details.unwrap_or_else(|| AssetDetails { name: exact_name.clone(), description: "Uploaded by ISpooferMotion.".to_string() });
                        let final_description = if preserve_metadata { details.description } else { "Uploaded by ISpooferMotion.".to_string() };

                        let up_res = crate::commands::spoofer::publish_asset_with_progress(
                            ctx.app.clone(), file_path.clone(), details.name, final_description, ctx.cookie.clone(), ctx.csrf_token.clone(), ctx.group_id.clone(), format!("up_{asset_id}"), Some(mapped_type_name.to_string()), Some(ctx.api_key.clone()), upload_user_id, false, Some(asset_id.clone()), ctx.universe_id.clone(), Some(ctx.downloads_root.clone()), ctx.proxy_url.clone()
                        ).await;

                        match up_res {
                            Ok(up) if up.success => {
                                let new_id = up.asset_id.unwrap_or_default();
                                ctx.log(&format!("Upload successful! New ID: {new_id}"), "success");
                                ctx.replacements.insert(asset_id.clone(), serde_json::Value::String(new_id.clone()));
                                ctx.record_result(serde_json::json!({ "id": asset_id, "name": exact_name, "type": asset_type, "success": true, "newId": new_id }));
                                ctx.success_count.fetch_add(1, Ordering::Relaxed);
                                if let Some(place_id) = res.resolved_place_id {
                                    if let Ok(mut disc) = ctx.discoveries.lock() {
                                        disc.push((asset_id.clone(), place_id));
                                    }
                                }
                                remove_download_file = true;
                            }
                            Ok(up) => {
                                ctx.fail_count.fetch_add(1, Ordering::Relaxed);
                                let err_msg = up.error.unwrap_or_default();
                                ctx.log(&format!("Upload failed for {asset_id}: {err_msg}"), "error");
                                ctx.record_result(serde_json::json!({ "id": asset_id, "name": exact_name, "type": asset_type, "success": false, "stage": "upload", "errorReason": err_msg }));
                            }
                            Err(e) => {
                                ctx.fail_count.fetch_add(1, Ordering::Relaxed);
                                let e_str = e.to_string();
                                ctx.log(&format!("Upload error for {asset_id}: {e_str}"), "error");
                                ctx.record_result(serde_json::json!({ "id": asset_id, "name": exact_name, "type": asset_type, "success": false, "stage": "upload", "errorReason": e_str }));
                                if e_str.contains("403 Forbidden") || e_str.contains("401 Unauthorized") {
                                    // Only fire the "halting job" message the
                                    // FIRST time we set the flag, otherwise a
                                    // burst of parallel-upload 403s spams the
                                    // log with the same halt message.
                                    if !ctx.interrupted.swap(true, Ordering::Relaxed) {
                                        ctx.log(
                                            "Halting the rest of this job -- the Open Cloud API key was rejected. Fix the key (Assets = Write, IP whitelist = 0.0.0.0/0) in the Creator Dashboard, then retry. Assets that hadn't been reached yet were NOT processed.",
                                            "warn",
                                        );
                                    }
                                }
                            }
                        }
                    }
                    Ok(res) => {
                        ctx.fail_count.fetch_add(1, Ordering::Relaxed);
                        let err_msg = res.error.unwrap_or_default();
                        let is_upstream_inaccessible = err_msg.contains("Permission Denied") || err_msg.contains("Asset is private") || err_msg.contains("copylocked") || err_msg.contains("Conflict: Asset delivery blocked") || err_msg.contains("Not Found: Asset");
                        let (level, msg) = if is_upstream_inaccessible {
                            let reason = if err_msg.contains("Not Found") {
                                "asset id doesn't exist"
                            } else if err_msg.contains("Conflict") {
                                // Asset delivery 409: the asset exists but the
                                // signed-in user + selected Place don't have
                                // permission to fetch it. Different from 403,
                                // which means the asset itself is locked.
                                "your account or forced Place ID doesn't have access"
                            } else {
                                "private or copylocked"
                            };
                            ("warn", format!("Skipped {asset_id} ({reason})."))
                        } else {
                            ("error", format!("Download failed for {asset_id}: {err_msg}"))
                        };
                        ctx.log(&msg, level);
                        ctx.record_result(serde_json::json!({ "id": asset_id, "name": exact_name, "type": asset_type, "success": false, "stage": "download", "errorReason": err_msg }));
                    }
                    Err(e) => {
                        ctx.fail_count.fetch_add(1, Ordering::Relaxed);
                        let raw = e.to_string();
                        // Translate common reqwest jargon into something a
                        // tester can act on. Everything else falls through
                        // with the original message.
                        let human = if raw.contains("error decoding response body") {
                            "Roblox cut the connection mid-download (or sent a corrupt/gzipped body). Retries didn't recover -- try again in a moment.".to_string()
                        } else if raw.contains("timed out") || raw.contains("timeout") {
                            "Download timed out. Roblox is likely rate-limiting or slow -- try again shortly.".to_string()
                        } else if raw.contains("ConnectionReset") || raw.contains("connection reset") {
                            "Roblox reset the connection during download. Usually transient.".to_string()
                        } else if raw.contains("dns error") {
                            "DNS lookup failed for a Roblox host. Check your network / VPN.".to_string()
                        } else {
                            raw.clone()
                        };
                        ctx.log(&format!("Download error for {asset_id}: {human}"), "error");
                        ctx.record_result(serde_json::json!({ "id": asset_id, "name": exact_name, "type": asset_type, "success": false, "stage": "download", "errorReason": raw }));
                    }
                }

                if remove_download_file {
                    let _ = tokio::fs::remove_file(&file_path).await;
                }
                };

                if tokio::time::timeout(
                    std::time::Duration::from_secs(PER_ASSET_TIMEOUT_SECS),
                    task_body,
                )
                .await
                .is_err()
                {
                    // Task exceeded the per-asset ceiling. If the task had already
                    // recorded a replacement (i.e. the upload succeeded and the
                    // hang was in the trailing cleanup) we must NOT count it as
                    // failed too — that would double-count against fail_count and
                    // flip the job to "partially_finished" when everything worked.
                    if ctx_for_timeout.replacements.contains_key(&asset_id_for_timeout) {
                        ctx_for_timeout.log(
                            &format!(
                                "Asset {asset_id_for_timeout} uploaded successfully but its cleanup hung; abandoning cleanup so the job can finish."
                            ),
                            "warn",
                        );
                    } else {
                        ctx_for_timeout.fail_count.fetch_add(1, Ordering::Relaxed);
                        let msg = format!(
                            "Timed out processing asset {asset_id_for_timeout} after {PER_ASSET_TIMEOUT_SECS}s; giving up so the job can finish."
                        );
                        ctx_for_timeout.log(&msg, "warn");
                        ctx_for_timeout.record_result(serde_json::json!({
                            "id": asset_id_for_timeout,
                            "name": exact_name_for_timeout,
                            "type": asset_type_for_timeout,
                            "success": false,
                            "stage": "timeout",
                            "errorReason": "per-asset timeout"
                        }));
                    }
                }
            }
        })
        .await;

    let success = ctx.success_count.load(Ordering::Relaxed);
    let skipped = ctx.skip_count.load(Ordering::Relaxed);
    let failed = ctx.fail_count.load(Ordering::Relaxed);
    let interrupted_flag = ctx.interrupted.load(Ordering::Relaxed);

    let completed_successfully = !interrupted_flag && failed == 0;
    let status = if completed_successfully {
        "successful"
    } else if success == 0 {
        "errored"
    } else {
        "partially_finished"
    };

    let end_time = chrono::Utc::now();
    let duration_ms = (end_time - start_time).num_milliseconds().max(0);

    let final_asset_results = ctx.asset_results.lock().map(|r| r.clone()).unwrap_or_default();
    let final_replacements: serde_json::Map<String, serde_json::Value> =
        ctx.replacements.iter().map(|kv| (kv.key().clone(), kv.value().clone())).collect();

    let job = serde_json::json!({
        "id": job_id.clone(),
        "status": status,
        "startTime": start_time.to_rfc3339(),
        "endTime": end_time.to_rfc3339(),
        "durationMs": duration_ms,
        "account": account,
        "group": data.group,
        "assetResults": final_asset_results,
        "config": {
            "assets": asset_ids.join(","),
            "groupId": data.group_id,
            "spoofSounds": data.spoof_sounds.unwrap_or(false),
            "uploadTypes": ctx.upload_types,
            "placeName": data.place_name
        },
        "logFilePath": job_log_path.clone()
    });
    if let Err(error) = crate::commands::jobs::persist_job(&app, job).await {
        ctx.log(&format!("Could not save spoofing job history: {error}"), "error");
    }

    let summary = format!("Total Assets: {total}\nSuccessful: {success} (Skipped Uploads: {skipped})\nFailed: {failed}");
    ctx.log(&summary, if completed_successfully { "success" } else { "warn" });

    // If the job effectively failed across the board, surface the most likely
    // root cause instead of leaving the user staring at a wall of red warnings.
    if total > 0 && success == 0 && failed > 0 {
        ctx.log(
            "Every asset failed. This is almost always an auth problem, not a bug -- the cookie or forced Place ID can't access these assets on Roblox. Try: (1) refreshing the ROBLOSECURITY cookie in Accounts, (2) picking a Place you actually own for the forced Place ID, (3) confirming the Open Cloud API key belongs to the same account/group.",
            "warn",
        );
    } else if total > 0 && failed > success && failed > total / 2 {
        ctx.log(
            &format!(
                "Over half the assets failed ({failed}/{total}). If most are 'placeholder image' or 'blocked by Roblox' errors, your cookie or forced Place ID probably doesn't have access to this creator's assets."
            ),
            "warn",
        );
    }

    if !final_replacements.is_empty() {
        ctx.log(
            &format!(
                "{} replacement(s) queued to the Studio plugin bridge. They only apply once Studio is running with the ISpooferMotion plugin loaded -- watch the plugin status pill in the app. Don't forget to save your place after the replacements land.",
                final_replacements.len()
            ),
            "info",
        );
    } else if success > 0 {
        // Successful uploads but no replacements queued -- almost always means
        // the mapping got dropped somewhere. Flag it clearly.
        ctx.log(
            "Uploads succeeded but no replacements got queued to the plugin. If this reproduces please share the log -- it means the mapping-collection step failed.",
            "warn",
        );
    }

    let _ = app.emit(
        "spoofer-result",
        serde_json::json!({
            "success": completed_successfully,
            "partial": !completed_successfully && success > 0,
            "replacements": final_replacements,
            "output": format!("Processed {success}/{total} assets."),
            "jobId": job_id,
            "logFilePath": job_log_path,
            "assetResults": final_asset_results
        }),
    );
    finish_spoofer_job(&job_id);

    let is_download_only = data.upload_types.as_ref().is_some_and(|types| {
        types.contains(&"download".to_string()) && !types.contains(&"upload".to_string())
    });
    if is_download_only {
        use tauri_plugin_opener::OpenerExt;
        let _ = tokio::fs::create_dir_all(&base_downloads_dir).await;
        let _ = app
            .opener()
            .open_path(base_downloads_dir.to_string_lossy().to_string(), None::<String>);
    }

    if completed_successfully {
        let discoveries = ctx
            .discoveries
            .lock()
            .map(|disc| disc.iter().cloned().collect::<HashMap<_, _>>())
            .unwrap_or_default();
        let write_failures = stream::iter(discoveries)
            .map(|(asset_id, place_id)| async move {
                crate::commands::spoofer::remote_cache::push_discovery(asset_id, place_id).await
            })
            .buffer_unordered(8)
            .filter_map(|result| async move { result.err() })
            .collect::<Vec<_>>()
            .await;

        if !write_failures.is_empty() {
            let first_error = write_failures.first().map(String::as_str).unwrap_or("unknown error");
            ctx.log(
                &format!(
                    "Failed to contribute {} discovery entry/entries to the community cache. First error: {}",
                    write_failures.len(),
                    first_error
                ),
                "warn",
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_first_valid_place_id() {
        assert_eq!(first_valid_place_id(None), None);
        assert_eq!(first_valid_place_id(Some("")), None);
        assert_eq!(first_valid_place_id(Some("abc, def")), None);
        assert_eq!(first_valid_place_id(Some("123")), Some("123".to_string()));
        assert_eq!(first_valid_place_id(Some("abc, 456, 789")), Some("456".to_string()));
        assert_eq!(first_valid_place_id(Some("  999  , 888 ")), Some("999".to_string()));
        assert_eq!(first_valid_place_id(Some("123a, 456")), Some("456".to_string()));
    }

    #[test]
    fn test_valid_place_ids() {
        assert!(valid_place_ids(None).is_empty());
        assert!(valid_place_ids(Some("abc, def")).is_empty());

        let ids = valid_place_ids(Some("123, abc, 456, 456,  789  "));
        assert_eq!(ids.len(), 3);
        assert_eq!(ids[0], "123");
        assert_eq!(ids[1], "456");
        assert_eq!(ids[2], "789");
    }

    #[test]
    fn test_numeric_value_to_string() {
        assert_eq!(numeric_value_to_string(&serde_json::json!(123)), Some("123".to_string()));
        assert_eq!(numeric_value_to_string(&serde_json::json!("456")), Some("456".to_string()));
        assert_eq!(numeric_value_to_string(&serde_json::json!("abc")), None);
        assert_eq!(numeric_value_to_string(&serde_json::json!("123a")), None);
        assert_eq!(numeric_value_to_string(&serde_json::json!(null)), None);
    }

    #[test]
    fn test_selected_account_id() {
        assert_eq!(selected_account_id(&serde_json::json!({ "id": 123 })), Some("123".to_string()));
        assert_eq!(
            selected_account_id(&serde_json::json!({ "id": "456" })),
            Some("456".to_string())
        );
        assert_eq!(selected_account_id(&serde_json::json!({ "id": "abc" })), None);
        assert_eq!(selected_account_id(&serde_json::json!({ "name": "cody" })), None);
    }
}
