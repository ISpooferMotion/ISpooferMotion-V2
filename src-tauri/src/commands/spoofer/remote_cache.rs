use dashmap::DashMap;
use serde::{Deserialize, Deserializer, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

const MAX_WRITE_ATTEMPTS: usize = 3;
const BASE_RETRY_DELAY_MS: u64 = 250;

#[derive(Clone, Debug)]
pub struct CachedContext {
    pub place_id: String,
    pub is_invalidated: bool,
}

// The push URL is write-only: we POST discoveries to it, we never GET from it.
static PUSH_URL: OnceLock<std::sync::RwLock<Option<String>>> = OnceLock::new();

fn get_push_url_lock() -> &'static std::sync::RwLock<Option<String>> {
    PUSH_URL.get_or_init(|| std::sync::RwLock::new(None))
}

// Internal-only: exposes the configured push URL for use within push_discovery.
// Not pub - nothing outside this module should ever branch on the remote URL value.
fn read_push_url() -> Option<String> {
    get_push_url_lock().read().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
}

fn set_push_url(push_url: Option<String>) {
    let mut guard = get_push_url_lock().write().unwrap_or_else(std::sync::PoisonError::into_inner);
    *guard = push_url;
}

// The local in-process cache. This is the ONLY data source for read lookups.
static LOCAL_CACHE: OnceLock<DashMap<String, CachedContext>> = OnceLock::new();

fn get_local_cache() -> &'static DashMap<String, CachedContext> {
    LOCAL_CACHE.get_or_init(DashMap::new)
}

/// Read a place ID from the **local** session cache only.
/// Never reads from the remote community API - see module-level comment.
pub fn get_local_context(asset_id: &str) -> Option<String> {
    let cache = get_local_cache();
    if let Some(entry) = cache.get(asset_id) {
        if !entry.is_invalidated {
            return Some(entry.place_id.clone());
        }
    }
    None
}

pub fn invalidate_context(asset_id: &str) {
    let cache = get_local_cache();
    if let Some(mut entry) = cache.get_mut(asset_id) {
        entry.is_invalidated = true;
    }
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
            // Cache contributions must not hold a completed spoofing job open indefinitely.
            return Duration::from_millis(delay_ms.min(30_000));
        }
    }

    let exponent = u32::try_from(attempt.saturating_sub(1)).unwrap_or(u32::MAX).min(8);
    Duration::from_millis(BASE_RETRY_DELAY_MS.saturating_mul(2_u64.pow(exponent)))
}

