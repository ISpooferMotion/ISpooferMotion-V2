//! OS-level filesystem and system interaction commands.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::utils::build_roblox_cookie_header;

#[derive(serde::Deserialize, specta::Type)]
pub struct NotificationOptions {
    pub title: Option<String>,
    pub body: Option<String>,
}

/// Deletes all cached data (like downloaded thumbnails and audio files).
#[tauri::command]
#[specta::specta]
pub async fn clear_app_cache(app: AppHandle) -> crate::error::Result<bool> {
    let cache_dir = app.path().app_cache_dir()?;
    match tokio::fs::remove_dir_all(&cache_dir).await {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(err.into()),
    }
    tokio::fs::create_dir_all(&cache_dir).await?;
    Ok(true)
}

/// Downloads an audio asset from Roblox to the local cache and returns its path.
///
/// The frontend uses this to stream audio via HTML5 `<audio>` since we can't
/// reliably bypass Roblox's CORS policies directly in the browser context.
#[tauri::command]
#[specta::specta]
pub async fn play_roblox_audio(
    app: AppHandle,
    asset_id: String,
    cookie: Option<String>,
    enable_cache: Option<bool>,
) -> crate::error::Result<String> {
    let asset_id = asset_id.trim();
    if asset_id.is_empty() || !asset_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Please provide a valid numeric Roblox audio asset ID.".into());
    }

    let cache_enabled = enable_cache.unwrap_or(true);
    let audio_dir = app.path().app_cache_dir()?.join("roblox_audio");
    tokio::fs::create_dir_all(&audio_dir).await?;

    // Check if the audio file exists locally.
    let existing_file = ["ogg", "mp3"]
        .iter()
        .map(|ext| audio_dir.join(format!("sound_{asset_id}.{ext}")))
        .find(|path| path.exists());

    let audio_path = if cache_enabled {
        if let Some(path) = existing_file {
            path
        } else {
            download_roblox_audio(&audio_dir, asset_id, cookie.as_deref()).await?
        }
    } else {
        for ext in ["ogg", "mp3"] {
            let _ = tokio::fs::remove_file(audio_dir.join(format!("sound_{asset_id}.{ext}"))).await;
        }
        download_roblox_audio(&audio_dir, asset_id, cookie.as_deref()).await?
    };

    Ok(audio_path.to_string_lossy().into_owned())
}

async fn download_roblox_audio(
    audio_dir: &std::path::Path,
    asset_id: &str,
    cookie: Option<&str>,
) -> crate::error::Result<std::path::PathBuf> {
    // Use the shared connection-pooled client; Roblox asset delivery redirects are handled
    // by the default policy (up to 10 hops) which reqwest follows automatically.
    let client = crate::utils::get_http_client();
    let mut request = client
        .get(format!("https://assetdelivery.roblox.com/v1/asset/?id={asset_id}"))
        .header(reqwest::header::USER_AGENT, "ISpooferMotion/2.0");

    if let Some(cookie_value) = cookie {
        let cookie_header = build_roblox_cookie_header(cookie_value);
        if !cookie_header.is_empty() {
            request = request.header(reqwest::header::COOKIE, cookie_header);
        }
    }

    let response = request.send().await?;
    if !response.status().is_success() {
        let code = response.status().as_u16();
        let message = match code {
            401 | 403 => "Unable to download audio: you do not have permission to access this asset, or your cookie has expired.".to_string(),
            404 => format!("Audio asset {asset_id} was not found on Roblox."),
            429 => "Roblox rate limit reached while downloading audio. Please wait a moment before trying again.".to_string(),
            _ => format!("Roblox audio download failed with HTTP {code}."),
        };
        return Err(message.into());
    }

    // Infer file extension from Content-Type, defaulting to ogg.
    let extension = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map_or("ogg", |content_type| if content_type.contains("mpeg") { "mp3" } else { "ogg" });
    let audio_path = audio_dir.join(format!("sound_{asset_id}.{extension}"));
    let bytes = response.bytes().await?;
    tokio::fs::write(&audio_path, bytes).await?;
    Ok(audio_path)
}

/// Triggers a native desktop notification.
#[tauri::command]
#[specta::specta]
pub async fn show_notification(
    app: AppHandle,
    options: NotificationOptions,
) -> crate::error::Result<bool> {
    app.notification()
        .builder()
        .title(options.title.as_deref().unwrap_or("ISpooferMotion"))
        .body(options.body.as_deref().unwrap_or("Notification"))
        .icon("app-icon")
        .show()
        .map_err(|err| err.to_string())?;
    Ok(true)
}
