use log::warn;
use reqwest::Response;
use std::path::Path;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static LOCAL_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

static EXPLICIT_PROXY: OnceLock<std::sync::RwLock<Option<String>>> = OnceLock::new();

static PROXY_CLIENT: OnceLock<std::sync::RwLock<(Option<String>, reqwest::Client)>> =
    OnceLock::new();

pub fn set_explicit_proxy(url: Option<String>) {
    let lock = EXPLICIT_PROXY.get_or_init(|| std::sync::RwLock::new(None));
    if let Ok(mut guard) = lock.write() {
        let normalized = url.and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
        *guard = normalized;
    }
}

fn effective_proxy_url() -> Option<String> {
    if let Some(lock) = EXPLICIT_PROXY.get() {
        if let Ok(guard) = lock.read() {
            if let Some(url) = guard.as_ref() {
                return Some(url.clone());
            }
        }
    }
    system_proxy()
}

pub fn effective_reqwest_proxy() -> Option<reqwest::Proxy> {
    let url = effective_proxy_url()?;
    reqwest::Proxy::all(&url).ok()
}

pub fn build_client_with_timeout(timeout: std::time::Duration) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .timeout(timeout)
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .pool_max_idle_per_host(32);
    if let Some(proxy) = effective_reqwest_proxy() {
        builder = builder.proxy(proxy);
    }
    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

fn build_client(proxy_url: Option<&str>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
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

pub fn get_http_client() -> reqwest::Client {
    let proxy = effective_proxy_url();
    let lock = PROXY_CLIENT.get_or_init(|| std::sync::RwLock::new((None, build_client(None))));

    if let Ok(read_guard) = lock.read() {
        if read_guard.0.as_deref() == proxy.as_deref() {
            return read_guard.1.clone();
        }
    }

    if let Ok(mut write_guard) = lock.write() {
        if write_guard.0.as_deref() == proxy.as_deref() {
            return write_guard.1.clone();
        }
        let new_client = build_client(proxy.as_deref());
        write_guard.0 = proxy;
        write_guard.1 = new_client.clone();
        return new_client;
    }

    build_client(proxy.as_deref())
}

pub fn get_local_http_client() -> &'static reqwest::Client {
    LOCAL_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(15))
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

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

#[cfg(windows)]
fn system_proxy() -> Option<String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD,
        REG_EXPAND_SZ, REG_SZ,
    };

    fn encw(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let subkey = encw("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");
    let enable_name = encw("ProxyEnable");
    let server_name = encw("ProxyServer");

    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) != 0 {
            return None;
        }

        let mut enabled: u32 = 0;
        let mut enabled_len: u32 = 4;
        let mut enabled_type: u32 = 0;
        let _ = RegQueryValueExW(
            hkey,
            enable_name.as_ptr(),
            std::ptr::null_mut(),
            &mut enabled_type,
            &mut enabled as *mut u32 as *mut u8,
            &mut enabled_len,
        );
        let proxy_enabled = enabled_type == REG_DWORD && enabled != 0;

        let mut server: Option<String> = None;
        if proxy_enabled {
            let mut buf = [0u16; 512];
            let mut buf_len: u32 = (buf.len() * 2) as u32;
            let mut server_type: u32 = 0;
            if RegQueryValueExW(
                hkey,
                server_name.as_ptr(),
                std::ptr::null_mut(),
                &mut server_type,
                buf.as_mut_ptr() as *mut u8,
                &mut buf_len,
            ) == 0
                && (server_type == REG_SZ || server_type == REG_EXPAND_SZ)
            {
                let nul = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                let raw = String::from_utf16_lossy(&buf[..nul]);
                server = parse_wininet_proxy(&raw);
            }
        }

        RegCloseKey(hkey);
        server
    }
}

fn parse_wininet_proxy(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    let entry = if raw.contains('=') {
        raw.split(';').find_map(|part| {
            let (key, val) = part.split_once('=')?;
            let val = val.trim();
            if val.is_empty() {
                return None;
            }
            let key = key.trim();
            if key.eq_ignore_ascii_case("https") || key.eq_ignore_ascii_case("http") {
                Some(val)
            } else {
                None
            }
        })
    } else {
        Some(raw)
    };

    entry.map(|addr| if addr.contains("://") { addr.to_string() } else { format!("http://{addr}") })
}

#[cfg(not(windows))]
fn system_proxy() -> Option<String> {
    None
}

