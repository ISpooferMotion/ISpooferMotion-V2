use super::{
    apply_upload_auth, emit_transfer_update, is_valid_numeric_id, patch_asset_permissions,
    sanitize_filename, set_rate_limit, wait_rate_limit, AppHandle, Manager, PublishResult,
    RateLimitBucket, RobloxOperationResponse, TransferUpdate, Value,
};
use serde::Serialize;
use tauri::Emitter;

fn extract_asset_id_from_value(resp_obj: &serde_json::Value) -> Option<String> {
    resp_obj.get("assetId").or(resp_obj.get("Id")).and_then(|id| {
        id.as_str()
            .map(std::string::ToString::to_string)
            .or_else(|| id.as_u64().map(|n| n.to_string()))
    })
}

fn format_wait_seconds(milliseconds: u64) -> String {
    format!("{:.1}s", milliseconds as f64 / 1000.0)
}

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

const fn asset_type_id_is_image(type_id: i64) -> bool {
    matches!(type_id, 1 | 2 | 11 | 13 | 21 | 22 | 38)
}

async fn fetch_real_asset_type_id(asset_id: &str, cookie: &str) -> Option<i64> {
    let cookie_header = crate::utils::build_roblox_cookie_header(cookie);
    let client = crate::utils::get_http_client();
    let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
    let resp = client
        .get(&url)
        .header(reqwest::header::COOKIE, &cookie_header)
        .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data = resp.json::<crate::domain::roblox_api::EconomyAssetDetails>().await.ok()?;
    data.asset_type_id
}

#[derive(Serialize, specta::Type)]
struct UploadMetadataCreator {
    #[serde(skip_serializing_if = "Option::is_none", rename = "userId")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "groupId")]
    pub group_id: Option<String>,
}

#[derive(Serialize, specta::Type)]
struct UploadMetadataCreationContext {
    pub creator: UploadMetadataCreator,
    #[serde(skip_serializing_if = "Option::is_none", rename = "expectedPrice")]
    pub expected_price: Option<i64>,
}

#[derive(Serialize, specta::Type)]
struct UploadMetadata {
    #[serde(skip_serializing_if = "Option::is_none", rename = "assetType")]
    pub asset_type: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "creationContext")]
    pub creation_context: Option<UploadMetadataCreationContext>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "assetId")]
    pub asset_id: Option<String>,
}

async fn poll_roblox_operation(
    app: &AppHandle,
    client: &reqwest::Client,
    operation_path: &str,
    api_key: &str,
    transfer_id: &str,
    name: &str,
    original_asset_id: Option<&str>,
    poll_interval_ms: Option<u32>,
) -> Result<String, String> {
    let path = operation_path.trim_start_matches('/');
    let path =
        if path.starts_with("assets/v1/") { path.to_string() } else { format!("assets/v1/{path}") };
    let url = format!("https://apis.roblox.com/{path}");
    let target_interval = u64::from(poll_interval_ms.unwrap_or(250).clamp(100, 2000));
    for attempt in 0..150 {
        if attempt > 0 {
            let delay_ms = if attempt == 1 {
                target_interval.min(200)
            } else if attempt < 5 {
                target_interval.min(350)
            } else {
                target_interval
            };
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }
        wait_rate_limit(RateLimitBucket::OperationPoll).await;
        let resp = match apply_upload_auth(client.get(&url), api_key).send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("Operation poll request failed: {e}")),
        };
        if let Some(wait_ms) = crate::utils::extract_retry_after(&resp, None) {
            crate::commands::spoofer::record_explicit_rate_limit(wait_ms);
        }
        if !resp.status().is_success() {
            if resp.status() == 429 || resp.status() == 403 {
                let retry_after_ms = crate::utils::extract_retry_after(&resp, None).unwrap_or(2000);
                if resp.status() == 429 {
                    crate::commands::spoofer::record_adaptive_rate_limit(Some(retry_after_ms));
                    set_rate_limit(
                        RateLimitBucket::OperationPoll,
                        std::time::Duration::from_millis(retry_after_ms),
                    );
                    if attempt % 5 == 0 {
                        let message = format!(
                            "Roblox rate limited operation polling for {name}; checking again in {}.",
                            format_wait_seconds(retry_after_ms)
                        );
                        emit_spoofer_log(app, "warn", &message);
                        emit_transfer_update(
                            app,
                            TransferUpdate {
                                id: transfer_id.to_string(),
                                name: Some(name.to_string()),
                                status: Some("rate_limited".into()),
                                direction: Some("upload".into()),
                                progress: None,
                                error: Some(message),
                                original_asset_id: original_asset_id.map(str::to_string),
                                size: None,
                                new_asset_id: None,
                            },
                        );
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(retry_after_ms)).await;
                continue;
            }
            return Err(format!("Operation poll returned error: {}", resp.status()));
        }
        let text = resp.text().await.unwrap_or_default();
        if let Ok(parsed) = serde_json::from_str::<RobloxOperationResponse>(&text) {
            if parsed.done == Some(true) {
                if let Some(error) = parsed.error {
                    let msg = crate::utils::extract_human_error(&error, None);
                    return Err(format!("Roblox asset processing failed: {msg}"));
                }
                if let Some(resp_obj) = parsed.response {
                    let id = extract_asset_id_from_value(&resp_obj);
                    if let Some(asset_id) = id {
                        return Ok(asset_id);
                    }
                }
                return Err(
                    "Roblox completed asset processing, but did not return a new asset ID.".into(),
                );
            }
        }
    }
    Err("Asset processing timed out after 120 seconds. Roblox may still be processing the asset in the background.".into())
}

