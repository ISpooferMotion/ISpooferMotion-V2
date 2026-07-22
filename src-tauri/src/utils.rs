//! Miscellaneous shared utility functions.
//!
//! Provides thread-safe HTTP client initialization, rate-limit header parsing,
//! file path sanitization, and generic error string extraction.

use log::warn;
use reqwest::Response;
use std::path::Path;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
// Cache the proxy client to maintain connection pooling.
static PROXY_CLIENT: OnceLock<std::sync::RwLock<(Option<String>, reqwest::Client)>> =
    OnceLock::new();

/// Builds a new generic reqwest client, optionally configuring a proxy.
fn build_client(proxy_url: Option<&str>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        // Use a 15-second timeout.
        .timeout(std::time::Duration::from_secs(15))
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .pool_max_idle_per_host(32);

    if let Some(url) = proxy_url {
        if !url.trim().is_empty() {
            if let Ok(proxy) = reqwest::Proxy::all(url.trim()) {
                builder = builder.proxy(proxy);
            }
        }
    }
    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

/// Returns a globally cached, thread-safe HTTP client with default settings.
pub fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| build_client(None))
}

/// Returns a cached HTTP client bound to the specified proxy URL.
///
/// If the proxy changes, the cached client is destroyed and rebuilt. This ensures
/// we do not leak connection pools while allowing the user to hot-swap proxy servers.
pub fn get_http_client_with_proxy(proxy_url: Option<&str>) -> reqwest::Client {
    let lock = PROXY_CLIENT.get_or_init(|| std::sync::RwLock::new((None, build_client(None))));

    if let Ok(read_guard) = lock.read() {
        if read_guard.0.as_deref() == proxy_url {
            return read_guard.1.clone();
        }
    }

    if let Ok(mut write_guard) = lock.write() {
        if write_guard.0.as_deref() == proxy_url {
            return write_guard.1.clone();
        }

        let new_client = build_client(proxy_url);
        write_guard.0 = proxy_url.map(std::string::ToString::to_string);
        write_guard.1 = new_client.clone();
        return new_client;
    }

    build_client(proxy_url)
}

/// Parses rate-limit headers to determine if we need to back off.
///
/// Returns the number of milliseconds to sleep if a limit was hit or the
/// `x-ratelimit-remaining` count fell dangerously low. If headers are missing
/// but the status is 429, this falls back to a standard exponential backoff.
#[must_use]
pub fn extract_retry_after(response: &reqwest::Response, attempt: Option<u32>) -> Option<u64> {
    let mut needs_wait = false;

    // Back off when rate limit is nearly empty (< 2 remaining).
    if let Some(remaining) = response.headers().get("x-ratelimit-remaining") {
        if let Ok(rem_str) = remaining.to_str() {
            if rem_str.parse::<i64>().is_ok_and(|n| n < 2) {
                needs_wait = true;
            }
        }
    }

    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        needs_wait = true;
    }

    if needs_wait {
        // Hard cap on server-suggested waits. Roblox occasionally returns
        // Retry-After values of an hour or more, which used to leave
        // individual asset tasks sleeping for that entire duration and
        // stalling the whole job (`for_each_concurrent` waits for every
        // future). 2 minutes is long enough for genuine rate-limit
        // windows to reset but short enough that a stuck task recovers.
        const MAX_RETRY_AFTER_MS: u64 = 120_000;

        if let Some(reset) = response.headers().get("x-ratelimit-reset") {
            if let Ok(reset_str) = reset.to_str() {
                if let Ok(reset_secs) = reset_str.parse::<u64>() {
                    if let Ok(now) =
                        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                    {
                        let now_secs = now.as_secs();
                        if reset_secs > now_secs {
                            let ms = (reset_secs - now_secs).saturating_mul(1000);
                            return Some(ms.min(MAX_RETRY_AFTER_MS));
                        }
                        // Reset time is in the past. Falling back to None lets
                        // the caller use its own default wait (typically 2s) —
                        // returning Some(0) here caused every caller's
                        // `.unwrap_or(2_000)` to be bypassed, producing an
                        // immediate-retry loop that spammed logs and freed no
                        // actual rate-limit budget.
                        return None;
                    }
                }
            }
        }

        // Fallback to standard Retry-After header.
        if let Some(retry) = response.headers().get("retry-after") {
            if let Ok(retry_str) = retry.to_str() {
                if let Ok(retry_secs) = retry_str.parse::<u64>() {
                    if retry_secs == 0 {
                        // Same rationale as x-ratelimit-reset above — a 0 wait
                        // triggers immediate retries that get 429'd again.
                        return None;
                    }
                    let ms = retry_secs.saturating_mul(1000);
                    return Some(ms.min(MAX_RETRY_AFTER_MS));
                }
            }
        }

        // Fallback to exponential backoff.
        let attempt = attempt.unwrap_or(1);
        let base_ms = 30_000.0;
        let exp_ms = base_ms * (1.5_f64).powi(attempt.saturating_sub(1) as i32);
        let capped = exp_ms.min(120_000.0) as u64;
        let jitter = rand::random::<u64>() % 2000;
        return Some(capped + jitter);
    }

    None
}

