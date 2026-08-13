#![allow(clippy::wildcard_imports, clippy::too_many_lines, clippy::missing_errors_doc)]

pub mod inspector;

use crate::utils::{build_roblox_cookie_header, sanitize_filename};
use reqwest::header::{CONTENT_LENGTH, COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;
use uuid::Uuid;

static CIRCUIT_BREAKER: Mutex<Option<Instant>> = Mutex::new(None);
static RATE_LIMIT_BUCKETS: OnceLock<dashmap::DashMap<&'static str, Instant>> = OnceLock::new();
static RATE_LIMIT_LOG_TIMES: OnceLock<dashmap::DashMap<&'static str, Instant>> = OnceLock::new();

/// Per-channel throttle for user-facing rate-limit warnings.
///
/// Roblox 429s during a batch operation can produce dozens of retry attempts
/// in quick succession. Logging each one flooded the output panel with the
/// same 'Roblox rate limited... 2.0s' line and made the app look broken.
/// This helper returns `true` at most once every 20 seconds per `channel`
/// key, so we log the first hit and stay quiet during the retry storm.
pub fn should_log_rate_limit_warning(channel: &'static str) -> bool {
    let map = RATE_LIMIT_LOG_TIMES.get_or_init(dashmap::DashMap::new);
    let now = Instant::now();
    let cutoff = Duration::from_secs(20);
    let mut allow = true;
    map.entry(channel)
        .and_modify(|last| {
            if now.duration_since(*last) < cutoff {
                allow = false;
            } else {
                *last = now;
            }
        })
        .or_insert(now);
    allow
}

static ASSET_CACHE: std::sync::OnceLock<
    dashmap::DashMap<String, dashmap::DashMap<String, String>>,
> = std::sync::OnceLock::new();
static ADAPTIVE_LIMITER: std::sync::OnceLock<AdaptiveLimiter> = std::sync::OnceLock::new();
static ROBLOX_GAME_IDS: std::sync::OnceLock<dashmap::DashMap<String, String>> =
    std::sync::OnceLock::new();

// Independent buckets for throttling uploads, downloads, and scrapes.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum RateLimitBucket {
    Upload,
    OperationPoll,
    DownloadResolution,
    AssetDownload,
    PlaceLookup,
    AssetResolve,
}

impl RateLimitBucket {
    const fn name(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::OperationPoll => "operation_poll",
            Self::DownloadResolution => "download_resolution",
            Self::AssetDownload => "asset_download",
            Self::PlaceLookup => "place_lookup",
            Self::AssetResolve => "asset_resolve",
        }
    }
}

fn get_asset_cache() -> &'static dashmap::DashMap<String, dashmap::DashMap<String, String>> {
    ASSET_CACHE.get_or_init(dashmap::DashMap::new)
}

fn rate_limit_buckets() -> &'static dashmap::DashMap<&'static str, Instant> {
    RATE_LIMIT_BUCKETS.get_or_init(dashmap::DashMap::new)
}

fn is_valid_numeric_id(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|character| character.is_ascii_digit())
}

// Adaptive concurrency limiter that adjusts based on API rejection rates.
struct AdaptiveLimiter {
    max: AtomicUsize,
    current: AtomicUsize,
    success_streak: AtomicUsize,
    blocked_until: Mutex<Option<Instant>>,
    semaphore: Semaphore,
}

impl AdaptiveLimiter {
    fn new(max: usize) -> Self {
        Self {
            max: AtomicUsize::new(max),
            current: AtomicUsize::new(max),
            success_streak: AtomicUsize::new(0),
            blocked_until: Mutex::new(None),
            semaphore: Semaphore::new(max),
        }
    }
}

pub struct AdaptivePermit {
    limiter: &'static AdaptiveLimiter,
}

impl Drop for AdaptivePermit {
    fn drop(&mut self) {
        self.limiter.semaphore.add_permits(1);
    }
}

