use super::{build_roblox_cookie_header, COOKIE};
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::Emitter;

#[derive(Deserialize, specta::Type)]
pub struct BatchGrantPermissionsRequest {
    #[specta(type = Vec<f64>)]
    pub asset_ids: Vec<u64>,
    pub subject_type: String,
    pub subject_ids: Vec<String>,
    pub action: String,
    pub api_key: Option<String>,
    pub cookie: Option<String>,
}

#[derive(Serialize, specta::Type)]
pub struct BatchGrantPermissionsResponse {
    #[specta(type = Vec<f64>)]
    pub success_asset_ids: Vec<u64>,
    #[specta(type = Vec<f64>)]
    pub failed_asset_ids: Vec<u64>,
    pub errors: Vec<String>,
}

fn emit_perm_log(app: &tauri::AppHandle, level: &str, msg: &str) {
    let _ = crate::commands::ipc::append_log_entry(app, level, "permissions", msg);
    let _ = app.emit(
        "spoofer-log",
        serde_json::json!({
            "message": msg,
            "level": level,
        }),
    );
    log::info!("[AssetPermissions] [{level}] {msg}");
}

/// Resolves a Place ID to its parent Universe ID if needed.
async fn resolve_place_to_universe_id(client: &reqwest::Client, raw_id: &str) -> String {
    let trimmed = raw_id.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Check Open Cloud place-to-universe endpoint
    let url = format!("https://apis.roblox.com/universes/v1/places/{trimmed}/universe");
    if let Ok(resp) = client.get(&url).send().await {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<Value>().await {
                if let Some(universe_id) = data.get("universeId").and_then(|v| {
                    v.as_u64()
                        .map(|n| n.to_string())
                        .or_else(|| v.as_str().map(ToString::to_string))
                }) {
                    return universe_id;
                }
            }
        }
    }

    // Fallback: games.roblox.com multiget-place-details
    let url2 =
        format!("https://games.roblox.com/v1/games/multiget-place-details?placeIds={trimmed}");
    if let Ok(resp) = client.get(&url2).send().await {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<Value>().await {
                if let Some(universe_id) = data
                    .as_array()
                    .and_then(|arr| arr.first())
                    .and_then(|obj| obj.get("universeId"))
                    .and_then(|v| {
                        v.as_u64()
                            .map(|n| n.to_string())
                            .or_else(|| v.as_str().map(ToString::to_string))
                    })
                {
                    return universe_id;
                }
            }
        }
    }

    trimmed.to_string()
}

