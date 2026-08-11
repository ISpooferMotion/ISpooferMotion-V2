//! Interfaces with the Roblox web API for asset resolution and verification.
//!
//! Because ISpooferMotion needs to spoof assets across the entire platform, we have
//! to constantly query Roblox's endpoints to figure out what type of asset an ID is,
//! who created it, and if it even exists. This module wraps those undocumented endpoints.

use crate::commands::spoofer::{wait_rate_limit, RateLimitBucket};
use crate::utils::build_roblox_cookie_header;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, COOKIE, ORIGIN, REFERER, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

/// Spoofs standard browser headers so Roblox does not immediately block our requests.
fn build_roblox_auth_headers(cookie: &HeaderValue) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(COOKIE, cookie.clone());
    headers.insert("Host", HeaderValue::from_static("apis.roblox.com"));
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"));
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(ORIGIN, HeaderValue::from_static("https://create.roblox.com"));
    headers.insert(REFERER, HeaderValue::from_static("https://create.roblox.com/"));
    headers
}

/// Grabs a fresh CSRF token from the Roblox catalog endpoint.
///
/// Most authenticated Roblox endpoints require a CSRF token. The standard way to get
/// one is to intentionally send a bad POST request, read the `x-csrf-token` header
/// from the 403 response, and use that for the real request.
async fn fetch_csrf_token(client: &reqwest::Client) -> String {
    for _ in 0..2 {
        if let Ok(res) = client
            .post("https://catalog.roblox.com/v1/catalog/items/details")
            .header("Content-Length", "0")
            .send()
            .await
        {
            if let Some(token) = res.headers().get("x-csrf-token") {
                return token.to_str().unwrap_or_default().to_string();
            }
        }
    }
    String::new()
}

