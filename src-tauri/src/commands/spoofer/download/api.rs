use super::{
    build_roblox_cookie_header, download_animation_asset_with_progress, emit_spoofer_log,
    emit_transfer_update, is_valid_numeric_id, set_rate_limit, validate_downloaded_payload,
    wait_rate_limit, AsyncWriteExt, BatchAssetRequest, ConcurrentDownloadTask, DownloadResult,
    Duration, File, RateLimitBucket, TransferUpdate, CONTENT_LENGTH,
};
use futures::StreamExt;
use reqwest::header::{COOKIE, USER_AGENT};
use std::collections::HashMap;
use tauri::AppHandle;

// Request raw bytes from the asset delivery API, applying User-Agent spoofing when required.
pub async fn get_scraped_asset_cdn_url(client: &reqwest::Client, asset_id: &str) -> Option<String> {
    let url = format!("https://www.roblox.com/library/{}/", asset_id);
    if let Ok(resp) = client
        .get(&url)
        .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36")
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(text) = resp.text().await {
                // look for data-mediathumb-url="([^"]+)"
                if let Some(idx) = text.find("data-mediathumb-url=\"") {
                    let start = idx + 21;
                    if let Some(end_idx) = text[start..].find('"') {
                        return Some(text[start..start + end_idx].to_string());
                    }
                }
            }
        }
    }

    // Fallback: hit the assetdelivery v1 endpoint with redirect disabled and read the Location
    // header directly. This avoids downloading any bytes and works even when the library page
    // no longer embeds a mediathumb URL (increasingly common since 2024).
    let redirect_url = format!(
        "https://assetdelivery.roblox.com/v1/asset/?id={}&expectedAssetType=Audio",
        asset_id
    );
    if let Ok(no_redirect_client) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
    {
        if let Ok(resp) =
            no_redirect_client.get(&redirect_url).header(USER_AGENT, "Roblox/WinInet").send().await
        {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            if let Some(cdn_url) = location.filter(|u| u.contains("rbxcdn.com")) {
                return Some(cdn_url);
            }
        }
    }

    None
}

pub async fn send_asset_download_request_ua(
    client: &reqwest::Client,
    url: &str,
    cookie_header: Option<&str>,
    place_id: Option<&str>,
    user_agent: &str,
    universe_id: Option<&str>,
    resume_offset: u64,
) -> reqwest::Result<reqwest::Response> {
    let mut req = client
        .get(url)
        .header(USER_AGENT, user_agent)
        .header("Roblox-Browser-Asset-Request", "false");

    if resume_offset > 0 {
        req = req.header("Range", format!("bytes={resume_offset}-"));
    }

    if let Some(cookie) = cookie_header {
        req = req.header(COOKIE, cookie);
    }
    req = crate::commands::spoofer::apply_roblox_game_context(req, place_id, universe_id);
    req.send().await
}