fn adaptive_limiter() -> &'static AdaptiveLimiter {
    ADAPTIVE_LIMITER.get_or_init(|| AdaptiveLimiter::new(5))
}

pub fn configure_adaptive_concurrency(max_concurrency: usize) {
    let max = max_concurrency.clamp(1, 100);
    let limiter = adaptive_limiter();
    limiter.max.store(max, Ordering::Release);

    // Start with a conservative baseline to prevent initial rate limiting.
    let start = max.min(3);
    limiter.current.store(start, Ordering::Release);

    limiter.success_streak.store(0, Ordering::Release);
    if let Ok(mut guard) = limiter.blocked_until.lock() {
        *guard = None;
    }

    // We don't restore permits here because they are restored when permits drop or when success increases.
}

pub async fn acquire_adaptive_permit() -> AdaptivePermit {
    let limiter = adaptive_limiter();
    loop {
        let blocked_until = limiter.blocked_until.lock().ok().and_then(|guard| *guard);
        if let Some(until) = blocked_until {
            let now = Instant::now();
            if until > now {
                tokio::time::sleep_until(tokio::time::Instant::from_std(until)).await;
                continue;
            }
        }

        let permit = limiter
            .semaphore
            .acquire()
            .await
            .expect("AdaptiveLimiter semaphore should never be closed");

        let blocked_until = limiter.blocked_until.lock().ok().and_then(|guard| *guard);
        if let Some(until) = blocked_until {
            let now = Instant::now();
            if until > now {
                permit.forget();
                limiter.semaphore.add_permits(1);
                tokio::time::sleep_until(tokio::time::Instant::from_std(until)).await;
                continue;
            }
        }

        permit.forget();
        return AdaptivePermit { limiter };
    }
}

pub fn record_adaptive_success() {
    let limiter = adaptive_limiter();
    let limit = limiter.current.load(Ordering::Acquire);
    let max = limiter.max.load(Ordering::Acquire);
    if limit >= max {
        return;
    }

    let streak = limiter.success_streak.fetch_add(1, Ordering::AcqRel) + 1;
    if streak >= limit.max(1) {
        limiter.success_streak.store(0, Ordering::Release);
        if limiter
            .current
            .compare_exchange(limit, (limit + 1).min(max), Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
            && limit < max
        {
            limiter.semaphore.add_permits(1);
        }
    }
}

pub fn record_adaptive_rate_limit(retry_after_ms: Option<u64>) {
    let limiter = adaptive_limiter();
    let current = limiter.current.load(Ordering::Acquire).max(1);
    let next = (current / 2).max(1);
    if limiter.current.compare_exchange(current, next, Ordering::AcqRel, Ordering::Acquire).is_ok()
    {
        let diff = current - next;
        if diff > 0 {
            tokio::spawn(async move {
                if let Ok(permits) = limiter.semaphore.acquire_many(diff as u32).await {
                    permits.forget();
                }
            });
        }
    }

    limiter.success_streak.store(0, Ordering::Release);

    if let Some(retry_after_ms) = retry_after_ms {
        let capped_ms = retry_after_ms.clamp(500, 60_000);
        let next_until = Instant::now() + Duration::from_millis(capped_ms);
        if let Ok(mut guard) = limiter.blocked_until.lock() {
            if guard.map_or(true, |until| next_until > until) {
                *guard = Some(next_until);
            }
        }
    }
}

pub fn record_explicit_rate_limit(reset_in_ms: u64) {
    let limiter = adaptive_limiter();
    let capped_ms = reset_in_ms.clamp(500, 120_000);
    let next_until = Instant::now() + Duration::from_millis(capped_ms);
    if let Ok(mut guard) = limiter.blocked_until.lock() {
        if guard.map_or(true, |until| next_until > until) {
            *guard = Some(next_until);
        }
    }
}

pub fn record_adaptive_server_error() {
    let limiter = adaptive_limiter();
    let current = limiter.current.load(Ordering::Acquire).max(1);
    let next = current.saturating_sub(1).max(1);
    if limiter.current.compare_exchange(current, next, Ordering::AcqRel, Ordering::Acquire).is_ok()
    {
        let diff = current - next;
        if diff > 0 {
            tokio::spawn(async move {
                if let Ok(permits) = limiter.semaphore.acquire_many(diff as u32).await {
                    permits.forget();
                }
            });
        }
    }
    limiter.success_streak.store(0, Ordering::Release);
}

#[derive(Clone)]
struct RobloxGameContext {
    place_id: String,
    game_id: String,
    session_id: String,
}

fn game_ids_by_place() -> &'static dashmap::DashMap<String, String> {
    ROBLOX_GAME_IDS.get_or_init(dashmap::DashMap::new)
}

