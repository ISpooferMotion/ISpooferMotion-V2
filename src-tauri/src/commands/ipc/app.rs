#![allow(clippy::needless_pass_by_value)]
use super::{AppHandle, DialogExt, Manager};
use crate::commands::ipc::secrets::clear_profile_secrets;
use crate::commands::AnyValue;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[tauri::command]
#[specta::specta]
pub fn window_minimize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
#[specta::specta]
pub fn open_frontend_devtools(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        #[cfg(debug_assertions)]
        win.open_devtools();
        #[cfg(not(debug_assertions))]
        {
            // DevTools are restricted to debug builds.
            // Notify the frontend so the user knows.
            let _ = win.eval(
                "console.warn('[ISpooferMotion] DevTools are not available in this release build.')"
            );
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn window_close(app: AppHandle) {
    crate::commands::startup::uninstall_roblox_plugin();
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

#[tauri::command]
#[specta::specta]
pub fn quit_app(app: AppHandle) {
    crate::commands::startup::uninstall_roblox_plugin();
    app.exit(0);
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn get_app_version() -> String {
    APP_VERSION.to_string()
}

/// Updates the proxy URL used for outbound Roblox/API calls. Pass an empty
/// string or `None` to fall back to the OS system proxy (Windows WinINET, which
/// VPN "proxy mode" apps like Happ set). Called from the frontend on startup and
/// whenever the Proxy URL setting changes.
#[tauri::command]
#[specta::specta]
pub fn set_proxy_url(url: Option<String>) -> bool {
    crate::utils::set_explicit_proxy(url);
    true
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn get_release_source() -> String {
    "ISpooferMotion/ISpooferMotion-V2".to_string()
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn get_runtime_info() -> AnyValue {
    AnyValue(serde_json::json!({
        "appVersion": APP_VERSION,
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "runtime": "tauri"
    }))
}

#[tauri::command]
#[specta::specta]
pub fn open_external(app: AppHandle, url: String) -> crate::error::Result<bool> {
    // Validate the URL scheme before execution.
    if let Ok(parsed) = reqwest::Url::parse(&url) {
        if parsed.scheme() == "http" || parsed.scheme() == "https" {
            use tauri_plugin_opener::OpenerExt;
            let _ = app.opener().open_url(url, None::<String>);
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
#[specta::specta]
pub async fn select_folder(app: AppHandle) -> crate::error::Result<Option<String>> {
    let folder = tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .map_err(|err| err.to_string())?;
    folder
        .map(|path| {
            path.into_path()
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|err| err.to_string().into())
        })
        .transpose()
}

#[tauri::command]
#[specta::specta]
pub async fn uninstall_app(app: AppHandle) -> crate::error::Result<bool> {
    // Clear all user data and credentials before exiting.
    let _ = clear_profile_secrets(app.clone(), None).await;
    if let Ok(data_dir) = app.path().app_data_dir() {
        let _ = tokio::fs::remove_dir_all(&data_dir).await;
    }
    crate::commands::startup::uninstall_roblox_plugin();
    app.exit(0);
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn clear_plugin_cache(app: AppHandle) -> crate::error::Result<bool> {
    crate::commands::spoofer::clear_asset_cache(app).await;
    Ok(true)
}