/// Formats a raw Roblox cookie value into a valid HTTP Cookie header string.
#[must_use]
pub fn build_roblox_cookie_header(cookie_value: &str) -> String {
    let normalized = normalize_roblox_cookie(cookie_value);
    if normalized.is_empty() {
        String::new()
    } else {
        format!(".ROBLOSECURITY={normalized}")
    }
}

/// Sanitizes raw Roblox cookie strings by stripping headers and quotes.
///
/// Users frequently paste cookies with the `.ROBLOSECURITY=` prefix or enclosed
/// in browser-specific quotes. This strips all of that away so we are left with
/// just the raw auth token.
#[must_use]
pub fn normalize_roblox_cookie(cookie_value: &str) -> String {
    let trimmed = cookie_value.trim().trim_matches(|c| c == '\'' || c == '"');

    let prefix = ".ROBLOSECURITY=";
    let normalized = if let Some(idx) = trimmed.find(prefix) {
        // Remove prefix and truncate at the first semicolon.
        let rest = &trimmed[idx + prefix.len()..];
        if let Some(end_idx) = rest.find(';') {
            &rest[..end_idx]
        } else {
            rest
        }
    } else {
        trimmed
    };

    normalized.trim().to_string()
}

/// Sanitizes file names by replacing invalid characters with underscores.
///
/// Prevents path traversal or OS-level file creation errors when saving
/// assets downloaded from Roblox (since user-generated asset names can contain
/// arbitrary characters).
#[must_use]
pub fn sanitize_filename(filename: &str) -> String {
    let mut safe = String::new();
    for c in filename.chars() {
        // Use a match arm so the compiler emits a jump table - O(1) per char vs O(n) string scan.
        if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\x00'..='\x1F') {
            safe.push('_');
        } else {
            safe.push(c);
        }
    }

    // Remove trailing dots or whitespace to satisfy Windows path rules.
    let trimmed = safe.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        // Truncate file name.
        trimmed.chars().take(180).collect()
    }
}

/// Recursively deletes all files and folders inside the given directory path.
///
/// Used to wipe the `downloads` cache before a new patching run starts.
pub async fn clear_downloads_directory(dir_path: &Path) -> Result<bool, String> {
    if !dir_path.exists() {
        if let Err(e) = tokio::fs::create_dir_all(dir_path).await {
            return Err(format!("Failed to create directory: {e}"));
        }
        return Ok(true);
    }

    match tokio::fs::read_dir(dir_path).await {
        Ok(mut entries) => {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.is_file() {
                    let _ = tokio::fs::remove_file(path).await;
                } else if path.is_dir() {
                    let _ = tokio::fs::remove_dir_all(path).await;
                }
            }
            Ok(true)
        }
        Err(e) => {
            warn!("Error reading directory {}: {}", dir_path.display(), e);
            Err(e.to_string())
        }
    }
}

