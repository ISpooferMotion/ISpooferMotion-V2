pub mod cookies;
pub mod validation;

use crate::utils::check_for_roblosecurity_update;
pub use cookies::{
    get_cookie_from_browser_profiles, get_cookie_from_roblox_studio_inner, profile_cookie_entry,
};
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, USER_AGENT};
use serde::Deserialize;
use std::sync::OnceLock;
use tauri::AppHandle;
pub use validation::{
    fetch_csrf_token_internal, force_refresh_csrf_token, ApiKeyOwnerDetectResult, AuthResponse,
    RobloxGroup, RobloxUserInfo, ROBLOX_USER_AGENT,
};

pub(crate) fn sanitize_cookie_value(raw: &str) -> String {
    raw.trim().trim_matches('"').chars().filter(|c| *c >= '\x20' && *c <= '\x7E').collect()
}

#[derive(Deserialize)]
struct AvatarResponse {
    data: Vec<AvatarItem>,
}

#[derive(Deserialize)]
struct AvatarItem {
    #[serde(rename = "imageUrl")]
    image_url: String,
}

#[derive(Deserialize)]
struct GroupResponse {
    data: Vec<RobloxGroup>,
}

#[derive(Deserialize)]
struct GroupIconsResponse {
    data: Vec<GroupIconItem>,
}

#[derive(Deserialize)]
struct GroupIconItem {
    #[serde(rename = "targetId")]
    target_id: i64,
    #[serde(rename = "imageUrl")]
    image_url: String,
}

#[tauri::command]
#[specta::specta]
pub async fn get_cookie_from_roblox_studio(
    user_id: Option<String>,
) -> crate::error::Result<Option<String>> {
    tokio::task::spawn_blocking(move || get_cookie_from_roblox_studio_inner(user_id))
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Task failed: {e}")))?
}

#[tauri::command]
#[specta::specta]
pub async fn get_cookie_from_auto_detect(
    user_id: Option<String>,
) -> crate::error::Result<Option<String>> {
    tokio::task::spawn_blocking(move || {
        if let Some(cookie) = get_cookie_from_roblox_studio_inner(user_id)? {
            return Ok(Some(cookie));
        }
        Ok(get_cookie_from_browser_profiles())
    })
    .await
    .map_err(|e| crate::error::AppError::Custom(format!("Task failed: {e}")))?
}

#[tauri::command]
#[specta::specta]
pub async fn delete_saved_roblox_profile_cookie(user_id: String) -> crate::error::Result<bool> {
    tokio::task::spawn_blocking(move || {
        let entry = profile_cookie_entry(&user_id)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(true),
            Err(e) => Err(crate::error::AppError::Custom(format!(
                "Failed to delete saved profile cookie: {e}"
            ))),
        }
    })
    .await
    .map_err(|e| crate::error::AppError::Custom(format!("Credential task failed: {e}")))?
}

