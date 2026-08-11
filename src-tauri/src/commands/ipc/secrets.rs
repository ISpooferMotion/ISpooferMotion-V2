use super::{read_json_file, write_json_file, AppHandle, Entry, Manager, PathBuf};
use crate::commands::AnyValue;
use serde_json::Value;

fn get_settings_path(app: &AppHandle) -> crate::error::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("renderer-settings.json"))
}

fn get_profile_secrets_path(app: &AppHandle) -> crate::error::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("profile-secrets.json"))
}

pub(super) fn get_secrets_keyring_entry() -> crate::error::Result<Entry> {
    Entry::new("ISpooferMotion.ProfileSecrets", "default").map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to open credential store: {e}"))
    })
}

// The Open Cloud API key lives in its own credential entry, separate from the
// ProfileSecrets blob. The blob carries the long .ROBLOSECURITY cookie -- often
// duplicated across the top-level `cookie`, `profileCookies`, and `accountSecrets`
// fields -- so it can exceed Windows Credential Manager's 2560-byte
// CredentialBlob cap, at which point CredWriteW rejects the whole blob and every
// secret in it is lost. The API key has no re-detection fallback the way the cookie
// does (Studio credentials), so giving it its own entry keeps it from disappearing
// on restart when the blob write fails.
pub(super) fn get_opencloud_api_key_entry() -> crate::error::Result<Entry> {
    Entry::new("ISpooferMotion.OpenCloudApiKey", "default").map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to open API key credential store: {e}"))
    })
}

// Maximum characters stored per credential entry. Windows Credential Manager caps
// a single credential's blob at 2560 bytes (UTF-16 = 1280 code units), so each
// chunk stays well under that limit with room to spare.
const SECRETS_CHUNK_SIZE: usize = 1000;

fn chunk_entry(index: usize) -> crate::error::Result<Entry> {
    Entry::new(&format!("ISpooferMotion.ProfileSecrets.{index}"), "default").map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to open credential store: {e}"))
    })
}

/// Splits a string into chunks of at most `size` characters, breaking only on
/// character boundaries so multi-byte UTF-8 is never split.
fn split_chunks(s: &str, size: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut start = 0;
    let mut count = 0;
    for (i, ch) in s.char_indices() {
        count += 1;
        if count == size {
            let end = i + ch.len_utf8();
            chunks.push(s[start..end].to_string());
            start = end;
            count = 0;
        }
    }
    if count > 0 {
        chunks.push(s[start..].to_string());
    }
    chunks
}

/// Writes the secrets blob to the credential store in chunks plus a small
/// manifest entry (in the base `ProfileSecrets` entry) recording the count. This
/// keeps every credential under the 2560-byte cap and supports blobs of any
/// size. Stale chunks left over from a previous, larger blob are deleted.
fn save_secrets_chunked(json_str: &str) -> crate::error::Result<()> {
    let prev = read_chunk_count().unwrap_or(0);
    let chunks = split_chunks(json_str, SECRETS_CHUNK_SIZE);
    for (i, chunk) in chunks.iter().enumerate() {
        let entry = chunk_entry(i)?;
        entry.set_password(chunk).map_err(|e| {
            crate::error::AppError::Custom(format!("Failed to save secrets chunk {i}: {e}"))
        })?;
    }
    // Delete stale chunks left over from a larger previous blob.
    let upper = prev.max(chunks.len());
    for i in chunks.len()..upper {
        if let Ok(e) = chunk_entry(i) {
            let _ = e.delete_credential();
        }
    }
    let manifest = format!("{{\"v\":2,\"chunks\":{}}}", chunks.len());
    let entry = get_secrets_keyring_entry()?;
    entry.set_password(&manifest).map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to save secrets manifest: {e}"))
    })?;
    Ok(())
}

/// Reads the chunk count from the manifest entry when the store is using the
/// chunked scheme. Returns None for a legacy single-blob entry or an empty store.
fn read_chunk_count() -> Option<usize> {
    let entry = get_secrets_keyring_entry().ok()?;
    let content = entry.get_password().ok()?;
    serde_json::from_str::<Value>(&content).ok()?.get("chunks")?.as_u64().map(|n| n as usize)
}

#[tauri::command]
#[specta::specta]
pub async fn load_renderer_settings(app: AppHandle) -> crate::error::Result<AnyValue> {
    let path = get_settings_path(&app)?;
    Ok(AnyValue(read_json_file(&path).await))
}