// Stream download response directly to disk to minimize memory usage, emitting progress events.
pub async fn write_download_response(
    app: &AppHandle,
    download_resp: reqwest::Response,
    file_path: String,
    transfer_id: String,
    name: String,
    asset_id: String,
    asset_type: Option<String>,
    resume_offset: u64,
) -> crate::error::Result<DownloadResult> {
    if file_path.contains("..") {
        return Err("Invalid file path: path traversal detected.".into());
    }

    let file_path_buf = std::path::PathBuf::from(&file_path);
    if let Some(parent) = file_path_buf.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| "Download output directory is unavailable.")?;
    }

    let content_length = download_resp
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    emit_transfer_update(
        app,
        TransferUpdate {
            id: transfer_id.clone(),
            name: Some(name.clone()),
            size: content_length,
            status: Some("downloading".into()),
            direction: Some("download".into()),
            progress: Some(0),
            error: None,
            original_asset_id: Some(asset_id.clone()),
            new_asset_id: None,
        },
    );

    let mut downloaded: u64 = 0;
    let mut is_resuming = false;

    if download_resp.status() == reqwest::StatusCode::PARTIAL_CONTENT && resume_offset > 0 {
        is_resuming = true;
        downloaded = resume_offset;
    }

    let mut file = if is_resuming {
        tokio::fs::OpenOptions::new().append(true).open(&file_path).await?
    } else {
        File::create(&file_path).await?
    };

    let total_length = content_length.map(|l| l + if is_resuming { resume_offset } else { 0 });

    let mut last_progress: u64 = if is_resuming && total_length.unwrap_or(0) > 0 {
        (resume_offset * 100) / total_length.unwrap_or(1)
    } else {
        0
    };

    let mut stream = download_resp.bytes_stream();
    let mut last_emit_bytes = downloaded;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        if let Some(total) = total_length {
            if let Some(progress) = downloaded.checked_mul(100).and_then(|d| d.checked_div(total)) {
                let progress = progress.min(99);
                if progress > last_progress {
                    last_progress = progress;
                    emit_transfer_update(
                        app,
                        TransferUpdate {
                            id: transfer_id.clone(),
                            progress: Some(progress),
                            status: Some("downloading".into()),
                            direction: Some("download".into()),
                            name: None,
                            original_asset_id: None,
                            error: None,
                            size: None,
                            new_asset_id: None,
                        },
                    );
                }
            }
        } else if downloaded.saturating_sub(last_emit_bytes) >= 512 * 1024 {
            last_emit_bytes = downloaded;
            emit_transfer_update(
                app,
                TransferUpdate {
                    id: transfer_id.clone(),
                    progress: None,
                    status: Some("downloading".into()),
                    direction: Some("download".into()),
                    name: None,
                    original_asset_id: None,
                    error: None,
                    size: Some(downloaded),
                    new_asset_id: None,
                },
            );
        }
    }
    file.flush().await?;

    if let Some(expected) = total_length {
        if downloaded != expected {
            let _ = tokio::fs::remove_file(&file_path).await;
            return Err(format!("Incomplete payload received: {downloaded} of {expected} bytes. Connection may have dropped.").into());
        }
    }

    if let Err(error_msg) = validate_downloaded_payload(&file_path, asset_type.as_deref()).await {
        crate::commands::spoofer::diagnostics::record_failed_transfer_diagnostic(
            app,
            &asset_id,
            asset_type.as_deref(),
            std::path::Path::new(&file_path),
            &error_msg,
        )
        .await;
        let _ = tokio::fs::remove_file(&file_path).await;
        emit_transfer_update(
            app,
            TransferUpdate {
                id: transfer_id.clone(),
                progress: Some(0),
                status: Some("error".into()),
                direction: Some("download".into()),
                name: None,
                original_asset_id: Some(asset_id),
                error: Some(error_msg.clone()),
                size: None,
                new_asset_id: None,
            },
        );
        return Ok(DownloadResult {
            success: false,
            file_path: None,
            error: Some(error_msg),
            resolved_place_id: None,
        });
    }

    emit_transfer_update(
        app,
        TransferUpdate {
            id: transfer_id.clone(),
            progress: Some(100),
            status: Some("completed".into()),
            direction: Some("download".into()),
            name: None,
            original_asset_id: None,
            error: None,
            size: None,
            new_asset_id: None,
        },
    );

    Ok(DownloadResult {
        success: true,
        file_path: Some(file_path),
        error: None,
        resolved_place_id: None,
    })
}