#[tauri::command]
#[specta::specta]
pub async fn get_csrf_token(app: AppHandle, cookie: String) -> crate::error::Result<String> {
    fetch_csrf_token_internal(Some(app), cookie).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_authenticated_user_id(
    app: AppHandle,
    cookie: String,
) -> crate::error::Result<String> {
    let url = "https://users.roblox.com/v1/users/authenticated";
    let cookie_val = sanitize_cookie_value(&cookie);
    let cookie_header_str = if cookie_val.starts_with(".ROBLOSECURITY=") {
        cookie_val
    } else {
        format!(".ROBLOSECURITY={cookie_val}")
    };

    let client = crate::utils::get_http_client();

    let mut headers = HeaderMap::new();
    headers.insert(
        COOKIE,
        HeaderValue::from_str(&cookie_header_str).map_err(|e| {
            crate::error::AppError::Custom(format!(
                "The provided cookie contains invalid characters: {e}"
            ))
        })?,
    );
    headers.insert(USER_AGENT, HeaderValue::from_static(ROBLOX_USER_AGENT));

    let res = client.get(url).headers(headers).send().await.map_err(|e| {
        crate::error::AppError::Custom(format!(
            "Could not reach Roblox authentication servers: {e}"
        ))
    })?;

    check_for_roblosecurity_update(&app, &res, &cookie_header_str);

    if !res.status().is_success() {
        return Err(format!("Unable to authenticate with Roblox (HTTP {}). Please check that your .ROBLOSECURITY cookie is active.", res.status()).into());
    }
    let data: AuthResponse = res.json().await.map_err(|e| {
        crate::error::AppError::Custom(format!(
            "Unexpected response format from Roblox authentication: {e}"
        ))
    })?;
    Ok(data.id.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_roblox_user_info(user_id: String) -> crate::error::Result<RobloxUserInfo> {
    let trimmed = user_id.trim();
    if !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Please enter a valid numeric user ID.".into());
    }
    let url = format!("https://users.roblox.com/v1/users/{trimmed}");
    let client = crate::utils::get_http_client();
    let res =
        client.get(&url).header("User-Agent", ROBLOX_USER_AGENT).send().await.map_err(|e| {
            crate::error::AppError::Custom(format!(
                "Could not reach Roblox to fetch profile details: {e}"
            ))
        })?;

    if !res.status().is_success() {
        return Err(format!(
            "Could not retrieve profile information for this user (HTTP {}).",
            res.status()
        )
        .into());
    }
    let data: RobloxUserInfo = res.json().await.map_err(|e| {
        crate::error::AppError::Custom(format!("Could not parse profile response: {e}"))
    })?;
    Ok(data)
}

#[tauri::command]
#[specta::specta]
pub async fn get_roblox_user_avatar(user_id: String) -> crate::error::Result<String> {
    let trimmed = user_id.trim();
    if !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Please enter a valid numeric user ID.".into());
    }
    let url = format!(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={trimmed}&size=150x150&format=Png&isCircular=true"
    );
    let client = crate::utils::get_http_client();
    let res =
        client.get(&url).header("User-Agent", ROBLOX_USER_AGENT).send().await.map_err(|e| {
            crate::error::AppError::Custom(format!("Could not reach Roblox thumbnail servers: {e}"))
        })?;

    if !res.status().is_success() {
        return Err(format!("Could not retrieve avatar thumbnail (HTTP {}).", res.status()).into());
    }

    let json: AvatarResponse = res.json().await.map_err(|e| {
        crate::error::AppError::Custom(format!("Could not parse avatar thumbnail response: {e}"))
    })?;

    let image_url = json.data.into_iter().next().map(|item| item.image_url).ok_or_else(|| {
        crate::error::AppError::Custom(
            "Roblox did not return an avatar image for this user.".to_string(),
        )
    })?;

    Ok(image_url)
}

#[tauri::command]
#[specta::specta]
pub async fn get_manageable_groups(
    app: AppHandle,
    cookie: String,
) -> crate::error::Result<Vec<RobloxGroup>> {
    let url = "https://develop.roblox.com/v1/user/groups/canmanage";
    let cookie_val = sanitize_cookie_value(&cookie);
    let cookie_header_str = if cookie_val.starts_with(".ROBLOSECURITY=") {
        cookie_val
    } else {
        format!(".ROBLOSECURITY={cookie_val}")
    };

    let client = crate::utils::get_http_client();

    let mut headers = HeaderMap::new();
    headers.insert(
        COOKIE,
        HeaderValue::from_str(&cookie_header_str).map_err(|e| {
            crate::error::AppError::Custom(format!(
                "The provided cookie contains invalid characters: {e}"
            ))
        })?,
    );
    headers.insert(USER_AGENT, HeaderValue::from_static(ROBLOX_USER_AGENT));

    let res = client.get(url).headers(headers).send().await.map_err(|e| {
        crate::error::AppError::Custom(format!("Could not reach Roblox group servers: {e}"))
    })?;

    check_for_roblosecurity_update(&app, &res, &cookie_header_str);

    if !res.status().is_success() {
        return Err(format!("Could not retrieve manageable groups (HTTP {}). Please check that your account has group management rights.", res.status()).into());
    }

    let json: GroupResponse = res.json().await.map_err(|e| {
        crate::error::AppError::Custom(format!("Could not parse manageable groups response: {e}"))
    })?;

    Ok(json.data)
}

#[tauri::command]
#[specta::specta]
pub async fn get_group_icon(group_id: String) -> crate::error::Result<String> {
    let trimmed = group_id.trim();
    if !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Please enter a valid numeric group ID.".into());
    }
    let url = format!(
        "https://thumbnails.roblox.com/v1/groups/icons?groupIds={trimmed}&size=150x150&format=Png&isCircular=true"
    );
    let client = crate::utils::get_http_client();
    let res =
        client.get(&url).header("User-Agent", ROBLOX_USER_AGENT).send().await.map_err(|e| {
            crate::error::AppError::Custom(format!(
                "Could not reach Roblox group icon servers: {e}"
            ))
        })?;

    if !res.status().is_success() {
        return Err(format!("Could not retrieve group icon (HTTP {}).", res.status()).into());
    }

    let json: GroupIconsResponse = res.json().await.map_err(|e| {
        crate::error::AppError::Custom(format!("Could not parse group icon response: {e}"))
    })?;

    let image_url = json.data.into_iter().next().map(|item| item.image_url).ok_or_else(|| {
        crate::error::AppError::Custom("Roblox did not return an icon for this group.".to_string())
    })?;

    Ok(image_url)
}