// Emulate a Studio session for a specific game to access copylocked assets.
fn roblox_game_context(place_id: Option<&str>) -> Option<RobloxGameContext> {
    let place_id =
        place_id.map(str::trim).filter(|value| is_valid_numeric_id(value) && *value != "0")?;
    let game_id = {
        let cache = game_ids_by_place();
        cache
            .entry(place_id.to_string())
            .or_insert_with(|| Uuid::new_v4().to_string())
            .value()
            .clone()
    };
    let session_id = serde_json::json!({
        "SessionId": game_id,
        "GameId": game_id,
        "PlaceId": place_id.parse::<u64>().ok()?,
    })
    .to_string();

    Some(RobloxGameContext { place_id: place_id.to_string(), game_id, session_id })
}

pub fn apply_roblox_game_context(
    mut builder: reqwest::RequestBuilder,
    place_id: Option<&str>,
    universe_id: Option<&str>,
) -> reqwest::RequestBuilder {
    if let Some(context) = roblox_game_context(place_id) {
        builder = builder
            .header("Roblox-Place-Id", context.place_id)
            .header("Roblox-Game-Id", context.game_id)
            .header("Roblox-Session-Id", context.session_id);
    }
    if let Some(uid) = universe_id.filter(|value| is_valid_numeric_id(value)) {
        builder = builder.header("Roblox-Universe-Id", uid);
    }
    builder
}

#[derive(Clone)]
enum UploadAuth {
    ApiKey(String),
    #[allow(dead_code)]
    Cookie {
        token: String,
    },
}

fn apply_upload_auth(
    builder: reqwest::RequestBuilder,
    auth: &UploadAuth,
) -> reqwest::RequestBuilder {
    match auth {
        UploadAuth::ApiKey(api_key) => builder.header("x-api-key", api_key),
        UploadAuth::Cookie { token } => builder.header("x-csrf-token", token),
    }
}

// Pause task execution upon rate limits; respect global circuit breakers.
pub(crate) async fn wait_rate_limit(bucket: RateLimitBucket) {
    let wait_dur = {
        let mut max_until: Option<Instant> = None;
        let now = Instant::now();
        let bucket_name = bucket.name();

        if let Some(until) = rate_limit_buckets().get(bucket_name).map(|entry| *entry.value()) {
            if until > now {
                max_until = Some(until);
            } else {
                rate_limit_buckets().remove(bucket_name);
            }
        }

        if let Ok(guard) = CIRCUIT_BREAKER.lock() {
            if let Some(until) = *guard {
                if until > now && max_until.map_or(true, |current| until > current) {
                    max_until = Some(until);
                }
            }
        }

        max_until.map(|until| until - now)
    };
    if let Some(dur) = wait_dur {
        let jitter = rand::random::<u64>() % 500;
        let dur_with_jitter = dur + Duration::from_millis(jitter);
        tokio::time::sleep(dur_with_jitter).await;
    }
}

pub(crate) fn set_rate_limit(bucket: RateLimitBucket, dur: Duration) {
    let next_until = Instant::now() + dur;
    let mut entry = rate_limit_buckets().entry(bucket.name()).or_insert(next_until);
    if next_until > *entry {
        *entry = next_until;
    }
}