/// Grants access permissions to multiple assets for experiences, users, or groups
/// via the Roblox Asset Permissions API (Creator Hub PATCH endpoint).
///
/// Handles pacing and retry backoff to prevent hitting Roblox rate limits.
#[tauri::command]
#[specta::specta]
pub async fn batch_grant_asset_permissions(
    app: tauri::AppHandle,
    req: BatchGrantPermissionsRequest,
) -> crate::error::Result<BatchGrantPermissionsResponse> {
    let client = crate::utils::get_http_client();

    // Clean and deduplicate raw subject IDs
    let mut raw_subject_ids: Vec<String> = Vec::new();
    for s in req.subject_ids {
        for part in s.split(',') {
            let trimmed = part.trim();
            if !trimmed.is_empty() && !raw_subject_ids.iter().any(|existing| existing == trimmed) {
                raw_subject_ids.push(trimmed.to_string());
            }
        }
    }

    if raw_subject_ids.is_empty() {
        emit_perm_log(
            &app,
            "error",
            "No valid Subject IDs (Place / User / Group IDs) provided for permissions grant.",
        );
        return Err(
            "No valid Subject IDs (Place / User / Group IDs) provided for permissions grant."
                .into(),
        );
    }

    if req.asset_ids.is_empty() {
        emit_perm_log(&app, "info", "Asset IDs list is empty, skipping permissions grant.");
        return Ok(BatchGrantPermissionsResponse {
            success_asset_ids: Vec::new(),
            failed_asset_ids: Vec::new(),
            errors: Vec::new(),
        });
    }

    // Determine subject type for Roblox requests
    let lower_type = req.subject_type.trim().to_lowercase();
    let is_experience = lower_type.contains("experience")
        || lower_type.contains("place")
        || lower_type.contains("universe");
    let is_user = lower_type.contains("user");
    let subject_type_name = if is_experience {
        "Universe"
    } else if is_user {
        "User"
    } else {
        "Group"
    };

    // If experience, resolve Place IDs to Universe IDs
    let mut resolved_subject_ids: Vec<String> = Vec::new();
    for id in &raw_subject_ids {
        if is_experience {
            let resolved = resolve_place_to_universe_id(&client, id).await;
            if !resolved.is_empty() && !resolved_subject_ids.contains(&resolved) {
                resolved_subject_ids.push(resolved);
            }
        } else if !resolved_subject_ids.contains(id) {
            resolved_subject_ids.push(id.clone());
        }
    }

    // Determine authentication
    let api_key = req.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty());
    let cookie = req.cookie.as_deref().map(str::trim).filter(|c| !c.is_empty());

    let mut current_csrf_token = if let Some(c) = cookie {
        crate::commands::auth::get_csrf_token(app.clone(), c.to_string()).await.ok()
    } else {
        None
    };

    let auth_mode = match (api_key.is_some(), cookie.is_some()) {
        (true, true) => "Cookie (.ROBLOSECURITY) + API Key",
        (true, false) => "Open Cloud API Key (x-api-key)",
        (false, true) => "Roblox Cookie (.ROBLOSECURITY)",
        (false, false) => "None (Unauthenticated)",
    };

    emit_perm_log(
        &app,
        "info",
        &format!(
            "Granting permissions for {} asset(s) to {} target(s) [{}: {}] (Action: Use, Auth: {})",
            req.asset_ids.len(),
            resolved_subject_ids.len(),
            subject_type_name,
            resolved_subject_ids.join(", "),
            auth_mode
        ),
    );

    // Build the requests payload array matching Creator Hub specification exactly
    let requests_payload: Vec<Value> = resolved_subject_ids
        .iter()
        .map(|sid| {
            json!({
                "subjectType": subject_type_name,
                "subjectId": sid,
                "action": "Use"
            })
        })
        .collect();

    let body = json!({
        "requests": requests_payload,
        "grantToDependencies": false,
        "enableDeepAccessCheck": false
    });

    let mut success_ids_set = std::collections::HashSet::new();
    let mut failed_ids_set = std::collections::HashSet::new();
    let mut errors = Vec::new();

    for (idx, asset_id) in req.asset_ids.iter().enumerate() {
        let url = format!(
            "https://apis.roblox.com/asset-permissions-api/v1/assets/{asset_id}/permissions"
        );

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"));
        headers.insert("accept", HeaderValue::from_static("*/*"));
        headers.insert("content-type", HeaderValue::from_static("application/json-patch+json"));
        headers.insert("referer", HeaderValue::from_static("https://create.roblox.com/"));
        headers.insert("origin", HeaderValue::from_static("https://create.roblox.com"));

        if let Some(c) = cookie {
            let cookie_header = build_roblox_cookie_header(c);
            if let Ok(val) = HeaderValue::from_str(&cookie_header) {
                headers.insert(COOKIE, val);
            }
            if let Some(ref csrf) = current_csrf_token {
                if let Ok(val) = HeaderValue::from_str(csrf) {
                    headers.insert("x-csrf-token", val);
                }
            }
        }

        if let Some(key) = api_key {
            if let Ok(val) = HeaderValue::from_str(key) {
                headers.insert("x-api-key", val);
            }
        }

        let _ = app.emit(
            "asset-permissions-progress",
            serde_json::json!({
                "current": idx + 1,
                "total": req.asset_ids.len(),
                "assetId": asset_id
            }),
        );

        let mut attempts: u64 = 0;
        let max_attempts: u64 = 4;
        let mut succeeded = false;

        while attempts < max_attempts {
            attempts += 1;

            let res = client.patch(&url).headers(headers.clone()).json(&body).send().await;

            match res {
                Ok(resp) => {
                    let status = resp.status();

                    // Check for CSRF token challenge on 403
                    if status.as_u16() == 403 {
                        if let Some(new_csrf) =
                            resp.headers().get("x-csrf-token").and_then(|h| h.to_str().ok())
                        {
                            emit_perm_log(&app, "info", &format!("Obtained fresh CSRF token from Roblox response on asset {asset_id}, retrying..."));
                            current_csrf_token = Some(new_csrf.to_string());
                            if let Ok(val) = HeaderValue::from_str(new_csrf) {
                                headers.insert("x-csrf-token", val);
                            }
                            continue;
                        }
                    }

                    let text = resp.text().await.unwrap_or_default();
                    emit_perm_log(
                        &app,
                        if status.is_success() { "info" } else { "warn" },
                        &format!(
                            "[Asset Permissions] [{}/{}] Asset {}: HTTP {} -> {}",
                            idx + 1,
                            req.asset_ids.len(),
                            asset_id,
                            status,
                            text
                        ),
                    );

                    if status.is_success() {
                        success_ids_set.insert(*asset_id);
                        succeeded = true;
                        break;
                    } else if status.as_u16() == 429 {
                        let retry_after_ms = 1500 * attempts;
                        emit_perm_log(
                            &app,
                            "warn",
                            &format!(
                                "Rate limited (429) on asset {}, sleeping {}ms before retry...",
                                asset_id, retry_after_ms
                            ),
                        );
                        tokio::time::sleep(Duration::from_millis(retry_after_ms)).await;
                    } else {
                        let parsed_err = if let Ok(json_val) = serde_json::from_str::<Value>(&text)
                        {
                            crate::utils::extract_human_error(&json_val, Some(status.as_u16()))
                        } else {
                            format!("HTTP {}: {}", status.as_u16(), text)
                        };

                        failed_ids_set.insert(*asset_id);
                        errors.push(format!("Asset {asset_id}: {parsed_err}"));
                        break;
                    }
                }
                Err(e) => {
                    emit_perm_log(
                        &app,
                        "error",
                        &format!("Network error for asset {asset_id}: {e}"),
                    );
                    if attempts >= max_attempts {
                        failed_ids_set.insert(*asset_id);
                        errors.push(format!("Asset {asset_id}: {e}"));
                    } else {
                        tokio::time::sleep(Duration::from_millis(500 * attempts)).await;
                    }
                }
            }
        }

        if !succeeded && !failed_ids_set.contains(asset_id) {
            failed_ids_set.insert(*asset_id);
        }

        // Pacing delay between asset requests
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let success_asset_ids: Vec<u64> = success_ids_set.into_iter().collect();
    let failed_asset_ids: Vec<u64> =
        failed_ids_set.into_iter().filter(|id| !success_asset_ids.contains(id)).collect();

    emit_perm_log(
        &app,
        if failed_asset_ids.is_empty() { "info" } else { "warn" },
        &format!(
            "Asset permissions grant finished: {} succeeded, {} failed",
            success_asset_ids.len(),
            failed_asset_ids.len()
        ),
    );

    Ok(BatchGrantPermissionsResponse { success_asset_ids, failed_asset_ids, errors })
}