struct UploadKind {
    asset_type: String,
    file_type: String,
    extension: String,
    needs_universe_permissions: bool,
}

fn upload_kind_for_type(asset_type_name: Option<&str>) -> UploadKind {
    match asset_type_name {
        Some("Mesh") => UploadKind {
            asset_type: "Mesh".into(),
            file_type: "model/x-rbxm".into(),
            extension: "mesh".into(),
            needs_universe_permissions: true,
        },
        Some("Audio") => UploadKind {
            asset_type: "Audio".into(),
            file_type: "audio/ogg".into(),
            extension: "ogg".into(),
            needs_universe_permissions: false,
        },
        Some("Image") => UploadKind {
            asset_type: "Image".into(),
            file_type: "image/png".into(),
            extension: "png".into(),
            needs_universe_permissions: true,
        },
        Some("Plugin") => UploadKind {
            asset_type: "Plugin".into(),
            file_type: "model/x-rbxm".into(),
            extension: "rbxm".into(),
            needs_universe_permissions: false,
        },
        Some("Video") => UploadKind {
            asset_type: "Video".into(),
            file_type: "video/mp4".into(),
            extension: "mp4".into(),
            needs_universe_permissions: false,
        },
        Some("Font") => UploadKind {
            asset_type: "Font".into(),
            file_type: "font/ttf".into(),
            extension: "ttf".into(),
            needs_universe_permissions: false,
        },
        _ => UploadKind {
            asset_type: "Animation".into(),
            file_type: "model/x-rbxm".into(),
            extension: "rbxm".into(),
            needs_universe_permissions: false,
        },
    }
}

async fn upload_path_allowed(
    app: &AppHandle,
    file_path: &std::path::Path,
    downloads_root: Option<&str>,
) -> crate::error::Result<std::path::PathBuf> {
    let canonical_file_path = tokio::fs::canonicalize(file_path)
        .await
        .map_err(|_| "The requested file could not be found or accessed on your local disk.")?;

    let mut allowed_roots = vec![app.path().app_data_dir()?.join("downloads")];
    if let Some(root) = downloads_root.filter(|value| !value.trim().is_empty()) {
        allowed_roots.push(std::path::PathBuf::from(root));
    }

    for root in allowed_roots {
        if let Ok(canonical_root) = tokio::fs::canonicalize(&root).await {
            if canonical_file_path.ancestors().any(|a| a == canonical_root) {
                return Ok(canonical_file_path);
            }
        }
    }

    Err("For security, asset uploads must originate from within the downloads folder.".into())
}