pub fn set_circuit_breaker(dur: Duration) {
    if let Ok(mut guard) = CIRCUIT_BREAKER.lock() {
        let new_until = Instant::now() + dur;

        if let Some(existing) = *guard {
            if new_until > existing {
                *guard = Some(new_until);
            }
        } else {
            *guard = Some(new_until);
        }
    }
}

#[derive(Serialize, Deserialize)]
struct RobloxOperationResponse {
    pub done: Option<bool>,
    pub path: Option<String>,
    pub response: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
}

#[derive(Serialize, Clone)]
pub struct TransferUpdate {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_asset_id: Option<String>,
}

fn emit_transfer_update(app: &AppHandle, payload: TransferUpdate) {
    let _ = app.emit("transfer-update", payload);
}

#[derive(Serialize)]
pub struct DownloadResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_place_id: Option<String>,
}

#[derive(Serialize)]
pub struct PublishResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BatchAssetRequest {
    #[serde(rename = "assetName")]
    pub asset_name: String,
    #[serde(rename = "assetType")]
    pub asset_type: String,
    #[serde(rename = "assetId")]
    pub asset_id: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "placeId")]
    pub place_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "serverPlaceId")]
    pub server_place_id: Option<i64>,
    #[serde(rename = "clientInsert")]
    pub client_insert: bool,
    #[serde(rename = "scriptInsert")]
    pub script_insert: bool,
}

#[tauri::command]
#[specta::specta]
pub fn clear_asset_cache() {
    get_asset_cache().clear();
}

pub mod diagnostics;
pub mod download;
pub mod memory;
pub mod permissions;
pub mod place;
pub mod remote_cache;
pub mod upload;

pub use download::{batch_get_download_urls_for_assets, download_animation_asset_with_progress};
pub use memory::{find_studio_process, focus_and_save_studio, scan_and_replace_multiple_strings};
pub use permissions::{patch_asset_permissions, set_asset_privacy};
pub use place::{
    clear_downloads_directory_command, find_asset_by_name, get_asset_creator_for_asset,
    get_multiple_place_ids, get_place_id_from_creator, get_place_id_from_universe_id,
    get_universe_id_from_place_id, parse_excluded_id_list, search_global_places,
    should_skip_asset_for_spoofing,
};
pub use remote_cache::initialize_remote_cache;
pub use upload::publish_asset_with_progress;

#[cfg(test)]
mod tests {
    use super::{roblox_game_context, RateLimitBucket};
    use std::collections::HashSet;

    #[test]
    fn rate_limit_bucket_names_are_distinct() {
        let buckets = [
            RateLimitBucket::Upload,
            RateLimitBucket::OperationPoll,
            RateLimitBucket::DownloadResolution,
            RateLimitBucket::AssetDownload,
            RateLimitBucket::PlaceLookup,
            RateLimitBucket::AssetResolve,
        ];
        let mut names = HashSet::new();
        assert!(buckets.into_iter().all(|bucket| names.insert(bucket.name())));
    }

    #[test]
    fn roblox_game_context_requires_real_place_id() {
        assert!(roblox_game_context(None).is_none());
        assert!(roblox_game_context(Some("0")).is_none());
        assert!(roblox_game_context(Some("not-a-place")).is_none());
    }

    #[test]
    fn roblox_game_context_is_stable_per_place() -> Result<(), String> {
        let first = roblox_game_context(Some("123456789")).ok_or("valid place context")?;
        let second = roblox_game_context(Some("123456789")).ok_or("valid place context")?;
        assert_eq!(first.place_id, "123456789");
        assert_eq!(first.game_id, second.game_id);
        assert!(first.session_id.contains("\"PlaceId\":123456789"));
        assert!(first.session_id.contains("\"GameId\""));
        Ok(())
    }
}
