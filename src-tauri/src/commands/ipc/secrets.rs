use super::{read_json_file, AppHandle, Entry, Manager, PathBuf};
use crate::commands::AnyValue;
use serde_json::Value;
use std::sync::OnceLock;
use tokio::sync::Mutex;

static SECRETS_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
const SECRETS_CHUNK_BYTES: usize = 1_000;
const MAX_SECRET_CHUNKS: usize = 512;

fn secrets_mutex() -> &'static Mutex<()> {
    SECRETS_MUTEX.get_or_init(|| Mutex::new(()))
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

pub(super) fn get_opencloud_api_key_entry() -> crate::error::Result<Entry> {
    Entry::new("ISpooferMotion.OpenCloudApiKey", "default").map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to open API key credential store: {e}"))
    })
}

fn chunk_entry(index: usize) -> crate::error::Result<Entry> {
    Entry::new(&format!("ISpooferMotion.ProfileSecrets.{index}"), "default").map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to open credential store: {e}"))
    })
}

fn split_chunks_by_bytes(value: &str, max_bytes: usize) -> Vec<String> {
    assert!(max_bytes > 0, "chunk size must be non-zero");
    if value.is_empty() {
        return vec![String::new()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let mut bytes_in_chunk = 0;

    for (offset, ch) in value.char_indices() {
        let char_bytes = ch.len_utf8();
        if bytes_in_chunk > 0 && bytes_in_chunk + char_bytes > max_bytes {
            chunks.push(value[start..offset].to_string());
            start = offset;
            bytes_in_chunk = 0;
        }
        bytes_in_chunk += char_bytes;
    }

    if start < value.len() {
        chunks.push(value[start..].to_string());
    }
    chunks
}

fn read_manifest_chunk_count() -> crate::error::Result<Option<usize>> {
    let entry = get_secrets_keyring_entry()?;
    let content = match entry.get_password() {
        Ok(content) => content,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => {
            return Err(crate::error::AppError::Custom(format!(
                "Failed to read secrets manifest: {e}"
            )))
        }
    };

    let parsed: Value = serde_json::from_str(&content)?;
    let Some(count) = parsed.get("chunks").and_then(Value::as_u64) else {
        return Ok(None);
    };
    let count = usize::try_from(count)
        .map_err(|_| crate::error::AppError::Custom("Invalid secrets chunk count".to_string()))?;
    if count > MAX_SECRET_CHUNKS {
        return Err(crate::error::AppError::Custom(format!(
            "Secrets manifest requested too many chunks ({count})"
        )));
    }
    Ok(Some(count))
}

fn save_secrets_chunked(json_str: &str) -> crate::error::Result<()> {
    let previous_count = read_manifest_chunk_count()?.unwrap_or(0);
    let chunks = split_chunks_by_bytes(json_str, SECRETS_CHUNK_BYTES);
    if chunks.len() > MAX_SECRET_CHUNKS {
        return Err(crate::error::AppError::Custom(
            "Profile secrets are too large for the credential store".to_string(),
        ));
    }

    for (index, chunk) in chunks.iter().enumerate() {
        let entry = chunk_entry(index)?;
        entry.set_password(chunk).map_err(|e| {
            crate::error::AppError::Custom(format!("Failed to save secrets chunk {index}: {e}"))
        })?;
    }

    let manifest = format!("{{\"v\":2,\"chunks\":{}}}", chunks.len());
    get_secrets_keyring_entry()?.set_password(&manifest).map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to save secrets manifest: {e}"))
    })?;

    for index in chunks.len()..previous_count {
        let entry = chunk_entry(index)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => {
                return Err(crate::error::AppError::Custom(format!(
                    "Failed to remove stale secrets chunk {index}: {e}"
                )))
            }
        }
    }
    Ok(())
}