#[tauri::command]
#[specta::specta]
pub async fn publish_asset_with_progress(
    app: AppHandle,
    file_path: String,
    name: String,
    description: String,
    cookie: String,
    csrf_token: String,
    group_id: Option<String>,
    transfer_id: String,
    asset_type_name: Option<String>,
    api_key: Option<String>,
    user_id: Option<String>,
    _replace_existing: bool,
    original_asset_id: Option<String>,
    universe_id: Option<String>,
    downloads_root: Option<String>,
    proxy_url: Option<String>,
    operation_poll_interval_ms: Option<u32>,
) -> crate::error::Result<PublishResult> {
    for id in [group_id.as_deref(), user_id.as_deref(), original_asset_id.as_deref()]
        .into_iter()
        .flatten()
    {
        if !is_valid_numeric_id(id) {
            return Err("Invalid creator or asset ID: IDs must contain only numeric digits.".into());
        }
    }
    let canonical_file_path =
        upload_path_allowed(&app, std::path::Path::new(&file_path), downloads_root.as_deref())
            .await?;

    let file_metadata = match tokio::fs::metadata(&canonical_file_path).await {
        Ok(m) => m,
        Err(e) => {
            let msg = format!("Could not read local file metadata: {e}");
            emit_transfer_update(
                &app,
                TransferUpdate {
                    id: transfer_id.clone(),
                    name: Some(name.clone()),
                    status: Some("error".into()),
                    direction: Some("upload".into()),
                    error: Some(msg.clone()),
                    original_asset_id: None,
                    progress: None,
                    size: None,
                    new_asset_id: None,
                },
            );
            return Ok(PublishResult {
                success: false,
                error: Some(msg),
                asset_id: None,
                replaced_id: None,
            });
        }
    };

    emit_transfer_update(
        &app,
        TransferUpdate {
            id: transfer_id.clone(),
            name: Some(name.clone()),
            size: Some(file_metadata.len()),
            status: Some("processing".into()),
            direction: Some("upload".into()),
            progress: Some(0),
            error: None,
            original_asset_id: None,
            new_asset_id: None,
        },
    );

    let mut upload_kind = upload_kind_for_type(asset_type_name.as_deref());

    match crate::commands::spoofer::inspector::inspect_payload(&canonical_file_path).await {
        Ok(meta) => {
            if meta.extension != "unknown" {
                upload_kind.file_type = meta.file_type.clone();
                upload_kind.extension = meta.extension.clone();

                let is_image_payload =
                    meta.file_type == "image/png" || meta.file_type == "image/jpeg";

                if is_image_payload && asset_type_name.as_deref() == Some("Mesh") {
                    upload_kind.asset_type = "Image".into();
                    upload_kind.needs_universe_permissions = true;
                }

                let mismatch = is_image_payload
                    && !matches!(
                        asset_type_name.as_deref(),
                        Some("Image") | Some("Decal") | Some("Mesh")
                    );
                let confirmed_real_image = if mismatch {
                    match original_asset_id.as_deref() {
                        Some(id) => matches!(
                            fetch_real_asset_type_id(id, &cookie).await,
                            Some(tid) if asset_type_id_is_image(tid)
                        ),
                        None => false,
                    }
                } else {
                    false
                };

                if confirmed_real_image {
                    emit_spoofer_log(
                        &app,
                        "info",
                        &format!(
                            "Asset {} is actually an Image (was typed '{}'); uploading it as an Image instead of discarding it.",
                            original_asset_id.as_deref().unwrap_or("?"),
                            asset_type_name.as_deref().unwrap_or("unknown"),
                        ),
                    );
                    upload_kind.asset_type = "Image".into();
                    upload_kind.needs_universe_permissions = true;
                }

                if mismatch && !confirmed_real_image {
                    let type_label = asset_type_name.as_deref().unwrap_or("unknown");
                    let article = match type_label.chars().next() {
                        Some(c) if "AEIOUaeiou".contains(c) => "an",
                        _ => "a",
                    };
                    let msg = format!(
                        "Download returned a placeholder image for {article} {type_label} asset (Roblox refused access, usually because the cookie or forced Place ID can't see this asset). Skipping upload to avoid pasting an image id into an {type_label} slot in Studio."
                    );
                    emit_transfer_update(
                        &app,
                        TransferUpdate {
                            id: transfer_id.clone(),
                            status: Some("error".into()),
                            error: Some(msg.clone()),
                            progress: Some(0),
                            name: None,
                            original_asset_id: None,
                            direction: None,
                            size: None,
                            new_asset_id: None,
                        },
                    );
                    return Ok(PublishResult {
                        success: false,
                        error: Some(msg),
                        asset_id: None,
                        replaced_id: None,
                    });
                }
            }
        }
        Err(e) => return Err(e),
    }

    let asset_type = upload_kind.asset_type;
    let file_type = upload_kind.file_type;
    let file_name = format!("{}.{}", sanitize_filename(&name), upload_kind.extension);
    let _is_plugin = asset_type_name.as_deref() == Some("Plugin");

    let mut fallback_buffer: Option<Vec<u8>> = None;
    let mut final_asset_id = None;

    {
        let upload_api_key = match &api_key {
            Some(k) if !k.trim().is_empty() => k.clone(),
            _ => {
                let msg = "Uploading assets requires an Open Cloud API key. Please configure your API key in Settings or Accounts.".to_string();
                emit_transfer_update(
                    &app,
                    TransferUpdate {
                        id: transfer_id.clone(),
                        status: Some("error".into()),
                        error: Some(msg.clone()),
                        progress: Some(0),
                        name: None,
                        original_asset_id: None,
                        direction: None,
                        size: None,
                        new_asset_id: None,
                    },
                );
                return Ok(PublishResult {
                    success: false,
                    error: Some(msg),
                    asset_id: None,
                    replaced_id: None,
                });
            }
        };

        let creator = if let Some(gid) = &group_id {
            UploadMetadataCreator { group_id: Some(gid.clone()), user_id: None }
        } else if let Some(uid) = &user_id {
            UploadMetadataCreator { user_id: Some(uid.clone()), group_id: None }
        } else {
            let msg = "Please select a creator account (user or group) before uploading assets."
                .to_string();
            emit_transfer_update(
                &app,
                TransferUpdate {
                    id: transfer_id.clone(),
                    status: Some("error".into()),
                    error: Some(msg.clone()),
                    progress: Some(0),
                    name: None,
                    original_asset_id: None,
                    direction: None,
                    size: None,
                    new_asset_id: None,
                },
            );
            return Ok(PublishResult {
                success: false,
                error: Some(msg),
                asset_id: None,
                replaced_id: None,
            });
        };

        let expected_price =
            if asset_type == "Audio" || asset_type == "Video" { Some(0) } else { None };

        let mut request_metadata = UploadMetadata {
            asset_type: Some(asset_type.clone()),
            display_name: name.clone(),
            description: description.clone(),
            creation_context: Some(UploadMetadataCreationContext { creator, expected_price }),
            asset_id: None,
        };

        let client = crate::utils::get_http_client_with_proxy(proxy_url.as_deref());
        let url = "https://apis.roblox.com/assets/v1/assets";

        let mut meta_json = serde_json::to_string(&request_metadata)?;

        let mut upload_success = false;
        let mut upload_error = None;
        let mut operation_path = None;

        let mut tried_type_fallback = false;
        let mut tried_name_fallback = false;

        for attempt in 0..300 {
            wait_rate_limit(RateLimitBucket::Upload).await;

            let file_part = if let Some(buf) = &fallback_buffer {
                reqwest::multipart::Part::bytes(buf.clone())
                    .file_name(file_name.clone())
                    .mime_str(&file_type)?
            } else {
                let file =
                    tokio::fs::File::open(&canonical_file_path).await.map_err(|e| e.to_string())?;
                reqwest::multipart::Part::stream_with_length(file, file_metadata.len())
                    .file_name(file_name.clone())
                    .mime_str(&file_type)?
            };
            let form = reqwest::multipart::Form::new()
                .text("request", meta_json.clone())
                .part("fileContent", file_part);

            let resp = match apply_upload_auth(client.post(url), &upload_api_key)
                .multipart(form)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    upload_error = Some(e.to_string());
                    break;
                }
            };

            if let Some(wait_ms) = crate::utils::extract_retry_after(&resp, None) {
                crate::commands::spoofer::record_explicit_rate_limit(wait_ms);
            }

            let status = resp.status();
            let status_code = status.as_u16();

            if status_code == 401 {
                return Err(
                    "Your Open Cloud API key is invalid or unauthorized (HTTP 401). Please verify your key in Accounts."
                        .into(),
                );
            }

            if status_code == 403 {
                return Err("Upload rejected (HTTP 403). Ensure your Open Cloud API key has 'Assets' write permissions and that your IP address (or 0.0.0.0/0) is allowed in Creator Hub.".into());
            }

            if (500..600).contains(&status_code) {
                crate::commands::spoofer::record_adaptive_server_error();
                crate::commands::spoofer::set_circuit_breaker(std::time::Duration::from_secs(10));
                continue;
            }

            if status_code == 400
                && !tried_type_fallback
                && request_metadata.asset_type.as_deref() == Some("Plugin")
            {
                tried_type_fallback = true;
                request_metadata.asset_type = Some("Model".to_string());
                meta_json = serde_json::to_string(&request_metadata).unwrap_or(meta_json);
                continue;
            }

            if status_code == 400 && !tried_name_fallback {
                tried_name_fallback = true;
                request_metadata.display_name = "Spoofed Asset".to_string();
                request_metadata.description = "Uploaded by ISpooferMotion.".to_string();
                meta_json = serde_json::to_string(&request_metadata).unwrap_or(meta_json);
                continue;
            }

            if status_code == 409 {
                tried_type_fallback = false;
                tried_name_fallback = false;

                let mut mutable_buffer = if let Some(buf) = fallback_buffer.take() {
                    buf
                } else {
                    tokio::fs::read(&canonical_file_path).await.map_err(|e| e.to_string())?
                };
                {
                    if file_type == "image/png" {
                        let scan_start = mutable_buffer.len().saturating_sub(64);
                        if let Some(iend_offset) = mutable_buffer[scan_start..]
                            .windows(8)
                            .rposition(|window| window == b"\x00\x00\x00\x00IEND")
                        {
                            let iend_idx = scan_start + iend_offset;
                            let mut random_bytes = [0u8; 4];
                            random_bytes.copy_from_slice(&rand::random::<[u8; 4]>());
                            let chunk_data =
                                format!("ispoofer{}", hex::encode(random_bytes)).into_bytes();
                            let chunk_type = b"tEXt";
                            let mut chunk = Vec::new();
                            let chunk_len = u32::try_from(chunk_data.len()).unwrap_or(0);
                            chunk.extend_from_slice(&chunk_len.to_be_bytes());
                            chunk.extend_from_slice(chunk_type);
                            chunk.extend_from_slice(&chunk_data);
                            let mut crc_hasher = crc32fast::Hasher::new();
                            crc_hasher.update(chunk_type);
                            crc_hasher.update(&chunk_data);
                            chunk.extend_from_slice(&crc_hasher.finalize().to_be_bytes());

                            let mut new_buffer =
                                Vec::with_capacity(mutable_buffer.len() + chunk.len());
                            new_buffer.extend_from_slice(&mutable_buffer[..iend_idx]);
                            new_buffer.extend_from_slice(&chunk);
                            new_buffer.extend_from_slice(&mutable_buffer[iend_idx..]);
                            mutable_buffer = new_buffer;
                        } else {
                            upload_error =
                                Some("Could not bypass duplicate hash conflict: PNG file structure is invalid or corrupt.".to_string());
                            break;
                        }
                    } else if file_type == "model/x-rbxm" {
                        if mutable_buffer.starts_with(b"<roblox!") {
                            if let Some(idx) =
                                mutable_buffer.windows(4).rposition(|w| w == b"END\0")
                            {
                                let mut random_bytes = [0u8; 4];
                                random_bytes.copy_from_slice(&rand::random::<[u8; 4]>());
                                let mut chunk =
                                    b"DUMY\x04\x00\x00\x00\x04\x00\x00\x00\x00\x00\x00\x00"
                                        .to_vec();
                                chunk.extend_from_slice(&random_bytes);
                                let mut new_buffer =
                                    Vec::with_capacity(mutable_buffer.len() + chunk.len());
                                new_buffer.extend_from_slice(&mutable_buffer[..idx]);
                                new_buffer.extend_from_slice(&chunk);
                                new_buffer.extend_from_slice(&mutable_buffer[idx..]);
                                mutable_buffer = new_buffer;
                            } else {
                                upload_error = Some(
                                    "Could not bypass duplicate hash conflict: binary model file (RBXM) structure is invalid or corrupt.".to_string(),
                                );
                                break;
                            }
                        } else if mutable_buffer.starts_with(b"<roblox xmlns:xmime=")
                            || mutable_buffer.starts_with(b"<roblox xmlns=")
                            || (mutable_buffer.starts_with(b"<?xml")
                                && mutable_buffer.windows(7).take(256).any(|w| w == b"<roblox"))
                        {
                            let mut random_bytes = [0u8; 4];
                            random_bytes.copy_from_slice(&rand::random::<[u8; 4]>());
                            let hex_str = format!("<!-- ispoofer{} -->", hex::encode(random_bytes));
                            if let Some(idx) =
                                mutable_buffer.windows(9).rposition(|w| w == b"</roblox>")
                            {
                                let mut new_buffer =
                                    Vec::with_capacity(mutable_buffer.len() + hex_str.len());
                                new_buffer.extend_from_slice(&mutable_buffer[..idx]);
                                new_buffer.extend_from_slice(hex_str.as_bytes());
                                new_buffer.extend_from_slice(&mutable_buffer[idx..]);
                                mutable_buffer = new_buffer;
                            } else {
                                upload_error = Some(
                                    "Could not bypass duplicate hash conflict: XML model file (RBXMX) structure is invalid or corrupt.".to_string(),
                                );
                                break;
                            }
                        } else {
                            upload_error = Some(
                                "Could not bypass duplicate hash conflict: unrecognized model format.".to_string(),
                            );
                            break;
                        }
                    } else {
                        upload_error = Some("Could not bypass duplicate hash conflict: this file format does not support metadata padding.".to_string());
                        break;
                    }

                    fallback_buffer = Some(mutable_buffer);
                }
                continue;
            }

            if status_code == 429 {
                let retry_after_ms =
                    crate::utils::extract_retry_after(&resp, Some(attempt)).unwrap_or(30_000);
                let jitter_ms: u64 = {
                    use rand::Rng;
                    rand::rng().random_range(0..800)
                };
                let sleep_duration = retry_after_ms + jitter_ms;
                crate::commands::spoofer::record_adaptive_rate_limit(Some(sleep_duration));
                set_rate_limit(
                    RateLimitBucket::Upload,
                    std::time::Duration::from_millis(sleep_duration),
                );
                let message = format!(
                    "Roblox upload rate limit hit for {name}; backing off for {} before retry {} of 100.",
                    format_wait_seconds(sleep_duration),
                    attempt + 1
                );
                if crate::commands::spoofer::should_log_rate_limit_warning("upload") {
                    emit_spoofer_log(&app, "warn", &message);
                }
                emit_transfer_update(
                    &app,
                    TransferUpdate {
                        id: transfer_id.clone(),
                        name: Some(name.clone()),
                        status: Some("rate_limited".into()),
                        direction: Some("upload".into()),
                        progress: None,
                        error: Some(message),
                        original_asset_id: original_asset_id.clone(),
                        size: None,
                        new_asset_id: None,
                    },
                );
                continue;
            }

            let resp_text = resp.text().await.unwrap_or_default();

            if !status.is_success() {
                let parsed_err =
                    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&resp_text) {
                        crate::utils::extract_human_error(&json_val, Some(status.as_u16()))
                    } else {
                        format!("HTTP {}: {}", status.as_u16(), resp_text)
                    };
                upload_error = Some(format!("Upload failed: {parsed_err}"));
                break;
            }

            if let Ok(parsed) = serde_json::from_str::<RobloxOperationResponse>(&resp_text) {
                if parsed.done == Some(true) {
                    if let Some(resp_obj) = parsed.response {
                        let id = extract_asset_id_from_value(&resp_obj);
                        if let Some(aid) = id {
                            final_asset_id = Some(aid);
                            upload_success = true;
                            crate::commands::spoofer::record_adaptive_success();
                            break;
                        }
                    }
                } else if let Some(path) = parsed.path {
                    operation_path = Some(path);
                    upload_success = true;
                    crate::commands::spoofer::record_adaptive_success();
                    break;
                }
            } else if let Ok(parsed) = serde_json::from_str::<Value>(&resp_text) {
                let id = parsed.get("response").and_then(extract_asset_id_from_value);
                if let Some(aid) = id {
                    final_asset_id = Some(aid);
                    upload_success = true;
                    crate::commands::spoofer::record_adaptive_success();
                    break;
                }
            }

            upload_error =
                Some("Roblox returned an unexpected response format during upload.".into());
            break;
        }

        if !upload_success {
            let msg =
                upload_error.unwrap_or_else(|| "Upload failed due to an unexpected error.".into());
            emit_transfer_update(
                &app,
                TransferUpdate {
                    id: transfer_id.clone(),
                    status: Some("error".into()),
                    error: Some(msg.clone()),
                    progress: Some(0),
                    name: None,
                    original_asset_id: None,
                    direction: None,
                    size: None,
                    new_asset_id: None,
                },
            );
            return Ok(PublishResult {
                success: false,
                error: Some(msg),
                asset_id: None,
                replaced_id: None,
            });
        }

        if let Some(op_path) = operation_path {
            match poll_roblox_operation(
                &app,
                &client,
                &op_path,
                &upload_api_key,
                &transfer_id,
                &name,
                original_asset_id.as_deref(),
                operation_poll_interval_ms,
            )
            .await
            {
                Ok(id) => {
                    final_asset_id = Some(id);
                }
                Err(e) => {
                    let msg = e;
                    emit_transfer_update(
                        &app,
                        TransferUpdate {
                            id: transfer_id.clone(),
                            status: Some("error".into()),
                            error: Some(msg.clone()),
                            progress: Some(0),
                            name: None,
                            original_asset_id: None,
                            direction: None,
                            size: None,
                            new_asset_id: None,
                        },
                    );
                    return Ok(PublishResult {
                        success: false,
                        error: Some(msg),
                        asset_id: None,
                        replaced_id: None,
                    });
                }
            }
        }
    }

    if let Some(id) = final_asset_id {
        if upload_kind.needs_universe_permissions {
            if let Some(uid) = universe_id.filter(|value| !value.trim().is_empty()) {
                let _ = patch_asset_permissions(id.clone(), uid.clone(), cookie, csrf_token).await;
            }
        }

        emit_transfer_update(
            &app,
            TransferUpdate {
                id: transfer_id,
                progress: Some(100),
                status: Some("completed".into()),
                new_asset_id: Some(id.clone()),
                name: None,
                original_asset_id: None,
                direction: None,
                error: None,
                size: None,
            },
        );
        return Ok(PublishResult {
            success: true,
            asset_id: Some(id),
            replaced_id: None,
            error: None,
        });
    }

    let msg =
        "Roblox accepted the upload, but did not provide an asset ID in the response.".to_string();
    emit_transfer_update(
        &app,
        TransferUpdate {
            id: transfer_id.clone(),
            status: Some("error".into()),
            error: Some(msg.clone()),
            progress: Some(0),
            name: None,
            original_asset_id: None,
            direction: None,
            size: None,
            new_asset_id: None,
        },
    );
    Ok(PublishResult { success: false, error: Some(msg), asset_id: None, replaced_id: None })
}

#[cfg(test)]
mod tests {
    use super::{asset_type_id_is_image, upload_kind_for_type};

    #[test]
    fn maps_image_and_mesh_upload_kinds() {
        let image = upload_kind_for_type(Some("Image"));
        assert_eq!(image.asset_type, "Image");
        assert!(image.needs_universe_permissions);

        let mesh = upload_kind_for_type(Some("Mesh"));
        assert_eq!(mesh.asset_type, "Mesh");
        assert_eq!(mesh.extension, "mesh");
    }

    #[test]
    fn image_family_asset_type_ids_are_recognised() {
        for image_id in [1, 2, 11, 13, 21, 22, 38] {
            assert!(asset_type_id_is_image(image_id), "id {image_id} should be image");
        }

        for non_image in [24, 3, 40, 10, 0] {
            assert!(!asset_type_id_is_image(non_image), "id {non_image} should not be image");
        }
    }
}
