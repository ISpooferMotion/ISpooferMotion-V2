use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

const MAX_WRITE_ATTEMPTS: usize = 3;
const BASE_RETRY_DELAY_MS: u64 = 250;

const MIN_WRITE_INTERVAL_MS: u64 = 2_100;
const RETRY_COOLDOWN: Duration = Duration::from_secs(60);

static PUSH_URL: OnceLock<std::sync::RwLock<Option<String>>> = OnceLock::new();
static PENDING_PATH: OnceLock<std::sync::RwLock<Option<PathBuf>>> = OnceLock::new();
static QUEUE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static NOTIFY: OnceLock<tokio::sync::Notify> = OnceLock::new();
static WORKER_STARTED: OnceLock<()> = OnceLock::new();
static NEXT_WRITE: OnceLock<tokio::sync::Mutex<Option<tokio::time::Instant>>> = OnceLock::new();

fn queue_lock() -> &'static tokio::sync::Mutex<()> {
    QUEUE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn notify_worker() {
    NOTIFY.get_or_init(tokio::sync::Notify::new).notify_one();
}

fn pending_path() -> Option<PathBuf> {
    PENDING_PATH
        .get_or_init(|| std::sync::RwLock::new(None))
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

fn set_pending_path(path: PathBuf) {
    *PENDING_PATH
        .get_or_init(|| std::sync::RwLock::new(None))
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(path);
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 20
        && !id.starts_with('0')
        && id.bytes().all(|byte| byte.is_ascii_digit())
}

fn get_push_url_lock() -> &'static std::sync::RwLock<Option<String>> {
    PUSH_URL.get_or_init(|| std::sync::RwLock::new(None))
}

fn read_push_url() -> Option<String> {
    get_push_url_lock().read().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
}

fn set_push_url(push_url: Option<String>) {
    let mut guard = get_push_url_lock().write().unwrap_or_else(std::sync::PoisonError::into_inner);
    *guard = push_url;
}

fn deserialize_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        _ => Err(serde::de::Error::custom("ID must be a string or number")),
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RemoteAssetContext {
    #[serde(deserialize_with = "deserialize_id")]
    pub asset_id: String,
    #[serde(deserialize_with = "deserialize_id")]
    pub place_id: String,
}

fn validate_cache_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    let parsed =
        reqwest::Url::parse(trimmed).map_err(|_| "Community cache URL is invalid".to_string())?;

    if parsed.scheme() == "https" {
        Ok(())
    } else if parsed.scheme() == "http" {
        let host = parsed
            .host_str()
            .map(|host| host.trim_start_matches('[').trim_end_matches(']'))
            .unwrap_or_default();
        let is_loopback = host.eq_ignore_ascii_case("localhost")
            || host.parse::<std::net::IpAddr>().is_ok_and(|address| address.is_loopback());

        if is_loopback {
            return Ok(());
        }

        Err("Community cache URL must use HTTPS; HTTP is allowed only for localhost".to_string())
    } else {
        Err("Community cache URL must use HTTPS".to_string())
    }
}

fn retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::REQUEST_TIMEOUT
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn retry_delay(attempt: usize, response: Option<&reqwest::Response>) -> Duration {
    if let Some(response) = response {
        if let Some(delay_ms) = crate::utils::extract_retry_after(response, Some(attempt as u32)) {
            return Duration::from_millis(delay_ms.min(120_000));
        }
    }

    let exponent = u32::try_from(attempt.saturating_sub(1)).unwrap_or(u32::MAX).min(8);
    Duration::from_millis(BASE_RETRY_DELAY_MS.saturating_mul(2_u64.pow(exponent)))
}

async fn throttle_write() {
    let mut next = NEXT_WRITE.get_or_init(|| tokio::sync::Mutex::new(None)).lock().await;
    if let Some(deadline) = *next {
        tokio::time::sleep_until(deadline).await;
    }
    *next = Some(tokio::time::Instant::now() + Duration::from_millis(MIN_WRITE_INTERVAL_MS));
}