#[tauri::command]
#[specta::specta]
pub async fn save_renderer_settings(
    app: AppHandle,
    settings: AnyValue,
) -> crate::error::Result<bool> {
    let settings = settings.0;
    let path = get_settings_path(&app)?;
    write_json_file(&path, &settings).await?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn load_profile_secrets(app: AppHandle) -> crate::error::Result<AnyValue> {
    // Load user secrets, applying migration from plaintext to the OS keyring if
    // required. The blob is stored in fixed-size chunks under
    // ISpooferMotion.ProfileSecrets.<n>, with a small manifest in the base entry
    // recording the chunk count; a legacy single-blob entry (pre-chunking) is
    // detected and used directly.
    let keyring_value = tokio::task::spawn_blocking(|| {
        let Ok(entry) = get_secrets_keyring_entry() else { return None };
        let Ok(content) = entry.get_password() else { return None };
        if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
            if let Some(n) = parsed.get("chunks").and_then(Value::as_u64) {
                // Chunked manifest: reassemble the blob from N chunk entries.
                let mut combined = String::new();
                for i in 0..n as usize {
                    if let Ok(ce) = chunk_entry(i) {
                        if let Ok(chunk) = ce.get_password() {
                            combined.push_str(&chunk);
                        }
                    }
                }
                return serde_json::from_str(&combined).ok();
            }
            // Legacy single-blob entry (pre-chunking): use it directly.
            return Some(parsed);
        }
        None
    })
    .await
    .unwrap_or(None);

    let mut value = if let Some(v) = keyring_value {
        v
    } else {
        let path = get_profile_secrets_path(&app)?;
        if path.exists() {
            let legacy_secrets = read_json_file(&path).await;
            if legacy_secrets.is_object() {
                let json_str = serde_json::to_string(&legacy_secrets)?;
                tokio::task::spawn_blocking(move || save_secrets_chunked(&json_str))
                    .await
                    .map_err(|e| crate::error::AppError::Custom(e.to_string()))??;
                let _ = tokio::fs::remove_file(path).await;
            }
            legacy_secrets
        } else {
            Value::Object(serde_json::Map::new())
        }
    };

    // The API key is the authoritative value from its own entry; fall back to
    // whatever the blob carries (back-compat for installs that only have it there).
    let api_key = tokio::task::spawn_blocking(|| {
        get_opencloud_api_key_entry().ok().and_then(|e| e.get_password().ok())
    })
    .await
    .unwrap_or(None);
    if let Some(api_key) = api_key {
        if let Some(obj) = value.as_object_mut() {
            obj.insert("apiKey".to_string(), Value::String(api_key));
        }
    }

    Ok(AnyValue(value))
}

#[tauri::command]
#[specta::specta]
pub async fn save_profile_secrets(
    app: AppHandle,
    data: AnyValue,
) -> crate::error::Result<AnyValue> {
    // Merge incoming secrets with existing store values.
    let data = data.0;
    let mut all_secrets = load_profile_secrets(app.clone()).await?.0;

    if let (Some(all_obj), Some(data_obj)) = (all_secrets.as_object_mut(), data.as_object()) {
        for (k, v) in data_obj {
            if k != "action" && k != "secrets" {
                if k == "profileCookies" {
                    let profile_cookies = all_obj
                        .entry(k.clone())
                        .or_insert_with(|| Value::Object(serde_json::Map::new()));
                    if let (Some(existing), Some(incoming)) =
                        (profile_cookies.as_object_mut(), v.as_object())
                    {
                        for (profile_id, cookie) in incoming {
                            existing.insert(profile_id.clone(), cookie.clone());
                        }
                    }
                } else if k == "accountSecrets" {
                    let account_secrets = all_obj
                        .entry(k.clone())
                        .or_insert_with(|| Value::Object(serde_json::Map::new()));
                    if let (Some(existing), Some(incoming)) =
                        (account_secrets.as_object_mut(), v.as_object())
                    {
                        for (account_id, secrets) in incoming {
                            existing.insert(account_id.clone(), secrets.clone());
                        }
                    }
                } else {
                    all_obj.insert(k.clone(), v.clone());
                }
            } else if k == "secrets" {
                if let Some(secrets_obj) = v.as_object() {
                    for (sk, sv) in secrets_obj {
                        all_obj.insert(sk.clone(), sv.clone());
                    }
                }
            }
        }
    } else {
        all_secrets = data.clone();
    }

    let api_key_value = all_secrets.get("apiKey").and_then(|v| v.as_str()).map(str::to_string);
    let json_str = serde_json::to_string(&all_secrets)?;
    tokio::task::spawn_blocking(move || {
        // Persist the API key first in its own entry so a valid key is not lost
        // when the cookie-bearing blob below exceeds the CredentialBlob cap.
        if let Some(api_key) = api_key_value {
            if let Ok(entry) = get_opencloud_api_key_entry() {
                let _ = entry.set_password(&api_key);
            }
        }
        // The blob is chunked across multiple entries so it stays under Windows
        // Credential Manager's 2560-byte per-credential cap even with several
        // accounts' cookies duplicated across the blob's fields.
        save_secrets_chunked(&json_str)
    })
    .await
    .map_err(|e| crate::error::AppError::Custom(e.to_string()))??;

    let path = get_profile_secrets_path(&app)?;
    let _ = tokio::fs::remove_file(path).await;

    Ok(AnyValue(all_secrets))
}

#[tauri::command]
#[specta::specta]
pub async fn clear_profile_secrets(
    app: AppHandle,
    _profile_id: Option<String>,
) -> crate::error::Result<bool> {
    let _ = tokio::task::spawn_blocking(|| {
        // Delete every chunk plus the manifest. The manifest records the chunk
        // count; if it's missing, sweep a conservative range.
        let mut count = 64usize;
        if let Ok(entry) = get_secrets_keyring_entry() {
            if let Ok(content) = entry.get_password() {
                if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
                    if let Some(n) = parsed.get("chunks").and_then(Value::as_u64) {
                        count = n as usize;
                    }
                }
            }
            let _ = entry.delete_credential();
        }
        for i in 0..count {
            if let Ok(e) = chunk_entry(i) {
                let _ = e.delete_credential();
            }
        }
        if let Ok(entry) = get_opencloud_api_key_entry() {
            let _ = entry.delete_credential();
        }
    })
    .await;
    let path = get_profile_secrets_path(&app)?;
    let _ = tokio::fs::remove_file(path).await;
    Ok(true)
}
