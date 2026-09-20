use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

use crate::domain::roblox_api::{self, ResolverAsset, ResolverProgress, ScriptRefProgress};

#[tauri::command]
#[specta::specta]
pub async fn resolve_asset_creators(
    app: AppHandle,
    assets: Vec<ResolverAsset>,
    cookie: String,
) -> crate::error::Result<Vec<ResolverAsset>> {
    let app_clone = app.clone();

    let on_progress = move |payload: ResolverProgress| {
        let _ = app_clone.emit("resolver-progress", payload);
    };

    let on_cookie = move |resp: &reqwest::Response, cookie_str: &str| {
        crate::utils::check_for_roblosecurity_update(&app, resp, cookie_str);
    };

    roblox_api::resolve_asset_creators(assets, cookie, on_progress, on_cookie).await
}

#[tauri::command]
#[specta::specta]
pub async fn resolve_script_references(
    app: AppHandle,
    asset_ids: Vec<String>,
) -> crate::error::Result<HashMap<String, String>> {
    let on_progress = move |payload: ScriptRefProgress| {
        let _ = app.emit("script-ref-progress", payload);
    };

    roblox_api::resolve_script_references(asset_ids, on_progress).await
}

#[tauri::command]
#[specta::specta]
pub async fn validate_asset_ids(
    asset_ids: Vec<String>,
) -> crate::error::Result<HashMap<String, String>> {
    roblox_api::validate_asset_ids(asset_ids).await
}