async fn write_remote_context(
    client: &reqwest::Client,
    url: &str,
    context: &RemoteAssetContext,
    require_active_url: bool,
) -> Result<(), String> {
    if !valid_id(&context.asset_id) || !valid_id(&context.place_id) {
        return Err(
            "Community-cache IDs must be positive decimal strings of at most 20 digits".into()
        );
    }
    for attempt in 1..=MAX_WRITE_ATTEMPTS {
        if require_active_url && read_push_url().as_deref() != Some(url) {
            return Err(
                "community cache write cancelled because contributions were disabled".into()
            );
        }

        if require_active_url {
            throttle_write().await;

            if read_push_url().as_deref() != Some(url) {
                return Err("community cache contributions were disabled".into());
            }
        }

        match client
            .post(url)
            .header("x-ispoofermotion-client", "ispoofermotion-v2")
            .json(context)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                if response.status() == reqwest::StatusCode::NO_CONTENT {
                    return Ok(());
                }
                let body: serde_json::Value = response.json().await.map_err(|error| {
                    format!("community cache acknowledgement was not JSON: {error}")
                })?;
                if body.get("success").and_then(serde_json::Value::as_bool) == Some(true) {
                    return Ok(());
                }
                return Err("community cache did not acknowledge the mapping".into());
            }
            Ok(response) => {
                let status = response.status();
                if !retryable_status(status) || attempt == MAX_WRITE_ATTEMPTS {
                    return Err(format!(
                        "community cache returned HTTP {status} after {attempt} attempt(s)"
                    ));
                }
                tokio::time::sleep(retry_delay(attempt, Some(&response))).await;
            }
            Err(error) => {
                if attempt == MAX_WRITE_ATTEMPTS {
                    let error = error.without_url();
                    return Err(format!(
                        "community cache request failed after {attempt} attempts: {error}"
                    ));
                }
                tokio::time::sleep(retry_delay(attempt, None)).await;
            }
        }
    }

    Err("community cache write exhausted its retry budget".to_string())
}

async fn load_pending(path: &Path) -> Result<HashMap<String, String>, String> {
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("Community-cache queue is invalid: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(format!("Could not read community-cache queue: {error}")),
    }
}

async fn save_pending(path: &Path, pending: &HashMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    let encoded = serde_json::to_vec(pending).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, encoded).await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, path).await.map_err(|e| e.to_string())
}

async fn queue_entries(path: &Path, discoveries: HashMap<String, String>) -> Result<usize, String> {
    let _guard = queue_lock().lock().await;
    let mut entries = load_pending(path).await?;
    let mut accepted = 0;
    for (asset_id, place_id) in discoveries {
        if valid_id(&asset_id) && valid_id(&place_id) {
            entries.insert(asset_id, place_id);
            accepted += 1;
        } else {
            log::warn!("Skipped discovery with invalid asset or place ID");
        }
    }
    if accepted > 0 {
        save_pending(path, &entries).await?;
        notify_worker();
    }
    Ok(accepted)
}