#[tauri::command]
#[specta::specta]
pub async fn get_group_icons_batch(
    group_ids: Vec<String>,
) -> crate::error::Result<std::collections::HashMap<String, String>> {
    let mut map = std::collections::HashMap::new();
    if group_ids.is_empty() {
        return Ok(map);
    }

    let valid_ids: Vec<String> = group_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))
        .collect();

    if valid_ids.is_empty() {
        return Ok(map);
    }

    let joined_ids = valid_ids.join(",");
    let url = format!(
        "https://thumbnails.roblox.com/v1/groups/icons?groupIds={joined_ids}&size=150x150&format=Png&isCircular=true"
    );

    let client = crate::utils::get_http_client();
    let res =
        client.get(&url).header("User-Agent", ROBLOX_USER_AGENT).send().await.map_err(|e| {
            crate::error::AppError::Custom(format!(
                "Could not reach Roblox group icon servers: {e}"
            ))
        })?;

    if !res.status().is_success() {
        return Err(format!("Could not retrieve group icons batch (HTTP {}).", res.status()).into());
    }

    let json: GroupIconsResponse = res.json().await.map_err(|e| {
        crate::error::AppError::Custom(format!("Could not parse group icons response: {e}"))
    })?;

    for item in json.data {
        map.insert(item.target_id.to_string(), item.image_url);
    }

    Ok(map)
}

fn opencloud_error_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)User\s+(\d+)\s+is\s+unauthorized")
            .expect("Failed to compile OpenCloud error regex")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn detect_opencloud_api_key_owner(
    key: String,
) -> crate::error::Result<ApiKeyOwnerDetectResult> {
    let key = key.trim();
    if key.is_empty() {
        return Ok(ApiKeyOwnerDetectResult {
            ok: false,
            owner_user_id: None,
            message: "Please enter an OpenCloud API key to detect its owner.".to_string(),
        });
    }

    let client = crate::utils::get_http_client();

    let payload = serde_json::json!({
        "assetType": "Decal",
        "displayName": "ownership-probe",
        "description": "probe",
        "creationContext": { "creator": { "userId": "1" } }
    });

    let part = reqwest::multipart::Part::bytes(vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2,
        0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ])
    .file_name("probe.png")
    .mime_str("image/png")
    .map_err(|e| crate::error::AppError::Custom(format!("MIME error: {e}")))?;

    let form = reqwest::multipart::Form::new()
        .text("request", serde_json::to_string(&payload).unwrap_or_default())
        .part("fileContent", part);

    let res = client
        .post("https://apis.roblox.com/assets/v1/assets")
        .header("x-api-key", key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            crate::error::AppError::Custom(format!("Could not reach Roblox Open Cloud API: {e}"))
        })?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(ApiKeyOwnerDetectResult {
            ok: false,
            owner_user_id: None,
            message: "The provided OpenCloud API key is invalid, inactive, or unauthorized."
                .to_string(),
        });
    }

    if let Some(caps) = opencloud_error_regex().captures(&text) {
        if let Some(owner) = caps.get(1) {
            return Ok(ApiKeyOwnerDetectResult {
                ok: true,
                owner_user_id: Some(owner.as_str().to_string()),
                message: format!(
                    "Successfully identified API key owner (user ID {}).",
                    owner.as_str()
                ),
            });
        }
    }

    Ok(ApiKeyOwnerDetectResult {
        ok: false,
        owner_user_id: None,
        message: "Unable to determine the owner of this API key. Ensure the key has permissions to create assets in your Creator Hub.".to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn validate_opencloud_api_key(key: String) -> crate::error::Result<bool> {
    let result = detect_opencloud_api_key_owner(key).await?;

    Ok(result.ok)
}

#[tauri::command]
#[specta::specta]
pub async fn get_auth_metadata() -> crate::error::Result<crate::commands::AnyValue> {
    let url = "https://auth.roblox.com/v2/metadata";
    let client = crate::utils::get_http_client();

    let res =
        client.get(url).header("User-Agent", ROBLOX_USER_AGENT).send().await.map_err(|e| {
            crate::error::AppError::Custom(format!(
                "Could not reach Roblox auth metadata service: {e}"
            ))
        })?;

    if !res.status().is_success() {
        return Err(format!(
            "Could not retrieve authentication metadata from Roblox (HTTP {}).",
            res.status()
        )
        .into());
    }

    let json: serde_json::Value = res.json().await.map_err(|e| {
        crate::error::AppError::Custom(format!("Could not parse auth metadata response: {e}"))
    })?;

    Ok(crate::commands::AnyValue(json))
}