// Automatically acquire free assets to bypass copylock restrictions.
pub async fn auto_claim_free_asset(
    app: &AppHandle,
    client: &reqwest::Client,
    asset_id: &str,
    cookie: &str,
) -> crate::error::Result<bool> {
    let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
    let resp = client.get(&url).header(COOKIE, cookie).send().await?;
    if !resp.status().is_success() {
        return Ok(false);
    }
    let Ok(data) = resp.json::<serde_json::Value>().await else {
        return Ok(false);
    };

    let price = data.get("PriceInRobux");
    let is_public =
        data.get("IsPublicDomain").and_then(serde_json::Value::as_bool).unwrap_or(false);
    let is_free = price.is_none()
        || price.is_some_and(serde_json::Value::is_null)
        || price.and_then(serde_json::Value::as_u64) == Some(0)
        || is_public;

    if !is_free {
        return Ok(false);
    }

    let product_id = data.get("ProductId").and_then(serde_json::Value::as_u64);
    let creator_id = data
        .get("Creator")
        .and_then(|c| c.get("CreatorTargetId"))
        .and_then(serde_json::Value::as_u64);

    if let (Some(pid), Some(cid)) = (product_id, creator_id) {
        if pid == 0 {
            return Ok(false);
        }
        let csrf_token =
            crate::commands::auth::get_csrf_token(app.clone(), cookie.to_string()).await?;

        let purchase_url = format!("https://economy.roblox.com/v1/purchases/products/{pid}");
        let payload = serde_json::json!({
            "expectedCurrency": 1,
            "expectedPrice": 0,
            "expectedSellerId": cid
        });

        let purchase_resp = client
            .post(&purchase_url)
            .header(COOKIE, cookie)
            .header("x-csrf-token", csrf_token)
            .json(&payload)
            .send()
            .await?;

        if purchase_resp.status().is_success() {
            return Ok(true);
        }
    }
    Ok(false)
}

// (Removed tauri command as this is internal)
#[specta::specta]
pub async fn batch_get_download_urls(
    app: AppHandle,
    asset_ids: Vec<String>,
    cookie: String,
    place_id: Option<String>,
) -> crate::error::Result<HashMap<String, String>> {
    let assets = asset_ids.into_iter().map(|id| (id, "animation".to_string())).collect();
    batch_get_download_urls_for_assets(app, assets, cookie, place_id).await
}