fn load_keyring_blob() -> crate::error::Result<Option<Value>> {
    let entry = get_secrets_keyring_entry()?;
    let content = match entry.get_password() {
        Ok(content) => content,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => {
            return Err(crate::error::AppError::Custom(format!(
                "Failed to read credential store: {e}"
            )))
        }
    };

    let parsed: Value = serde_json::from_str(&content)?;
    if let Some(count) = parsed.get("chunks").and_then(Value::as_u64) {
        let count = usize::try_from(count).map_err(|_| {
            crate::error::AppError::Custom("Invalid secrets chunk count".to_string())
        })?;
        if count > MAX_SECRET_CHUNKS {
            return Err(crate::error::AppError::Custom(format!(
                "Secrets manifest requested too many chunks ({count})"
            )));
        }

        let mut combined = String::new();
        for index in 0..count {
            let chunk = match chunk_entry(index)?.get_password() {
                Ok(chunk) => chunk,
                Err(keyring::Error::NoEntry) => {
                    return Err(crate::error::AppError::Custom(format!(
                        "Secrets store is incomplete: chunk {index} is missing"
                    )))
                }
                Err(e) => {
                    return Err(crate::error::AppError::Custom(format!(
                        "Failed to read secrets chunk {index}: {e}"
                    )))
                }
            };
            combined.push_str(&chunk);
        }
        return Ok(Some(serde_json::from_str(&combined)?));
    }

    Ok(Some(parsed))
}

fn load_opencloud_api_key() -> crate::error::Result<Option<String>> {
    match get_opencloud_api_key_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => {
            Err(crate::error::AppError::Custom(format!("Failed to read API key credential: {e}")))
        }
    }
}

fn save_opencloud_api_key(api_key: Option<&str>) -> crate::error::Result<()> {
    let entry = get_opencloud_api_key_entry()?;
    match api_key.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => entry.set_password(value).map_err(|e| {
            crate::error::AppError::Custom(format!("Failed to save API key credential: {e}"))
        }),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(crate::error::AppError::Custom(format!(
                "Failed to clear API key credential: {e}"
            ))),
        },
    }
}

async fn load_profile_secrets_inner(app: &AppHandle) -> crate::error::Result<Value> {
    let keyring_value = tokio::task::spawn_blocking(load_keyring_blob)
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Credential task failed: {e}")))??;

    let legacy_path = get_profile_secrets_path(app)?;
    let mut value = if let Some(value) = keyring_value {
        match tokio::fs::remove_file(&legacy_path).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(crate::error::AppError::Custom(format!(
                    "Failed to remove legacy plaintext secrets file: {e}"
                )))
            }
        }
        value
    } else if tokio::fs::try_exists(&legacy_path).await? {
        let legacy_secrets = read_json_file(&legacy_path).await?;
        if !legacy_secrets.is_object() {
            return Err(crate::error::AppError::Custom(
                "Legacy profile secrets file has an invalid root type".to_string(),
            ));
        }
        let json_str = serde_json::to_string(&legacy_secrets)?;
        tokio::task::spawn_blocking(move || save_secrets_chunked(&json_str)).await.map_err(
            |e| crate::error::AppError::Custom(format!("Credential task failed: {e}")),
        )??;
        tokio::fs::remove_file(&legacy_path).await.map_err(|e| {
            crate::error::AppError::Custom(format!(
                "Secrets were migrated, but the legacy plaintext file could not be removed: {e}"
            ))
        })?;
        legacy_secrets
    } else {
        Value::Object(serde_json::Map::new())
    };

    let api_key = tokio::task::spawn_blocking(load_opencloud_api_key)
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Credential task failed: {e}")))??;
    if let Some(api_key) = api_key {
        let object = value.as_object_mut().ok_or_else(|| {
            crate::error::AppError::Custom("Profile secrets have an invalid root type".to_string())
        })?;
        object.insert("apiKey".to_string(), Value::String(api_key));
    }

    Ok(value)
}

#[tauri::command]
#[specta::specta]
pub async fn load_profile_secrets(app: AppHandle) -> crate::error::Result<AnyValue> {
    let _guard = secrets_mutex().lock().await;
    Ok(AnyValue(load_profile_secrets_inner(&app).await?))
}