/// Detects updated cookies provided mid-request and synchronizes them with the frontend.
///
/// Roblox occasionally rotates the `.ROBLOSECURITY` token via a `Set-Cookie` header
/// on API responses. This catches the new token and immediately blasts it to the React
/// UI so the user does not get silently logged out.
pub fn check_for_roblosecurity_update(app: &AppHandle, resp: &Response, original_cookie: &str) {
    let original_val = original_cookie.strip_prefix(".ROBLOSECURITY=").unwrap_or(original_cookie);

    for val in &resp.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(cookie_str) = val.to_str() {
            if let Some(rest) = cookie_str.strip_prefix(".ROBLOSECURITY=") {
                // Truncate at the first semicolon to isolate the token value.
                let new_cookie = rest.split_once(';').map_or(rest, |(v, _)| v);
                if !new_cookie.is_empty() && new_cookie != original_val {
                    let _ = app.emit("roblosecurity-updated", new_cookie);
                }
            }
        }
    }
}

/// Digs through an arbitrary JSON error payload to find a human-readable message.
///
/// Different Roblox endpoints return errors in wildly different JSON structures
/// (`errors[0].message`, `userFacingMessage`, plain strings, etc). This attempts
/// to gracefully extract the most relevant string for the user.
pub fn extract_human_error(err_val: &serde_json::Value, status: Option<u16>) -> String {
    extract_human_error_inner(err_val, status, 0)
}

fn extract_human_error_inner(
    err_val: &serde_json::Value,
    status: Option<u16>,
    depth: u8,
) -> String {
    if let Some(err_str) = err_val.as_str() {
        return err_str.to_string();
    }

    if let Some(errors) = err_val.get("errors").and_then(|e| e.as_array()) {
        if let Some(first_err) = errors.first() {
            if let Some(msg) = first_err.get("message").and_then(|m| m.as_str()) {
                if !msg.trim().is_empty() {
                    return msg.to_string();
                }
            }
            if let Some(msg) = first_err.get("userFacingMessage").and_then(|m| m.as_str()) {
                if !msg.trim().is_empty() {
                    return msg.to_string();
                }
            }
        }
    }

    if let Some(msg) = err_val.get("message").and_then(|m| m.as_str()) {
        if !msg.trim().is_empty() {
            return msg.to_string();
        }
    }

    if let Some(msg) = err_val.get("userFacingMessage").and_then(|m| m.as_str()) {
        if !msg.trim().is_empty() {
            return msg.to_string();
        }
    }

    // Limit recursion depth to prevent stack overflow on adversarial input.
    if depth < 3 {
        if let Some(obj) = err_val.as_object() {
            for (_, value) in obj {
                let nested = extract_human_error_inner(value, None, depth + 1);
                if !nested.starts_with("HTTP ") && nested != "Unknown error occurred" {
                    return nested;
                }
            }
        }
    }

    if let Some(code) = status {
        return format!("HTTP {code}");
    }

    "Unknown error occurred".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("valid_name.txt"), "valid_name.txt");
        assert_eq!(sanitize_filename("invalid<name>.txt"), "invalid_name_.txt");
        assert_eq!(sanitize_filename("test?file*name.txt"), "test_file_name.txt");
        assert_eq!(sanitize_filename(".."), "untitled");
    }

    #[test]
    fn test_normalize_roblox_cookie() {
        assert_eq!(normalize_roblox_cookie("cookie_value"), "cookie_value");
        assert_eq!(
            normalize_roblox_cookie(
                ".ROBLOSECURITY=_|WARNING:-DO-NOT-SHARE-THIS|_; domain=.roblox.com"
            ),
            "_|WARNING:-DO-NOT-SHARE-THIS|_"
        );
        assert_eq!(
            normalize_roblox_cookie("'_|WARNING:-DO-NOT-SHARE-THIS|_'"),
            "_|WARNING:-DO-NOT-SHARE-THIS|_"
        );
    }
}