/// Resolves a batch of asset IDs by hitting the public catalog endpoint.
///
/// We use this to quickly categorize hundreds of IDs at once (Mesh vs Image vs Audio)
/// instead of hitting the individual details endpoint for every single asset.
async fn resolve_via_catalog(
    client: &reqwest::Client,
    asset_ids: &[String],
    map_unknowns: bool,
) -> HashMap<String, String> {
    let mut resolved = HashMap::new();
    let csrf_token = fetch_csrf_token(client).await;
    if csrf_token.is_empty() {
        return resolved;
    }

    let chunks = asset_ids.chunks(120);
    for chunk in chunks {
        let items: Vec<_> = chunk
            .iter()
            .filter_map(|id| {
                id.parse::<u64>()
                    .ok()
                    .map(|id_num| serde_json::json!({ "itemType": "Asset", "id": id_num }))
            })
            .collect();

        if items.is_empty() {
            continue;
        }

        let payload = serde_json::json!({ "items": items });
        let req = client
            .post("https://catalog.roblox.com/v1/catalog/items/details")
            .header("x-csrf-token", &csrf_token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&payload);

        if let Ok(res) = req.send().await {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
                    for item in data {
                        if let (Some(id), Some(type_id)) = (
                            item.get("id").and_then(serde_json::Value::as_u64),
                            item.get("assetType").and_then(serde_json::Value::as_u64),
                        ) {
                            let category = match type_id {
                                24 => Some("animation"),
                                3 => Some("sound"),
                                1 | 11 | 13 | 2 | 21 | 22 | 38 => Some("image"),
                                40 | 43 | 17 | 12 => Some("mesh"),
                                _ => {
                                    if map_unknowns {
                                        Some("unknown")
                                    } else {
                                        None
                                    }
                                }
                            };
                            if let Some(cat) = category {
                                resolved.insert(id.to_string(), cat.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    resolved
}

#[derive(Serialize, Deserialize, Clone, Debug, specta::Type)]
pub struct ResolverAsset {
    #[serde(rename = "assetId")]
    pub asset_id: String,
    pub name: Option<String>,
    pub creator: Option<String>,
    #[serde(rename = "creatorId")]
    pub creator_id: Option<String>,
    #[serde(rename = "creatorType")]
    pub creator_type: Option<String>,
}

#[derive(Serialize, Clone, specta::Type)]
pub struct ResolverProgress {
    #[specta(type = u32)]
    pub resolved: usize,
    #[specta(type = u32)]
    pub total: usize,
    pub message: String,
    pub asset_id: String,
    pub success: Option<bool>,
}

#[derive(Deserialize, Debug, specta::Type)]
pub struct RobloxCreatorContext {
    pub creator: Option<RobloxCreatorIds>,
}

#[derive(Deserialize, Debug, specta::Type)]
pub struct RobloxCreatorIds {
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
}

#[derive(Deserialize, Debug, specta::Type)]
pub struct RobloxAssetAuthResponse {
    #[serde(rename = "creationContext")]
    pub creation_context: Option<RobloxCreatorContext>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    pub name: Option<String>,
}

/// Hits the user-auth API to find out exactly who created a specific asset.
async fn resolve_single_asset_creator<F, C>(
    mut asset: ResolverAsset,
    sem: Arc<Semaphore>,
    cli: reqwest::Client,
    cookie_value: Arc<HeaderValue>,
    prog_clone: Arc<F>,
    cookie_cb_clone: Arc<C>,
) -> (ResolverAsset, String, bool)
where
    F: Fn(ResolverProgress) + Send + Sync + 'static,
    C: Fn(&reqwest::Response, &str) + Send + Sync + 'static,
{
    let Ok(_permit) = sem.acquire().await else {
        return (asset, "Resolver concurrency limiter closed".to_string(), false);
    };

    let headers = build_roblox_auth_headers(&cookie_value);

    let url = format!("https://apis.roblox.com/assets/user-auth/v1/assets/{}", asset.asset_id);
    let mut success = false;
    let mut msg = String::new();

    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(5)).await;
        }

        wait_rate_limit(RateLimitBucket::AssetResolve).await;
        let res = cli.get(&url).headers(headers.clone()).send().await;
        match res {
            Ok(resp) => {
                if let Ok(cookie_str) = (*cookie_value).to_str() {
                    cookie_cb_clone(&resp, cookie_str);
                }

                if resp.status().as_u16() == 429 {
                    msg = format!("Rate limited, retrying ({}/3)", attempt + 1);
                    prog_clone(ResolverProgress {
                        resolved: 0,
                        total: 0,
                        message: msg.clone(),
                        asset_id: asset.asset_id.clone(),
                        success: None,
                    });
                    continue;
                }

                if resp.status().is_success() {
                    let text = resp.text().await.unwrap_or_default();
                    if let Ok(data) = serde_json::from_str::<RobloxAssetAuthResponse>(&text) {
                        if let Some(dn) = data.display_name.or(data.name) {
                            asset.name = Some(dn);
                        }
                        if let Some(ctx) = data.creation_context {
                            if let Some(c) = ctx.creator {
                                if let Some(uid) = c.user_id {
                                    asset.creator_id = Some(uid.clone());
                                    asset.creator_type = Some("User".into());
                                    asset.creator = Some(uid.clone());
                                    success = true;
                                    msg = format!("Found: User {uid}");
                                } else if let Some(gid) = c.group_id {
                                    asset.creator_id = Some(gid.clone());
                                    asset.creator_type = Some("Group".into());
                                    asset.creator = Some(gid.clone());
                                    success = true;
                                    msg = format!("Found: Group {gid}");
                                }
                            }
                        }
                        if !success {
                            msg = "No creator info in response".to_string();
                        }
                    } else {
                        msg = "Failed to parse API response".to_string();
                    }
                } else {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    let parsed_err =
                        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&text) {
                            crate::utils::extract_human_error(&json_val, Some(status.as_u16()))
                        } else {
                            format!("HTTP {}: {}", status.as_u16(), text)
                        };
                    msg = format!("API returned error: {parsed_err}");
                }
                break;
            }
            Err(e) => {
                msg = format!("Request error: {e}");
            }
        }
    }

    (asset, msg, success)
}

/// Takes a list of raw assets, drops those we already know the creator for,
/// and concurrently fetches the rest from Roblox.
pub async fn resolve_asset_creators<F, C>(
    assets: Vec<ResolverAsset>,
    cookie: String,
    on_progress: F,
    on_cookie: C,
) -> crate::error::Result<Vec<ResolverAsset>>
where
    F: Fn(ResolverProgress) + Send + Sync + 'static,
    C: Fn(&reqwest::Response, &str) + Send + Sync + 'static,
{
    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err("Missing or invalid ROBLOSECURITY cookie".into());
    }

    let (needs_resolution, mut resolved_assets): (Vec<_>, Vec<_>) = assets
        .into_iter()
        .partition(|a| a.creator.as_deref() == Some("Unknown") || a.creator.is_none());

    let total = needs_resolution.len();
    if total == 0 {
        return Ok(resolved_assets);
    }

    let client = crate::utils::build_client_with_timeout(Duration::from_secs(10));
    let cookie_header_value = Arc::new(HeaderValue::from_str(&cookie_header)?);

    let semaphore = Arc::new(Semaphore::new(8));
    let on_progress = Arc::new(on_progress);
    let on_cookie = Arc::new(on_cookie);

    let mut tasks = Vec::with_capacity(needs_resolution.len());

    for asset in needs_resolution {
        tasks.push(tokio::spawn(resolve_single_asset_creator(
            asset,
            Arc::clone(&semaphore),
            client.clone(),
            Arc::clone(&cookie_header_value),
            Arc::clone(&on_progress),
            Arc::clone(&on_cookie),
        )));
    }

    let results = futures::future::join_all(tasks).await;
    for (index, res) in results.into_iter().flatten().enumerate() {
        let (asset, msg, success) = res;
        on_progress(ResolverProgress {
            resolved: index + 1,
            total,
            message: msg,
            asset_id: asset.asset_id.clone(),
            success: Some(success),
        });
        resolved_assets.push(asset);
    }

    Ok(resolved_assets)
}

#[derive(Deserialize, Debug, specta::Type)]
pub struct EconomyAssetDetails {
    #[serde(rename = "AssetTypeId")]
    pub asset_type_id: Option<i64>,
}

#[derive(Serialize, Clone, specta::Type)]
pub struct ScriptRefProgress {
    #[specta(type = u32)]
    pub resolved: usize,
    #[specta(type = u32)]
    pub total: usize,
    pub asset_id: String,
    pub resolved_category: Option<String>,
}

/// Resolves raw numeric IDs extracted from script source code.
///
/// Because scripts often contain random numbers that are not actually asset IDs,
/// this validates them against the catalog and the batch asset delivery endpoints
/// to filter out false positives.
pub async fn resolve_script_references<F>(
    asset_ids: Vec<String>,
    on_progress: F,
) -> crate::error::Result<HashMap<String, String>>
where
    F: Fn(ScriptRefProgress) + Send + Sync + 'static,
{
    let total = asset_ids.len();
    if total == 0 {
        return Ok(HashMap::new());
    }

    let client = crate::utils::build_client_with_timeout(Duration::from_secs(5));
    let mut resolved_map = resolve_via_catalog(&client, &asset_ids, false).await;

    let mut remaining_ids = asset_ids;
    remaining_ids.retain(|id| !resolved_map.contains_key(id));

    let mut resolved_count = total - remaining_ids.len();

    on_progress(ScriptRefProgress {
        resolved: resolved_count,
        total,
        asset_id: String::new(),
        resolved_category: None,
    });

    let valid_ids: Vec<String> =
        remaining_ids.into_iter().filter(|id| id.parse::<u64>().is_ok()).collect();

    for chunk in valid_ids.chunks(100) {
        let items: Vec<serde_json::Value> = chunk
            .iter()
            .map(|id| {
                serde_json::json!({
                    "assetId": id.parse::<u64>().unwrap_or(0),
                    "requestId": id
                })
            })
            .collect();

        crate::commands::spoofer::wait_rate_limit(
            crate::commands::spoofer::RateLimitBucket::AssetResolve,
        )
        .await;

        if let Ok(resp) = client
            .post("https://assetdelivery.roblox.com/v2/assets/batch")
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&items)
            .send()
            .await
        {
            if let Ok(json) = resp.json::<Vec<serde_json::Value>>().await {
                for item in json {
                    if let Some(request_id) = item.get("requestId").and_then(|v| v.as_str()) {
                        let mut is_false_positive = false;
                        let mut category = None;

                        if let Some(errors) = item.get("errors").and_then(|v| v.as_array()) {
                            if errors.iter().any(|e| {
                                let code = e.get("code").and_then(serde_json::Value::as_u64);
                                code == Some(404) || code == Some(401) || code == Some(403)
                            }) {
                                is_false_positive = true;
                            }
                        }

                        if !is_false_positive {
                            if let Some(type_id) =
                                item.get("assetTypeId").and_then(serde_json::Value::as_u64)
                            {
                                category = match type_id {
                                    24 => Some("animation".to_string()),
                                    3 => Some("sound".to_string()),
                                    1 | 11 | 13 | 2 | 21 | 22 | 38 => Some("image".to_string()),
                                    40 | 43 | 17 | 12 => Some("mesh".to_string()),
                                    _ => {
                                        if type_id == 0 {
                                            is_false_positive = true;
                                        }
                                        None
                                    }
                                };
                            }
                        }

                        let final_cat = if is_false_positive {
                            Some("false_positive".to_string())
                        } else {
                            category
                        };

                        if let Some(cat) = &final_cat {
                            resolved_map.insert(request_id.to_string(), cat.clone());
                        }

                        resolved_count += 1;
                        on_progress(ScriptRefProgress {
                            resolved: resolved_count,
                            total,
                            asset_id: request_id.to_string(),
                            resolved_category: final_cat,
                        });
                    }
                }
            }
        }
    }

    Ok(resolved_map)
}