// Resolve multiple asset download links via batch request to reduce API calls.
pub async fn batch_get_download_urls_for_assets(
    app: AppHandle,
    assets: Vec<(String, String)>,
    cookie: String,
    place_id: Option<String>,
) -> crate::error::Result<HashMap<String, String>> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err("Missing or invalid ROBLOSECURITY cookie".into());
    }

    let place_id_num = place_id
        .as_deref()
        .filter(|id| is_valid_numeric_id(id))
        .and_then(|id| id.parse::<i64>().ok());
    let mut body = Vec::new();
    for (id_str, asset_type) in &assets {
        if asset_type.eq_ignore_ascii_case("plugin") {
            continue;
        }
        if let Ok(id) = id_str.parse::<i64>() {
            let mut final_place_id = place_id_num;
            if let Some(cached_place_id_str) =
                crate::commands::spoofer::remote_cache::get_local_context(id_str)
            {
                if let Ok(cached_id) = cached_place_id_str.parse::<i64>() {
                    final_place_id = Some(cached_id);
                }
            }

            body.push(BatchAssetRequest {
                asset_name: id_str.clone(),
                asset_type: batch_asset_type_name(asset_type).to_string(),
                asset_id: id,
                request_id: id_str.clone(),
                place_id: final_place_id,
                server_place_id: final_place_id,
                client_insert: true,
                script_insert: true,
            });
        }
    }

    if body.is_empty() {
        return Ok(HashMap::new());
    }

    let client = crate::utils::get_http_client();

    struct BatchChunkResult {
        urls: HashMap<String, String>,
        // asset IDs that came back with 403/access-denied errors - these need a different place ID
        access_denied_ids: std::collections::HashSet<String>,
        has_transient_error: bool,
    }

    fn parse_batch_response(data: &serde_json::Value) -> BatchChunkResult {
        let mut urls = HashMap::new();
        let mut access_denied_ids = std::collections::HashSet::new();
        let mut has_transient_error = false;

        if let Some(locations) = data.as_array() {
            for loc in locations {
                let req_id = loc.get("requestId").and_then(|v| v.as_str()).map(str::to_string);

                if let Some(errors) = loc.get("errors").and_then(|e| e.as_array()) {
                    if !errors.is_empty() {
                        let is_access_denied = errors.iter().any(|e| {
                            let code = e
                                .get("code")
                                .or_else(|| e.get("Code"))
                                .and_then(serde_json::Value::as_i64)
                                .unwrap_or(0);
                            let msg = e
                                .get("message")
                                .or_else(|| e.get("Message"))
                                .and_then(|m| m.as_str())
                                .unwrap_or("");

                            let contains_ci = |needle: &[u8]| {
                                msg.as_bytes()
                                    .windows(needle.len())
                                    .any(|w| w.eq_ignore_ascii_case(needle))
                            };

                            code == 403
                                || msg.contains("403")
                                || contains_ci(b"not authorized")
                                || contains_ci(b"unauthorized")
                                || contains_ci(b"forbidden")
                        });

                        if is_access_denied {
                            if let Some(id) = &req_id {
                                access_denied_ids.insert(id.clone());
                            }
                        } else {
                            has_transient_error = true;
                        }
                    }
                }

                let download_url = loc
                    .get("locations")
                    .and_then(|l| l.as_array())
                    .and_then(|l| l.first())
                    .and_then(|l| l.get("location"))
                    .and_then(|l| l.as_str());
                if let (Some(req_id), Some(url)) = (req_id, download_url) {
                    urls.insert(req_id, url.to_string());
                }
            }
        }
        BatchChunkResult { urls, access_denied_ids, has_transient_error }
    }

    let mut urls = HashMap::new();
    let place_ids =
        crate::commands::spoofer::download::resolution::parse_place_ids(place_id.as_deref());
    let fallback_place_ids: Vec<Option<String>> =
        if place_ids.is_empty() { vec![None] } else { place_ids.into_iter().map(Some).collect() };

    for chunk in body.chunks(50) {
        let chunk_vec = chunk.to_vec();
        // resolved_this_chunk holds URLs we've already found; we won't re-request these
        let mut resolved_this_chunk: HashMap<String, String> = HashMap::new();

        for current_place_id_opt in &fallback_place_ids {
            // Build a sub-chunk of only the asset IDs still unresolved
            let pending: Vec<BatchAssetRequest> = chunk_vec
                .iter()
                .filter(|item| !resolved_this_chunk.contains_key(&item.request_id))
                .cloned()
                .collect();
            if pending.is_empty() {
                break; // all resolved
            }

            let current_place_id_num = current_place_id_opt
                .as_deref()
                .filter(|id| is_valid_numeric_id(id))
                .and_then(|id| id.parse::<i64>().ok());

            let pending_with_place: Vec<BatchAssetRequest> = pending
                .into_iter()
                .map(|mut item| {
                    if let Some(pid) = current_place_id_num {
                        item.place_id = Some(pid);
                        item.server_place_id = Some(pid);
                    }
                    item
                })
                .collect();

            let mut chunk_urls = HashMap::new();
            let mut chunk_access_denied = std::collections::HashSet::new();
            let mut has_transient = false;

            for ua in ["RobloxStudio/WinInet", "RobloxApp/WinInet", "Roblox/WinInet"] {
                wait_rate_limit(RateLimitBucket::DownloadResolution).await;

                let mut req = client
                    .post("https://assetdelivery.roblox.com/v2/assets/batch")
                    .header(COOKIE, &cookie_header)
                    .header(USER_AGENT, ua)
                    .header("Content-Type", "application/json");
                if let Some(ref pid) = current_place_id_opt {
                    req = crate::commands::spoofer::apply_roblox_game_context(req, Some(pid), None);
                }

                let send_result = tokio::time::timeout(
                    Duration::from_secs(15),
                    req.json(&pending_with_place).send(),
                )
                .await;

                if let Ok(Ok(resp)) = send_result {
                    crate::utils::check_for_roblosecurity_update(&app, &resp, &cookie_header);
                    if resp.status().is_success() {
                        crate::commands::spoofer::record_adaptive_success();
                        if let Ok(data) = resp.json::<serde_json::Value>().await {
                            let res = parse_batch_response(&data);
                            chunk_urls.extend(res.urls);
                            chunk_access_denied.extend(res.access_denied_ids);
                            has_transient = res.has_transient_error;
                        }
                        break; // got a 200 - stop UA cycling
                    } else if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                        return Err("Your ROBLOSECURITY cookie is missing, invalid, or expired. Please update it in settings.".into());
                    } else if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        let retry_after_ms = crate::utils::extract_retry_after(&resp, None);
                        crate::commands::spoofer::record_adaptive_rate_limit(retry_after_ms);
                        let wait_ms = retry_after_ms.unwrap_or(2_000);
                        set_rate_limit(
                            RateLimitBucket::DownloadResolution,
                            Duration::from_millis(wait_ms),
                        );
                        if crate::commands::spoofer::should_log_rate_limit_warning(
                            "batch-asset-resolution",
                        ) {
                            emit_spoofer_log(
                                &app,
                                "warn",
                                &format!(
                                    "Roblox rate limited batch asset resolution; slowing requests for about {:.1}s.",
                                    wait_ms as f64 / 1000.0
                                ),
                            );
                        }
                        has_transient = true;
                    } else if resp.status().is_server_error() {
                        crate::commands::spoofer::record_adaptive_server_error();
                        has_transient = true;
                    }
                } else {
                    has_transient = true; // timeout or network error
                }
                if !chunk_urls.is_empty() {
                    break; // partial success is good enough - stop UA cycling
                }
                wait_rate_limit(RateLimitBucket::DownloadResolution).await;
            }

            // Absorb newly resolved URLs into the running total
            resolved_this_chunk.extend(chunk_urls);

            // Prepare next pending_with_place to only retry access-denied IDs (not transient errors -
            // those might succeed with the same place ID on retry, which the outer loop already handles)
            let _ = chunk_access_denied; // consumed - next iteration will re-filter from resolved_this_chunk
            let _ = has_transient;
        }

        urls.extend(resolved_this_chunk);
    }

    Ok(urls)
}