async fn run_writer() {
    let mut blocked_until: HashMap<String, tokio::time::Instant> = HashMap::new();
    loop {
        let (Some(url), Some(path)) = (read_push_url(), pending_path()) else {
            NOTIFY.get_or_init(tokio::sync::Notify::new).notified().await;
            continue;
        };

        let wake = NOTIFY.get_or_init(tokio::sync::Notify::new).notified();
        let pending = {
            let _guard = queue_lock().lock().await;
            load_pending(&path).await
        };
        let pending = match pending {
            Ok(entries) => entries,
            Err(error) => {
                log::warn!("Could not read pending community-cache writes: {error}");
                tokio::time::sleep(RETRY_COOLDOWN).await;
                continue;
            }
        };
        let now = tokio::time::Instant::now();
        blocked_until.retain(|asset, _| pending.contains_key(asset));
        let context = pending
            .iter()
            .find(|(asset, _)| blocked_until.get(*asset).map_or(true, |deadline| *deadline <= now))
            .map(|(asset_id, place_id)| RemoteAssetContext {
                asset_id: asset_id.clone(),
                place_id: place_id.clone(),
            });
        let Some(context) = context else {
            if pending.is_empty() {
                wake.await;
            } else {
                let delay = blocked_until
                    .values()
                    .filter_map(|deadline| deadline.checked_duration_since(now))
                    .min()
                    .unwrap_or(RETRY_COOLDOWN);
                tokio::select! { () = tokio::time::sleep(delay) => {}, () = wake => {} }
            }
            continue;
        };
        match write_remote_context(&crate::utils::get_http_client(), &url, &context, true).await {
            Ok(()) => {
                blocked_until.remove(&context.asset_id);
                let _guard = queue_lock().lock().await;
                match load_pending(&path).await {
                    Ok(mut current) => {
                        if current.get(&context.asset_id) == Some(&context.place_id) {
                            current.remove(&context.asset_id);
                            if let Err(error) = save_pending(&path, &current).await {
                                log::warn!(
                                    "Could not persist community-cache acknowledgement: {error}"
                                );
                            }
                        }
                    }
                    Err(error) => log::warn!("Could not reload community-cache queue: {error}"),
                }
            }
            Err(error) => {
                blocked_until
                    .insert(context.asset_id.clone(), tokio::time::Instant::now() + RETRY_COOLDOWN);

                if read_push_url().as_deref() == Some(url.as_str()) {
                    log::warn!("Could not contribute discovery {}: {error}", context.asset_id);
                }
            }
        }
    }
}

fn ensure_worker() {
    WORKER_STARTED.get_or_init(|| {
        tokio::spawn(run_writer());
    });
    notify_worker();
}

pub async fn queue_discoveries(
    app: &tauri::AppHandle,
    discoveries: HashMap<String, String>,
) -> Result<usize, String> {
    if read_push_url().is_none() || discoveries.is_empty() {
        return Ok(0);
    }
    use tauri::Manager;
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_dir.join("remote_cache_pending.json");
    set_pending_path(path.clone());
    let accepted = queue_entries(&path, discoveries).await?;
    if accepted > 0 {
        ensure_worker();
    }
    Ok(accepted)
}

#[tauri::command]
#[specta::specta]
pub async fn initialize_remote_cache(
    app: tauri::AppHandle,
    push_url: Option<String>,
) -> Result<(), String> {
    let push_url = push_url.map(|url| url.trim().to_string()).filter(|url| !url.is_empty());
    if let Some(ref url) = push_url {
        validate_cache_url(url)?;
    }
    set_push_url(push_url.clone());

    if push_url.is_none() {
        notify_worker();
        return Ok(());
    }
    use tauri::Manager;
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let pending_path = app_dir.join("remote_cache_pending.json");
    set_pending_path(pending_path.clone());

    let legacy = app_dir.join("local_remote_cache.json");
    let migrated = app_dir.join("local_remote_cache_migrated.lock");
    if !migrated.exists() {
        if let Ok(content) = tokio::fs::read_to_string(&legacy).await {
            match serde_json::from_str::<HashMap<String, String>>(&content) {
                Ok(entries) => {
                    let _guard = queue_lock().lock().await;
                    let mut pending = load_pending(&pending_path).await?;
                    for (asset_id, place_id) in entries {
                        if valid_id(&asset_id) && valid_id(&place_id) {
                            pending.entry(asset_id).or_insert(place_id);
                        } else {
                            log::warn!("Skipped an invalid legacy community-cache ID");
                        }
                    }
                    save_pending(&pending_path, &pending).await?;
                    tokio::fs::write(&migrated, b"queued")
                        .await
                        .map_err(|e| format!("Could not mark community-cache migration: {e}"))?;
                }
                Err(error) => {
                    log::warn!("Could not decode legacy community-cache entries: {error}")
                }
            }
        }
    }
    ensure_worker();
    Ok(())
}