/// Confirms that scraped asset IDs actually exist on Roblox and determines their type.
///
/// Falls back to the slow economy details endpoint for assets that the catalog
/// refuses to resolve (like off-sale meshes or private decals).
pub async fn validate_asset_ids(
    asset_ids: Vec<String>,
) -> crate::error::Result<HashMap<String, String>> {
    if asset_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let client = crate::utils::build_client_with_timeout(Duration::from_secs(5));
    let mut result_map = resolve_via_catalog(&client, &asset_ids, true).await;

    let mut remaining_ids = asset_ids;
    remaining_ids.retain(|id| !result_map.contains_key(id));

    if remaining_ids.is_empty() {
        return Ok(result_map);
    }

    let semaphore = Arc::new(Semaphore::new(12));
    let mut tasks = Vec::with_capacity(remaining_ids.len());

    for asset_id in remaining_ids {
        let sem = Arc::clone(&semaphore);
        let cli = client.clone();

        tasks.push(tokio::spawn(async move {
            let Ok(_permit) = sem.acquire().await else {
                return (asset_id, "unknown".to_string());
            };

            let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");

            for attempt in 0..3 {
                if attempt > 0 {
                    tokio::time::sleep(Duration::from_millis(1500 * attempt)).await;
                }

                crate::commands::spoofer::wait_rate_limit(
                    crate::commands::spoofer::RateLimitBucket::AssetResolve,
                )
                .await;

                if let Ok(resp) = cli.get(&url).send().await {
                    let status = resp.status().as_u16();
                    if status == 429 {
                        continue;
                    }
                    if status == 404 || status == 401 || status == 403 {
                        return (asset_id, "false_positive".to_string());
                    }
                    if resp.status().is_success() {
                        if let Ok(data) = resp.json::<EconomyAssetDetails>().await {
                            if let Some(type_id) = data.asset_type_id {
                                let category = match type_id {
                                    24 => "animation",
                                    3 => "sound",
                                    1 | 11 | 13 | 2 | 21 | 22 | 38 => "image",
                                    40 | 43 | 17 | 12 => "mesh",
                                    0 => "false_positive",
                                    _ => "unknown",
                                };
                                return (asset_id, category.to_string());
                            }
                        }
                    }
                    break;
                }
            }

            (asset_id, "unknown".to_string())
        }));
    }

    let results = futures::future::join_all(tasks).await;
    for res in results.into_iter().flatten() {
        let (asset_id, category) = res;
        result_map.insert(asset_id, category);
    }

    Ok(result_map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_roblox_auth_headers() {
        let cookie_val = HeaderValue::from_str("some_cookie=123").expect("cookie str");
        let headers = build_roblox_auth_headers(&cookie_val);

        assert_eq!(headers.get(COOKIE).expect("cookie header"), "some_cookie=123");
        assert_eq!(headers.get("Host").expect("host header"), "apis.roblox.com");
        assert_eq!(headers.get(ACCEPT).expect("accept header"), "*/*");
        assert_eq!(headers.get(ACCEPT_LANGUAGE).expect("accept language header"), "en-US,en;q=0.9");
        assert_eq!(headers.get(ORIGIN).expect("origin header"), "https://create.roblox.com");
        assert_eq!(headers.get(REFERER).expect("referer header"), "https://create.roblox.com/");

        let user_agent =
            headers.get(USER_AGENT).expect("user agent header").to_str().expect("user agent str");
        assert!(user_agent.contains("Mozilla/5.0"));
        // Just checking it exists
    }

    #[test]
    fn test_resolver_asset_struct() {
        let json = r#"{
            "assetId": "12345",
            "name": "Cool Asset",
            "creator": "111",
            "creatorId": "111",
            "creatorType": "User"
        }"#;

        let asset: ResolverAsset = serde_json::from_str(json).expect("valid json");
        assert_eq!(asset.asset_id, "12345");
        assert_eq!(asset.name.expect("name"), "Cool Asset");
        assert_eq!(asset.creator_id.expect("creator_id"), "111");
        assert_eq!(asset.creator_type.expect("creator_type"), "User");
    }

    #[test]
    fn test_roblox_asset_auth_response_parsing() {
        let json = r#"{
            "creationContext": {
                "creator": {
                    "userId": "999"
                }
            },
            "displayName": "Asset Display",
            "name": "Asset Name"
        }"#;

        let resp: RobloxAssetAuthResponse = serde_json::from_str(json).expect("valid json");
        assert_eq!(resp.display_name.expect("display name"), "Asset Display");
        assert_eq!(resp.name.expect("name"), "Asset Name");

        let creator = resp.creation_context.expect("creation context").creator.expect("creator");
        assert_eq!(creator.user_id.expect("user id"), "999");
        assert!(creator.group_id.is_none());
    }

    #[test]
    fn test_roblox_asset_auth_response_parsing_group() {
        let json = r#"{
            "creationContext": {
                "creator": {
                    "groupId": "777"
                }
            },
            "name": "Group Asset"
        }"#;

        let resp: RobloxAssetAuthResponse = serde_json::from_str(json).expect("valid json");
        assert!(resp.display_name.is_none());
        assert_eq!(resp.name.expect("name"), "Group Asset");

        let creator = resp.creation_context.expect("creation context").creator.expect("creator");
        assert_eq!(creator.group_id.expect("group id"), "777");
        assert!(creator.user_id.is_none());
    }
}