#[tauri::command]
#[specta::specta]
pub async fn save_profile_secrets(
    app: AppHandle,
    data: AnyValue,
) -> crate::error::Result<AnyValue> {
    let _guard = secrets_mutex().lock().await;
    let data = data.0;
    let mut all_secrets = load_profile_secrets_inner(&app).await?;

    if let (Some(all_obj), Some(data_obj)) = (all_secrets.as_object_mut(), data.as_object()) {
        for (key, value) in data_obj {
            if key != "action" && key != "secrets" {
                if matches!(key.as_str(), "profileCookies" | "accountSecrets") {
                    let target = all_obj
                        .entry(key.clone())
                        .or_insert_with(|| Value::Object(serde_json::Map::new()));
                    if let (Some(existing), Some(incoming)) =
                        (target.as_object_mut(), value.as_object())
                    {
                        for (entry_key, entry_value) in incoming {
                            existing.insert(entry_key.clone(), entry_value.clone());
                        }
                    } else {
                        all_obj.insert(key.clone(), value.clone());
                    }
                } else {
                    all_obj.insert(key.clone(), value.clone());
                }
            } else if key == "secrets" {
                if let Some(secrets_obj) = value.as_object() {
                    for (secret_key, secret_value) in secrets_obj {
                        all_obj.insert(secret_key.clone(), secret_value.clone());
                    }
                }
            }
        }
    } else if data.is_object() {
        all_secrets = data.clone();
    } else {
        return Err(crate::error::AppError::Custom(
            "Profile secrets payload must be an object".to_string(),
        ));
    }

    let api_key = all_secrets.get("apiKey").and_then(Value::as_str).map(str::to_string);
    let json_str = serde_json::to_string(&all_secrets)?;
    tokio::task::spawn_blocking(move || {
        save_secrets_chunked(&json_str)?;
        save_opencloud_api_key(api_key.as_deref())
    })
    .await
    .map_err(|e| crate::error::AppError::Custom(format!("Credential task failed: {e}")))??;

    let legacy_path = get_profile_secrets_path(&app)?;
    match tokio::fs::remove_file(legacy_path).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(crate::error::AppError::Custom(format!(
                "Secrets were saved, but the legacy plaintext file could not be removed: {e}"
            )))
        }
    }

    Ok(AnyValue(all_secrets))
}

#[tauri::command]
#[specta::specta]
pub async fn clear_profile_secrets(
    app: AppHandle,
    _profile_id: Option<String>,
) -> crate::error::Result<bool> {
    let _guard = secrets_mutex().lock().await;
    tokio::task::spawn_blocking(|| -> crate::error::Result<()> {
        let count = read_manifest_chunk_count()?;

        let manifest = get_secrets_keyring_entry()?;
        match manifest.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => {
                return Err(crate::error::AppError::Custom(format!(
                    "Failed to clear secrets manifest: {e}"
                )))
            }
        }

        match count {
            Some(count) => {
                for index in 0..count {
                    let entry = chunk_entry(index)?;
                    match entry.delete_credential() {
                        Ok(()) | Err(keyring::Error::NoEntry) => {}
                        Err(e) => {
                            return Err(crate::error::AppError::Custom(format!(
                                "Failed to clear secrets chunk {index}: {e}"
                            )))
                        }
                    }
                }
            }
            None => {
                for index in 0..MAX_SECRET_CHUNKS {
                    let entry = chunk_entry(index)?;
                    match entry.delete_credential() {
                        Ok(()) => {}
                        Err(keyring::Error::NoEntry) => break,
                        Err(e) => {
                            return Err(crate::error::AppError::Custom(format!(
                                "Failed to clear orphaned secrets chunk {index}: {e}"
                            )))
                        }
                    }
                }
            }
        }
        save_opencloud_api_key(None)?;
        Ok(())
    })
    .await
    .map_err(|e| crate::error::AppError::Custom(format!("Credential task failed: {e}")))??;

    let legacy_path = get_profile_secrets_path(&app)?;
    match tokio::fs::remove_file(legacy_path).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::split_chunks_by_bytes;

    #[test]
    fn chunking_respects_utf8_byte_limit_and_round_trips() {
        let input = format!("{}{}", "a".repeat(999), "🙂".repeat(20));
        let chunks = split_chunks_by_bytes(&input, 1_000);
        assert!(chunks.iter().all(|chunk| chunk.len() <= 1_000));
        assert_eq!(chunks.concat(), input);
    }

    #[test]
    fn chunking_handles_empty_values() {
        assert_eq!(split_chunks_by_bytes("", 1_000), vec![String::new()]);
    }
}
