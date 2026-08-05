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
    // Load user secrets, applying migration from plaintext to the OS keyring if required.
    let password_result = tokio::task::spawn_blocking(|| {
        if let Ok(entry) = get_secrets_keyring_entry() {
            entry.get_password().ok()
        } else {
            None
        }
    })
    .await
    .unwrap_or(None);

    let mut value = if let Some(password) = password_result {
        match serde_json::from_str(&password) {
            Ok(value) => value,
            Err(_) => Value::Object(serde_json::Map::new()),
        }
    } else {
        let path = get_profile_secrets_path(&app)?;
        if path.exists() {
            let legacy_secrets = read_json_file(&path).await;
            if legacy_secrets.is_object() {
                let json_str = serde_json::to_string(&legacy_secrets)?;
                let _ = tokio::task::spawn_blocking(move || {
                    let entry = get_secrets_keyring_entry()?;
                    entry.set_password(&json_str).map_err(|error| {
                        crate::error::AppError::Custom(format!(
                            "Failed to migrate secrets into credential store: {error}"
                        ))
                    })
                })
                .await
                .map_err(|e| crate::error::AppError::Custom(e.to_string()))?;
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
        let entry = get_secrets_keyring_entry()?;
        entry.set_password(&json_str).map_err(|error| {
            crate::error::AppError::Custom(format!(
                "Failed to save secrets to credential store: {error}"
            ))
        })
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
        if let Ok(entry) = get_secrets_keyring_entry() {
            let _ = entry.delete_credential();
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