#[must_use]
pub fn extract_retry_after(response: &reqwest::Response, attempt: Option<u32>) -> Option<u64> {
    let mut needs_wait = false;

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

                        return None;
                    }
                }
            }
        }

        if let Some(retry) = response.headers().get("retry-after") {
            if let Ok(retry_str) = retry.to_str() {
                if let Ok(retry_secs) = retry_str.parse::<u64>() {
                    if retry_secs == 0 {
                        return None;
                    }
                    let ms = retry_secs.saturating_mul(1000);
                    return Some(ms.min(MAX_RETRY_AFTER_MS));
                }
            }
        }

        let attempt = attempt.unwrap_or(1);
        let base_ms = 30_000.0;
        let exp_ms = base_ms * (1.5_f64).powi(attempt.saturating_sub(1) as i32);
        let capped = exp_ms.min(120_000.0) as u64;
        let jitter = rand::random::<u64>() % 2000;
        return Some(capped + jitter);
    }

    None
}

#[must_use]
pub fn build_roblox_cookie_header(cookie_value: &str) -> String {
    let normalized = normalize_roblox_cookie(cookie_value);
    if normalized.is_empty() {
        String::new()
    } else {
        format!(".ROBLOSECURITY={normalized}")
    }
}

#[must_use]
pub fn normalize_roblox_cookie(cookie_value: &str) -> String {
    let trimmed = cookie_value.trim().trim_matches(|c| c == '\'' || c == '"');

    let prefix = ".ROBLOSECURITY=";
    let normalized = if let Some(idx) = trimmed.find(prefix) {
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

#[must_use]
pub fn sanitize_filename(filename: &str) -> String {
    let mut safe = String::new();
    for c in filename.chars() {
        if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\x00'..='\x1F') {
            safe.push('_');
        } else {
            safe.push(c);
        }
    }

    let trimmed = safe.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

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

pub fn check_for_roblosecurity_update(app: &AppHandle, resp: &Response, original_cookie: &str) {
    let original_val = original_cookie.strip_prefix(".ROBLOSECURITY=").unwrap_or(original_cookie);

    for val in &resp.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(cookie_str) = val.to_str() {
            if let Some(rest) = cookie_str.strip_prefix(".ROBLOSECURITY=") {
                let new_cookie = rest.split_once(';').map_or(rest, |(v, _)| v);
                if !new_cookie.is_empty() && new_cookie != original_val {
                    let _ = app.emit("roblosecurity-updated", new_cookie);
                }
            }
        }
    }
}

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

    if depth < 3 {
        if let Some(obj) = err_val.as_object() {
            for (_, value) in obj {
                let nested = extract_human_error_inner(value, None, depth + 1);
                if !nested.starts_with("HTTP ")
                    && nested != "An unexpected error occurred. Please verify your connection and try again."
                {
                    return nested;
                }
            }
        }
    }

    if let Some(code) = status {
        return match code {
            401 => "Your Roblox session or cookie has expired. Please sign in again or update your .ROBLOSECURITY cookie.".to_string(),
            403 => "Access denied (HTTP 403). You do not have permission to access or modify this asset, or your credentials lack required scopes.".to_string(),
            404 => "Asset or endpoint not found (HTTP 404). Please verify that the asset ID exists and is accessible.".to_string(),
            429 => "Roblox rate limit reached (HTTP 429). Please wait a moment before retrying.".to_string(),
            500..=599 => format!("Roblox servers encountered a temporary issue (HTTP {code}). Please try again shortly."),
            _ => format!("Request failed with HTTP {code}."),
        };
    }

    "An unexpected error occurred. Please verify your connection and try again.".to_string()
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

    #[test]
    fn test_extract_human_error() {
        let json_with_message = serde_json::json!({ "message": "Asset is not found." });
        assert_eq!(extract_human_error(&json_with_message, Some(404)), "Asset is not found.");

        let json_with_errors = serde_json::json!({
            "errors": [{ "userFacingMessage": "You do not own this asset." }]
        });
        assert_eq!(extract_human_error(&json_with_errors, Some(403)), "You do not own this asset.");

        let empty_json = serde_json::json!({});
        assert_eq!(
            extract_human_error(&empty_json, Some(401)),
            "Your Roblox session or cookie has expired. Please sign in again or update your .ROBLOSECURITY cookie."
        );
        assert_eq!(
            extract_human_error(&empty_json, Some(429)),
            "Roblox rate limit reached (HTTP 429). Please wait a moment before retrying."
        );
        assert_eq!(
            extract_human_error(&empty_json, None),
            "An unexpected error occurred. Please verify your connection and try again."
        );
    }
}