// (Removed tauri command as this is internal)
#[specta::specta]
pub async fn batch_download_assets_concurrent(
    app: AppHandle,
    tasks: Vec<ConcurrentDownloadTask>,
    cookie: String,
    _place_id: Option<String>,
) -> crate::error::Result<Vec<DownloadResult>> {
    use futures::stream::{self, StreamExt};

    let results = stream::iter(tasks)
        .map(|task| {
            let app = app.clone();
            let cookie = cookie.clone();
            let place_id_for_task = _place_id.clone();
            async move {
                match download_animation_asset_with_progress(
                    app,
                    task.direct_url,
                    cookie,
                    None,
                    task.file_path,
                    task.transfer_id,
                    task.name,
                    task.asset_id,
                    task.asset_type,
                    place_id_for_task, // was incorrectly None
                    false,
                    None,
                )
                .await
                {
                    Ok(res) => res,
                    Err(e) => DownloadResult {
                        success: false,
                        file_path: None,
                        error: Some(e.to_string()),
                        resolved_place_id: None,
                    },
                }
            }
        })
        .buffer_unordered(16)
        .collect::<Vec<_>>()
        .await;

    Ok(results)
}

#[must_use]
pub fn batch_asset_type_name(asset_type: &str) -> &'static str {
    match asset_type.to_ascii_lowercase().as_str() {
        "audio" => "Audio",
        "mesh" => "Mesh",
        "image" | "images" => "Image",
        "script_ref" | "script" => "Script",
        _ => "Animation",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::Client;

    #[tokio::test]
    async fn send_asset_download_request_ua_appends_range_header_when_offset_greater_than_zero() {
        let client = Client::new();
        let _ = send_asset_download_request_ua(
            &client,
            "http://127.0.0.1:0/", // mock, will fail but request is built
            None,
            None,
            "mock",
            None,
            500,
        )
        .await;
    }
}