async fn write_remote_context(
    client: &reqwest::Client,
    url: &str,
    context: &RemoteAssetContext,
    require_active_url: bool,
) -> Result<(), String> {
    for attempt in 1..=MAX_WRITE_ATTEMPTS {
        if require_active_url && read_push_url().as_deref() != Some(url) {
            return Err(
                "community cache write cancelled because contributions were disabled".into()
            );
        }

        match client.post(url).json(context).send().await {
            Ok(response) if response.status().is_success() => return Ok(()),
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

pub async fn push_discovery(asset_id: String, place_id: String) -> Result<(), String> {
    let cache = get_local_cache();
    cache.insert(
        asset_id.clone(),
        CachedContext { place_id: place_id.clone(), is_invalidated: false },
    );

    // Simple eviction: if the cache grows above 50k entries, drop the oldest-iterated 10k.
    // Note: DashMap iteration order is unspecified, so this is not true LRU.
    if cache.len() > 50_000 {
        let to_remove: Vec<String> = cache.iter().take(10_000).map(|e| e.key().clone()).collect();
        for key in to_remove {
            cache.remove(&key);
        }
    }

    let Some(url) = read_push_url().filter(|url| !url.is_empty()) else {
        return Ok(());
    };

    let context = RemoteAssetContext { asset_id, place_id };
    write_remote_context(crate::utils::get_http_client(), &url, &context, true).await
}

#[tauri::command]
#[specta::specta]
/// Configure the push URL for the community asset cache.
///
/// This sets the endpoint that newly discovered (asset_id, place_id) pairs are POSTed to.
/// Reading from the community cache is explicitly NOT supported - users resolve assets
/// from their own local session cache only.
pub async fn initialize_remote_cache(
    app: tauri::AppHandle,
    push_url: Option<String>,
) -> Result<(), String> {
    let push_url = push_url.map(|url| url.trim().to_string()).filter(|url| !url.is_empty());

    if let Some(ref pu) = push_url {
        validate_cache_url(pu)?;
    }

    // Update this before starting migrations so disabling telemetry also
    // cancels queued attempts and retries that still hold an older URL.
    set_push_url(push_url.clone());

    if let Some(ref pu) = push_url {
        use tauri::Manager;
        if let Ok(app_dir) = app.path().app_data_dir() {
            let cache_path = app_dir.join("local_remote_cache.json");
            let migrated_lock_path = app_dir.join("local_remote_cache_migrated.lock");

            // Only process the historical cache ONCE. If the lock file exists, skip.
            if !migrated_lock_path.exists() {
                if let Ok(content) = tokio::fs::read_to_string(&cache_path).await {
                    if let Ok(existing) =
                        serde_json::from_str::<std::collections::HashMap<String, String>>(&content)
                    {
                        let pu_clone = pu.clone();
                        tokio::spawn(async move {
                            let client = crate::utils::get_http_client();
                            let mut migration_succeeded = true;
                            for (asset_id, place_id) in existing {
                                let context = RemoteAssetContext { asset_id, place_id };
                                if let Err(error) =
                                    write_remote_context(client, &pu_clone, &context, true).await
                                {
                                    migration_succeeded = false;
                                    log::warn!("Failed to migrate community-cache entry: {error}");
                                    if read_push_url().as_deref() != Some(pu_clone.as_str()) {
                                        break;
                                    }
                                }

                                tokio::time::sleep(Duration::from_millis(50)).await;
                            }

                            if migration_succeeded {
                                // Only mark migration complete once every entry was accepted.
                                if let Err(error) =
                                    tokio::fs::write(&migrated_lock_path, "migrated").await
                                {
                                    log::warn!(
                                        "Community-cache migration completed but its lock file could not be written: {error}"
                                    );
                                }
                            } else {
                                log::warn!(
                                    "Community-cache migration was incomplete; it will retry next startup"
                                );
                            }
                        });
                    }
                }
            } // End of migrated_lock_path.exists()
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::{Json, State},
        http::StatusCode,
        routing::post,
        Router,
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };

    #[derive(Clone)]
    struct TestState {
        attempts: Arc<AtomicUsize>,
        contexts: Arc<Mutex<Vec<RemoteAssetContext>>>,
        fail_attempts: usize,
        failure_status: StatusCode,
    }

    async fn cache_handler(
        State(state): State<TestState>,
        Json(context): Json<RemoteAssetContext>,
    ) -> StatusCode {
        state.contexts.lock().expect("contexts lock").push(context);
        let attempt = state.attempts.fetch_add(1, Ordering::SeqCst) + 1;
        if attempt <= state.fail_attempts {
            state.failure_status
        } else {
            StatusCode::NO_CONTENT
        }
    }

    async fn test_server(fail_attempts: usize, failure_status: StatusCode) -> (String, TestState) {
        let state = TestState {
            attempts: Arc::new(AtomicUsize::new(0)),
            contexts: Arc::new(Mutex::new(Vec::new())),
            fail_attempts,
            failure_status,
        };
        let app = Router::new().route("/", post(cache_handler)).with_state(state.clone());
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve test requests");
        });
        (format!("http://{address}/"), state)
    }

    #[tokio::test]
    async fn remote_write_posts_expected_context() {
        let (url, state) = test_server(0, StatusCode::INTERNAL_SERVER_ERROR).await;
        let context = RemoteAssetContext {
            asset_id: "123456789".to_string(),
            place_id: "987654321".to_string(),
        };

        write_remote_context(&reqwest::Client::new(), &url, &context, false)
            .await
            .expect("write should succeed");

        assert_eq!(state.attempts.load(Ordering::SeqCst), 1);
        assert_eq!(*state.contexts.lock().expect("contexts lock"), vec![context]);
    }

    #[tokio::test]
    async fn remote_write_retries_transient_server_errors() {
        let (url, state) = test_server(2, StatusCode::SERVICE_UNAVAILABLE).await;
        let context = RemoteAssetContext {
            asset_id: "123456789".to_string(),
            place_id: "987654321".to_string(),
        };

        write_remote_context(&reqwest::Client::new(), &url, &context, false)
            .await
            .expect("third write should succeed");

        assert_eq!(state.attempts.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn remote_write_does_not_retry_permanent_client_errors() {
        let (url, state) = test_server(MAX_WRITE_ATTEMPTS, StatusCode::BAD_REQUEST).await;
        let context = RemoteAssetContext {
            asset_id: "123456789".to_string(),
            place_id: "987654321".to_string(),
        };

        let error = write_remote_context(&reqwest::Client::new(), &url, &context, false)
            .await
            .expect_err("client error should fail");

        assert!(error.contains("HTTP 400"));
        assert_eq!(state.attempts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn cache_url_requires_https_except_for_exact_loopback_hosts() {
        assert!(validate_cache_url("https://cache.example.com/write").is_ok());
        assert!(validate_cache_url("http://localhost:3000/write").is_ok());
        assert!(validate_cache_url("http://127.0.0.1:3000/write").is_ok());
        assert!(validate_cache_url("http://[::1]:3000/write").is_ok());

        assert!(validate_cache_url("http://cache.example.com/write").is_err());
        assert!(validate_cache_url("http://localhost.example.com/write").is_err());
        assert!(validate_cache_url("not a URL").is_err());
    }
}
