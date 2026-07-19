pub mod api;
pub mod resolution;
pub mod types;
pub mod validation;

pub use api::{
    auto_claim_free_asset, batch_get_download_urls_for_assets, send_asset_download_request_ua,
    write_download_response,
};
pub use resolution::{
    attempt_asset_usage_place_id_discovery, attempt_deep_place_id_discovery,
    attempt_social_graph_place_id_discovery, build_cdn_fallback_urls,
    build_direct_asset_download_urls, build_saved_versions_urls, extract_place_id_from_url,
    parse_place_ids, push_unique_url, resolve_asset_economy_urls, resolve_asset_id_location,
};
pub use types::ConcurrentDownloadTask;
pub use validation::validate_downloaded_payload;

use crate::commands::spoofer::{
    build_roblox_cookie_header, emit_transfer_update, is_valid_numeric_id, set_rate_limit,
    wait_rate_limit, AsyncWriteExt, BatchAssetRequest, DownloadResult, File, RateLimitBucket,
    TransferUpdate, CONTENT_LENGTH,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

fn emit_spoofer_log(app: &AppHandle, level: &str, message: &str) {
    let _ = crate::commands::ipc::append_log_entry(app, level, "spoofer", message);
    let _ = app.emit(
        "spoofer-log",
        serde_json::json!({
            "message": message,
            "level": level,
        }),
    );
}

// Download orchestration: manages discovery, resolution, fallbacks, and retries.
pub async fn download_animation_asset_with_progress(
    app: AppHandle,
    direct_url: Option<String>,
    cookie: String,
    fallback_cookies: Option<Vec<String>>,
    file_path: String,
    transfer_id: String,
    name: String,
    asset_id: String,
    asset_type: Option<String>,
    place_id: Option<String>,
    enable_archive_recovery: bool,
    proxy_url: Option<String>,
) -> crate::error::Result<DownloadResult> {
    if !is_valid_numeric_id(&asset_id) {
        return Err("Invalid Roblox asset id.".into());
    }
    let file_path_buf = std::path::PathBuf::from(&file_path);
    if file_path_buf.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Invalid file path: path traversal detected.".into());
    }

    if let Some(parent) = file_path_buf.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| "Download output directory is unavailable.")?;
    }

    let mut cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err("Missing or invalid ROBLOSECURITY cookie".into());
    }

    emit_transfer_update(
        &app,
        TransferUpdate {
            id: transfer_id.clone(),
            name: Some(name.clone()),
            status: Some("processing".into()),
            direction: Some("download".into()),
            progress: Some(0),
            error: None,
            original_asset_id: Some(asset_id.clone()),
            size: None,
            new_asset_id: None,
        },
    );

    let client = crate::utils::get_http_client_with_proxy(proxy_url.as_deref());
    let mut place_ids = parse_place_ids(place_id.as_deref());

    if let Some(cached_place_id) =
        crate::commands::spoofer::remote_cache::get_local_context(&asset_id)
    {
        if !place_ids.contains(&cached_place_id) {
            place_ids.insert(0, cached_place_id);
        }
    }

    let mut candidate_urls = Vec::new();

    if let Some(url) = direct_url.clone().filter(|url| !url.trim().is_empty()) {
        push_unique_url(&mut candidate_urls, url);
    }

    for place_id in place_ids.iter().map(String::as_str).map(Some).chain(std::iter::once(None)) {
        if let Some(resolved_url) =
            resolve_asset_id_location(&app, &client, &asset_id, &cookie_header, place_id).await?
        {
            push_unique_url(&mut candidate_urls, resolved_url);
        }
    }

    for url in build_direct_asset_download_urls(&asset_id, asset_type.as_deref(), &place_ids) {
        push_unique_url(&mut candidate_urls, url);
    }

    for cdn_url in build_cdn_fallback_urls(&asset_id).await {
        push_unique_url(&mut candidate_urls, cdn_url);
    }

    for url in resolve_asset_economy_urls(&asset_id, &cookie_header).await {
        push_unique_url(&mut candidate_urls, url);
    }

    for url in build_saved_versions_urls(&asset_id, &cookie_header).await {
        push_unique_url(&mut candidate_urls, url);
    }

    if matches!(asset_type.as_deref(), Some("Audio") | Some("Sound")) {
        if let Some(cdn_url) = api::get_scraped_asset_cdn_url(&client, &asset_id).await {
            emit_spoofer_log(
                &app,
                "info",
                &format!("Web scraper fallback found CDN URL for audio asset {asset_id}."),
            );
            push_unique_url(&mut candidate_urls, cdn_url);
        }
    }

    // Always run usage and social-graph discovery regardless of whether a place_id was already
    // supplied. The user may have provided a stale/wrong place ID, and supplementary discovery
    let usage_place_ids = attempt_asset_usage_place_id_discovery(&asset_id, &cookie_header).await;
    if !usage_place_ids.is_empty() {
        emit_spoofer_log(
            &app,
            "info",
            &format!(
                "Asset usage discovery found {} candidate Place ID(s) for asset {asset_id}.",
                usage_place_ids.len()
            ),
        );
    }
    for place_id in &usage_place_ids {
        for url in build_direct_asset_download_urls(
            &asset_id,
            asset_type.as_deref(),
            std::slice::from_ref(place_id),
        ) {
            push_unique_url(&mut candidate_urls, url);
        }
    }

    let creator_place_ids =
        attempt_social_graph_place_id_discovery(&asset_id, &cookie_header).await;
    if !creator_place_ids.is_empty() {
        emit_spoofer_log(
            &app,
            "info",
            &format!(
                "Creator graph discovery found {} candidate Place ID(s) for asset {asset_id}.",
                creator_place_ids.len()
            ),
        );
    }
    for place_id in &creator_place_ids {
        for url in build_direct_asset_download_urls(
            &asset_id,
            asset_type.as_deref(),
            std::slice::from_ref(place_id),
        ) {
            push_unique_url(&mut candidate_urls, url);
        }
    }

    let universe_id = if let Some(pid) = place_ids.first() {
        crate::commands::spoofer::get_universe_id_from_place_id(pid.clone(), cookie.clone())
            .await
            .ok()
    } else {
        None
    };

    let mut last_error =
        "Download failed before Roblox returned a usable asset location.".to_string();
    let mut attempted_claim = false;
    let user_agents =
        ["RobloxStudio/WinInet", "RobloxApp/WinInet", "Roblox/WinInet", "roblox/9.0.0.0 (WinInet)"];

    // Iterate through candidate URLs until the file is successfully retrieved.
    let mut is_first_url = true;
    for download_url in &candidate_urls {
        let is_cdn_url = download_url.contains("rbxcdn.com");

        let resume_offset = if is_first_url {
            if let Ok(meta) = tokio::fs::metadata(&file_path).await {
                meta.len()
            } else {
                0
            }
        } else {
            0
        };
        is_first_url = false;

        for attempt in 0..10u64 {
            let ua = user_agents[attempt as usize % user_agents.len()];
            let request_place_id =
                extract_place_id_from_url(download_url).or_else(|| place_ids.first().cloned());
            let cookie_for_req = if is_cdn_url { None } else { Some(cookie_header.as_str()) };
            wait_rate_limit(RateLimitBucket::AssetDownload).await;
            let send_result = tokio::time::timeout(
                Duration::from_secs(45),
                send_asset_download_request_ua(
                    &client,
                    download_url,
                    cookie_for_req,
                    request_place_id.as_deref(),
                    ua,
                    universe_id.as_deref(),
                    resume_offset,
                ),
            )
            .await;
            let download_resp = match send_result {
                Ok(Ok(resp)) => resp,
                Ok(Err(error)) => {
                    last_error = format!("Download request failed: {error}");
                    if attempt < 4 {
                        tokio::time::sleep(Duration::from_millis(1000 * (attempt + 1))).await;
                        continue;
                    }
                    break;
                }
                Err(_elapsed) => {
                    last_error = "Download request timed out.".to_string();
                    if attempt < 4 {
                        tokio::time::sleep(Duration::from_millis(1000 * (attempt + 1))).await;
                        continue;
                    }
                    break;
                }
            };

            crate::utils::check_for_roblosecurity_update(&app, &download_resp, &cookie_header);
            let status = download_resp.status();

            if status.is_success() {
                crate::commands::spoofer::record_adaptive_success();

                let result = write_download_response(
                    &app,
                    download_resp,
                    file_path,
                    transfer_id,
                    name,
                    asset_id.clone(),
                    asset_type.clone(),
                    resume_offset,
                )
                .await;

                let mut final_result = result;
                if final_result.is_ok() {
                    if let Ok(res) = final_result.as_mut() {
                        res.resolved_place_id = request_place_id.clone();
                    }
                }

                return final_result;
            }

            let mut status_reason = status.to_string();
            if status == reqwest::StatusCode::UNAUTHORIZED {
                let error_msg = "Your ROBLOSECURITY cookie is missing, invalid, or expired. Please update it in settings.".to_string();
                emit_transfer_update(
                    &app,
                    TransferUpdate {
                        id: transfer_id.clone(),
                        status: Some("error".into()),
                        error: Some(error_msg.clone()),
                        progress: Some(0),
                        name: None,
                        original_asset_id: None,
                        direction: None,
                        size: None,
                        new_asset_id: None,
                    },
                );
                return Ok(DownloadResult {
                    success: false,
                    file_path: None,
                    error: Some(error_msg),
                    resolved_place_id: None,
                });
            } else if status == reqwest::StatusCode::FORBIDDEN {
                status_reason = "Permission Denied: Asset is private or copylocked.".to_string();
            } else if status == reqwest::StatusCode::NOT_FOUND {
                status_reason = "Not Found: Asset is invalid or missing.".to_string();
            } else if status == reqwest::StatusCode::CONFLICT {
                status_reason = "Conflict: Asset delivery blocked.".to_string();
            }

            last_error = format!("Download failed: {status_reason} from {download_url}");
            crate::commands::spoofer::remote_cache::invalidate_context(&asset_id);

            if should_attempt_claim(status) && !attempted_claim {
                attempted_claim = true;
                if let Ok(true) =
                    auto_claim_free_asset(&app, &client, &asset_id, &cookie_header).await
                {
                    continue;
                }
            }

            if status == reqwest::StatusCode::FORBIDDEN && attempt < 2 {
                tokio::time::sleep(Duration::from_millis(1000 * (attempt + 1))).await;
                continue;
            }

            if is_retryable_download_status(status) && attempt < 9 {
                // 429 and 5xx are transient - worth retrying on the same URL.
                let retry_after_ms = crate::utils::extract_retry_after(&download_resp, None)
                    .unwrap_or_else(|| 800 * (attempt + 1));
                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    if let Some(ref fallbacks) = fallback_cookies {
                        let mut current_idx = 0;
                        for (i, fc) in fallbacks.iter().enumerate() {
                            if cookie_header.contains(fc) {
                                current_idx = i + 1;
                                break;
                            }
                        }
                        if current_idx < fallbacks.len() {
                            let next_cookie = fallbacks[current_idx].clone();
                            cookie_header = build_roblox_cookie_header(&next_cookie);
                            emit_spoofer_log(
                                &app,
                                "info",
                                &format!(
                                    "Rate limited downloading asset {asset_id}. Switching to fallback downloader {}/{}...",
                                    current_idx + 1, fallbacks.len()
                                ),
                            );
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            continue; // Retry the same URL with the new cookie
                        }
                    }

                    crate::commands::spoofer::record_adaptive_rate_limit(Some(retry_after_ms));
                    set_rate_limit(
                        RateLimitBucket::AssetDownload,
                        Duration::from_millis(retry_after_ms),
                    );
                    emit_spoofer_log(
                        &app,
                        "warn",
                        &format!(
                            "Roblox rate limited download for asset {asset_id}; backing off for {:.1}s.",
                            retry_after_ms as f64 / 1000.0
                        ),
                    );
                } else if status.is_server_error() {
                    crate::commands::spoofer::record_adaptive_server_error();
                }
                tokio::time::sleep(Duration::from_millis(retry_after_ms)).await;
                continue;
            }

            // 403, 404, 409 on a specific URL are permanent for that URL.
            // Breaking immediately lets us try the next candidate without burning
            // 10 × backoff iterations on a URL that will never succeed (V1 behavior).
            break;
        }
    }

    // Fall back to the Wayback Machine if all other resolution methods fail.
    if place_ids.is_empty()
        && (last_error.contains("Permission Denied") || last_error.contains("Conflict"))
    {
        if enable_archive_recovery {
            emit_transfer_update(
                &app,
                TransferUpdate {
                    id: transfer_id.clone(),
                    status: Some("processing".into()),
                    error: None,
                    progress: Some(0),
                    name: Some(format!("{name} (Wayback Discovery)")),
                    original_asset_id: Some(asset_id.clone()),
                    direction: Some("download".into()),
                    size: None,
                    new_asset_id: None,
                },
            );

            let recovery_error = match attempt_deep_place_id_discovery(
                &app,
                &asset_id,
                &cookie_header,
                20,
            )
            .await
            {
                Ok(recovered_place_ids) => {
                    if recovered_place_ids.is_empty() {
                        "Wayback Discovery found no place IDs.".to_string()
                    } else {
                        let _ = crate::commands::ipc::append_log_entry(&app, "info", "spoofer", &format!("Wayback Discovery found {} candidate Place ID(s). Retrying download...", recovered_place_ids.len()));

                        return Box::pin(download_animation_asset_with_progress(
                            app.clone(),
                            direct_url,
                            cookie,
                            fallback_cookies,
                            file_path,
                            transfer_id,
                            name,
                            asset_id,
                            asset_type,
                            Some(recovered_place_ids.join(",")),
                            false,
                            proxy_url.clone(),
                        ))
                        .await;
                    }
                }
                Err(e) => {
                    format!("Wayback Discovery error: {e}")
                }
            };
            last_error.push_str(&format!(" {recovery_error}"));
        }

        last_error.push_str(
            " No Place ID was available for place-scoped asset delivery; set Force Place ID(s) or scan a published Studio place.",
        );
    }
    emit_transfer_update(
        &app,
        TransferUpdate {
            id: transfer_id.clone(),
            status: Some("error".into()),
            error: Some(last_error.clone()),
            progress: Some(0),
            name: None,
            original_asset_id: None,
            direction: None,
            size: None,
            new_asset_id: None,
        },
    );

    Ok(DownloadResult {
        success: false,
        file_path: None,
        error: Some(last_error),
        resolved_place_id: None,
    })
}

fn should_attempt_claim(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::CONFLICT
        || status == reqwest::StatusCode::FORBIDDEN
        || status == reqwest::StatusCode::NOT_FOUND
}

fn is_retryable_download_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_download_urls_do_not_use_zero_server_place_id() {
        let urls =
            build_direct_asset_download_urls("123456789", Some("animation"), &["987654321".into()]);
        assert!(!urls.iter().any(|url| url.contains("serverplaceid=0")));
        assert!(urls.iter().any(|url| url.contains("serverplaceid=987654321")));
    }

    #[tokio::test]
    async fn validation_rejects_error_page_downloads() -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join("ispoofer-invalid-download.html");
        tokio::fs::write(&path, b"<!doctype html><title>Forbidden</title>").await?;
        let path_string = path.to_string_lossy().to_string();
        let result = validate_downloaded_payload(&path_string, Some("audio")).await;
        let _ = tokio::fs::remove_file(path).await;
        assert!(result.is_err());
        Ok(())
    }
}