#[tauri::command]
#[specta::specta]
// Grant universe permission to an audio asset to prevent in-game muting.
pub async fn patch_asset_permissions(
    asset_id: String,
    universe_id: String,
    cookie: String,
    csrf_token: String,
) -> crate::error::Result<bool> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    let client = crate::utils::get_http_client();
    let url =
        format!("https://apis.roblox.com/asset-permissions-api/v1/assets/{asset_id}/permissions");

    let body = serde_json::json!({
        "requests": [
            {
                "subjectType": "Universe",
                "subjectId": universe_id,
                "action": "Use"
            }
        ],
        "grantToDependencies": false,
        "enableDeepAccessCheck": false
    });

    let mut current_csrf = csrf_token;

    for attempt in 0..3u8 {
        let res = client
            .patch(&url)
            .header(COOKIE, cookie_header.clone())
            .header("x-csrf-token", &current_csrf)
            .header("accept", "*/*")
            .header("content-type", "application/json-patch+json")
            .header("referer", "https://create.roblox.com/")
            .header("origin", "https://create.roblox.com")
            .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
            .json(&body)
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => {
                break;
            }
            Ok(r) if r.status().as_u16() == 403 => {
                if let Some(new_csrf) =
                    r.headers().get("x-csrf-token").and_then(|h| h.to_str().ok())
                {
                    current_csrf = new_csrf.to_string();
                    continue;
                }
                return Err("Permission patch failed: 403 Forbidden".into());
            }
            Ok(r) if r.status().is_server_error() => {
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
            Ok(r) => {
                return Err(format!("Permission patch failed: {}", r.status()).into());
            }
            Err(e) => {
                return Err(e.into());
            }
        }
    }

    Ok(true)
}

#[tauri::command]
#[specta::specta]
// Toggle asset visibility on the Creator Marketplace.
pub async fn set_asset_privacy(
    asset_id: String,
    privacy_status: String,
    cookie: String,
    csrf_token: String,
) -> crate::error::Result<bool> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    let client = crate::utils::get_http_client();
    let url = format!("https://apis.roblox.com/asset-privacy/v1/assets/{asset_id}/privacy");

    let body = serde_json::json!({
        "privacyStatus": privacy_status
    });

    let resp = client
        .post(&url)
        .header(COOKIE, cookie_header)
        .header("x-csrf-token", csrf_token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let parsed_err = if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&text) {
            crate::utils::extract_human_error(&json_val, Some(status.as_u16()))
        } else {
            format!("HTTP {}: {}", status.as_u16(), text)
        };
        return Err(format!("Failed to update asset privacy: {parsed_err}").into());
    }

    Ok(true)
}
