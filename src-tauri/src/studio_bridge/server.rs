use axum::extract::{Json, Query, State};
use serde::Deserialize;
use serde_json::Value;
use std::time::{Duration, Instant};
use tauri::Emitter;

use super::messages::{
    analyze_records, count_keyframe_warnings, plan_patches, AssetStore, StudioRecord,
};
use super::{AppState, STUDIO_PROTOCOL_VERSION};

#[derive(Deserialize, Default)]
pub struct PollQuery {
    pub place_id: Option<String>,
    pub place_name: Option<String>,
}

fn belongs_to_scan(guard: &super::messages::AssetServerStateData, payload: &Value) -> bool {
    guard.scan_id.as_deref() == payload.get("scanId").and_then(Value::as_str)
}

pub async fn handle_studio_health(State(state): State<AppState>) -> Json<Value> {
    let guard = state.data.read().await;

    let synced =
        guard.last_plugin_poll_time.is_some_and(|poll| poll.elapsed() < Duration::from_secs(30));
    Json(serde_json::json!({
        "synced": synced,
        "protocolVersion": STUDIO_PROTOCOL_VERSION,
        "scanStatus": guard.scan_status,
        "scanGeneration": guard.scan_generation,
        "completedScanGeneration": guard.completed_scan_generation,
        "abortedScanGeneration": guard.aborted_scan_generation,
        "studioPlaceId": guard.studio_place_id,
        "studioPlaceName": guard.studio_place_name,
        "batchSize": guard.batch_size
    }))
}

pub async fn handle_scan_start(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let mut guard = state.data.write().await;
    guard.last_plugin_poll_time = Some(Instant::now());
    guard.scan_id = payload
        .get("scanId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .map(ToString::to_string);
    guard.received_scan_chunks.clear();
    guard.scan_completion_in_progress = false;
    guard.last_scan_completion = None;
    guard.scan_generation = guard.scan_generation.saturating_add(1);
    guard.assets_revision = guard.assets_revision.saturating_add(1);
    guard.pending_studio_records = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    guard.pending_record_bytes = 0;
    let incoming_place_id = payload
        .get("placeId")
        .and_then(|value| {
            value
                .as_u64()
                .map(|id| id.to_string())
                .or_else(|| value.as_str().map(std::string::ToString::to_string))
        })
        .filter(|id| id != "0" && id.chars().all(|character| character.is_ascii_digit()));
    if incoming_place_id.is_some() {
        guard.studio_place_id = incoming_place_id;
    }
    let incoming_place_name = payload
        .get("placeName")
        .and_then(|value| value.as_str().map(std::string::ToString::to_string))
        .filter(|name| !name.trim().is_empty());
    if incoming_place_name.is_some() {
        guard.studio_place_name = incoming_place_name;
    }
    guard.last_sounds = AssetStore { scanning: true, ..Default::default() };
    guard.last_animations = AssetStore { scanning: true, ..Default::default() };
    guard.last_images = AssetStore { scanning: true, ..Default::default() };
    guard.last_meshes = AssetStore { scanning: true, ..Default::default() };
    guard.last_script_refs = AssetStore { scanning: true, ..Default::default() };
    guard.scan_records_truncated = false;
    guard.scan_status = Some(serde_json::json!({
        "scanning": true,
        "current_service": "Spoofing...",
        "scanned": 0,
        "total": 0
    }));
    Json(serde_json::json!({"success": true}))
}

pub async fn handle_scan_progress(
    State(state): State<AppState>,
    Json(mut payload): Json<Value>,
) -> Json<Value> {
    let mut guard = state.data.write().await;
    if !belongs_to_scan(&guard, &payload)
        || guard.scan_status.is_none()
        || guard.scan_completion_in_progress
    {
        return Json(serde_json::json!({"success": false, "superseded": true}));
    }
    guard.last_plugin_poll_time = Some(Instant::now());
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("scanning".to_string(), Value::Bool(true));
    }
    guard.scan_status = Some(payload);
    Json(serde_json::json!({"success": true}))
}

pub async fn handle_scan_records(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let Some(records_value) = payload.get("records").and_then(Value::as_array) else {
        return Json(serde_json::json!({"success": true}));
    };

    {
        let guard = state.data.read().await;
        if !belongs_to_scan(&guard, &payload)
            || guard.scan_status.is_none()
            || guard.scan_completion_in_progress
        {
            return Json(serde_json::json!({"success": false, "superseded": true}));
        }
    }

    let mut parsed_records = Vec::with_capacity(records_value.len());
    for record in records_value {
        if let Ok(parsed) = serde_json::from_value::<StudioRecord>(record.clone()) {
            if parsed.property != "Source" || parsed.value.len() <= super::MAX_SCRIPT_SOURCE_BYTES {
                parsed_records.push(parsed);
            }
        }
    }

    let mut guard = state.data.write().await;
    if !belongs_to_scan(&guard, &payload)
        || guard.scan_status.is_none()
        || guard.scan_completion_in_progress
    {
        return Json(serde_json::json!({"success": false, "superseded": true}));
    }
    guard.last_plugin_poll_time = Some(Instant::now());
    if let Some(chunk_id) = payload.get("chunkId").and_then(Value::as_u64) {
        if guard.received_scan_chunks.contains(&chunk_id) {
            return Json(serde_json::json!({"success": true, "duplicate": true}));
        }
        if guard.received_scan_chunks.len() >= super::MAX_STUDIO_SCAN_CHUNKS {
            guard.scan_records_truncated = true;
            return Json(serde_json::json!({"success": true, "truncated": true}));
        }
        guard.received_scan_chunks.insert(chunk_id);
    }

    let mut truncated = false;
    {
        let records = std::sync::Arc::clone(&guard.pending_studio_records);
        let mut pending = records.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut used_bytes = guard.pending_record_bytes;
        for record in parsed_records {
            if pending.len() >= super::MAX_STUDIO_RECORDS {
                truncated = true;
                break;
            }
            let bytes = std::mem::size_of::<StudioRecord>()
                + record.token.len()
                + record.class_name.len()
                + record.name.len()
                + record.full_name.len()
                + record.property.len()
                + record.value.len();
            if bytes > super::MAX_STUDIO_SCAN_BYTES.saturating_sub(used_bytes) {
                truncated = true;
                continue;
            }
            used_bytes += bytes;
            pending.push(record);
        }
        guard.pending_record_bytes = used_bytes;
    }

    if truncated {
        guard.scan_records_truncated = true;
    }
    Json(serde_json::json!({"success": true}))
}

pub async fn handle_scan_complete(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let (records, mappings, scan_generation) = {
        let mut guard = state.data.write().await;
        if !belongs_to_scan(&guard, &payload)
            || guard.scan_generation == 0
            || guard.aborted_scan_generation >= guard.scan_generation
        {
            return Json(serde_json::json!({"ok": false, "superseded": true}));
        }
        if guard.completed_scan_generation >= guard.scan_generation {
            return Json(
                guard
                    .last_scan_completion
                    .clone()
                    .unwrap_or_else(|| serde_json::json!({"ok": false, "superseded": true})),
            );
        }
        if guard.scan_completion_in_progress {
            return Json(serde_json::json!({"ok": false, "inProgress": true}));
        }
        guard.scan_completion_in_progress = true;
        guard.last_plugin_poll_time = Some(Instant::now());
        let extracted_records = std::mem::take(
            &mut *guard
                .pending_studio_records
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        guard.pending_record_bytes = 0;
        guard.studio_records = std::sync::Arc::new(extracted_records);
        (
            std::sync::Arc::clone(&guard.studio_records),
            guard.stored_mappings.clone(),
            guard.scan_generation,
        )
    };
    let record_count = records.len();
    let mapping_count = mappings.len();

    let records_for_analysis = std::sync::Arc::clone(&records);
    let analysis_task = tokio::task::spawn_blocking(move || analyze_records(&records_for_analysis));
    let patch_task = if mappings.is_empty() {
        None
    } else {
        let records_for_patches = std::sync::Arc::clone(&records);
        let plan_mappings = mappings.clone();
        Some(tokio::task::spawn_blocking(move || {
            plan_patches(&records_for_patches, &plan_mappings)
        }))
    };

    let stores = analysis_task.await.unwrap_or_else(|e| {
        log::error!("Failed to analyze records: {}", e);
        (
            AssetStore::completed(),
            AssetStore::completed(),
            AssetStore::completed(),
            AssetStore::completed(),
            AssetStore::completed(),
        )
    });

    let patches = if let Some(task) = patch_task {
        task.await.unwrap_or_else(|e| {
            log::error!("Failed to plan patches after scan: {}", e);
            Vec::new()
        })
    } else {
        Vec::new()
    };

    let mut guard = state.data.write().await;
    if guard.scan_generation != scan_generation
        || guard.aborted_scan_generation >= scan_generation
        || guard.completed_scan_generation >= scan_generation
        || !belongs_to_scan(&guard, &payload)
    {
        return Json(serde_json::json!({"ok": false, "superseded": true}));
    }
    let patch_count = patches.len();
    log::info!(
        "handle_scan_complete: records={record_count} mappings={mapping_count} patches={patch_count}"
    );
    let _ = state.app_handle.emit(
        "spoofer-log",
        serde_json::json!({
            "level": "info",
            "message": format!(
                "Studio scan finished: {record_count} records collected, {mapping_count} pending mappings, {patch_count} patches planned."
            ),
        }),
    );
    if mapping_count > 0 && patch_count == 0 && record_count > 0 {
        let _ = state.app_handle.emit(
            "spoofer-log",
            serde_json::json!({
                "level": "warn",
                "message": format!(
                    "{mapping_count} spoofed mapping(s) had no matching records in the Studio scan -- nothing to replace. The scanned instances don't reference the old asset ids, so either the assets are loaded dynamically from scripts, or the scan didn't reach the container that holds them."
                ),
            }),
        );
    }

    (
        guard.last_animations,
        guard.last_sounds,
        guard.last_images,
        guard.last_meshes,
        guard.last_script_refs,
    ) = stores;
    guard.scan_status = None;
    guard.completed_scan_generation = guard.scan_generation;
    guard.assets_revision = guard.assets_revision.saturating_add(1);
    if !mappings.is_empty() {
        if patches.is_empty() {
            let _ = state.app_handle.emit(
                "patch-results",
                serde_json::json!({
                    "failedPatches": [],
                    "succeeded": 0,
                    "failed": 0,
                    "total": 0
                }),
            );
            guard.stored_mappings.clear();
            guard.stored_patches.clear();
        } else {
            guard.stored_patches = patches;
            guard.notify.notify_waiters();
        }
    }
    let kf_warnings = count_keyframe_warnings(&guard.last_script_refs);
    guard.keyframe_warning_count = kf_warnings;
    let completion = serde_json::json!({
        "ok": true,
        "recordsTruncated": guard.scan_records_truncated,
        "keyframeWarningCount": kf_warnings,
        "totals": {
            "animations": guard.last_animations.assets.len(),
            "sounds": guard.last_sounds.assets.len(),
            "images": guard.last_images.assets.len(),
            "meshes": guard.last_meshes.assets.len(),
            "scriptRefs": guard.last_script_refs.assets.len()
        }
    });
    guard.last_scan_completion = Some(completion.clone());
    guard.scan_completion_in_progress = false;
    Json(completion)
}

pub async fn handle_scan_abort(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let mut guard = state.data.write().await;
    if !belongs_to_scan(&guard, &payload)
        || guard.scan_generation == 0
        || guard.completed_scan_generation >= guard.scan_generation
    {
        return Json(serde_json::json!({"success": false, "superseded": true}));
    }
    guard.scan_status = None;
    guard.aborted_scan_generation = guard.scan_generation;
    guard.scan_completion_in_progress = false;
    guard.assets_revision = guard.assets_revision.saturating_add(1);
    guard.pending_studio_records = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    guard.pending_record_bytes = 0;
    guard.last_sounds.scanning = false;
    guard.last_animations.scanning = false;
    guard.last_images.scanning = false;
    guard.last_meshes.scanning = false;
    guard.last_script_refs.scanning = false;

    if !guard.stored_mappings.is_empty() {
        let _ = state.app_handle.emit(
            "patch-results",
            serde_json::json!({
                "failedPatches": [],
                "succeeded": 0,
                "failed": 0,
                "total": 0
            }),
        );
        guard.stored_mappings.clear();
        guard.stored_patches.clear();
    }

    Json(serde_json::json!({"success": true}))
}

pub async fn handle_poll(
    State(state): State<AppState>,
    Query(query): Query<PollQuery>,
) -> Json<Value> {
    let timeout = tokio::time::Duration::from_secs(8);

    let heartbeat_interval = tokio::time::Duration::from_secs(5);
    let start = Instant::now();
    let notify = std::sync::Arc::clone(&state.data.read().await.notify);

    loop {
        {
            let mut guard = state.data.write().await;
            guard.last_plugin_poll_time = Some(Instant::now());
            if let Some(name) = query.place_name.as_deref().filter(|n| !n.trim().is_empty()) {
                guard.studio_place_name = Some(name.to_string());
            }
            if let Some(id) =
                query.place_id.as_deref().filter(|i| !i.trim().is_empty() && *i != "0")
            {
                let place_changed = guard.studio_place_id.as_deref().is_some_and(|old| old != id);
                if place_changed {
                    guard.studio_records = std::sync::Arc::new(Vec::new());
                    guard.pending_studio_records =
                        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
                    guard.pending_record_bytes = 0;
                    guard.stored_patches.clear();
                    if !guard.stored_mappings.is_empty() {
                        guard.request_sounds = true;
                        guard.request_animations = true;
                        guard.request_images = true;
                        guard.request_meshes = true;
                        guard.request_script_refs = true;
                    }
                }
                guard.studio_place_id = Some(id.to_string());
            }
            let request_assets = guard.request_sounds
                || guard.request_animations
                || guard.request_images
                || guard.request_meshes
                || guard.request_script_refs;
            if request_assets {
                guard.request_sounds = false;
                guard.request_animations = false;
                guard.request_images = false;
                guard.request_meshes = false;
                guard.request_script_refs = false;
                let scan_types = guard.scan_types.clone();
                let scan_path = guard.scan_path.take();
                let batch_size = guard.batch_size;
                return Json(serde_json::json!({
                    "requestAssets": true,
                    "scanTypes": scan_types,
                    "scanPath": scan_path,
                    "batchSize": batch_size,
                }));
            }
        }
        if start.elapsed() > timeout {
            let batch_size = state.data.read().await.batch_size;
            return Json(serde_json::json!({ "requestAssets": false, "batchSize": batch_size }));
        }

        let remaining = timeout.saturating_sub(start.elapsed());
        let wait = remaining.min(heartbeat_interval);
        let _ = tokio::time::timeout(wait, notify.notified()).await;
    }
}

pub async fn handle_poll_replacements(State(state): State<AppState>) -> Json<Value> {
    let timeout = tokio::time::Duration::from_secs(8);
    let heartbeat_interval = tokio::time::Duration::from_secs(5);
    let start = Instant::now();
    let notify = std::sync::Arc::clone(&state.data.read().await.notify);

    loop {
        {
            let mut guard = state.data.write().await;
            guard.last_plugin_poll_time = Some(Instant::now());
            let has_mappings = !guard.stored_mappings.is_empty();
            let has_patches = !guard.stored_patches.is_empty();
            let batch_size = guard.batch_size;

            if has_patches {
                let mappings = std::mem::take(&mut guard.stored_mappings);
                let patches = std::mem::take(&mut guard.stored_patches);
                return Json(serde_json::json!({
                    "mappings": mappings,
                    "patches": patches,
                    "batchSize": batch_size
                }));
            } else if has_mappings {
                let mappings = guard.stored_mappings.clone();
                return Json(serde_json::json!({
                    "mappings": mappings,
                    "patches": [],
                    "batchSize": batch_size
                }));
            }
        }
        if start.elapsed() > timeout {
            let batch_size = state.data.read().await.batch_size;
            return Json(serde_json::json!({
                "mappings": [],
                "patches": [],
                "batchSize": batch_size
            }));
        }
        let remaining = timeout.saturating_sub(start.elapsed());
        let wait = remaining.min(heartbeat_interval);
        let _ = tokio::time::timeout(wait, notify.notified()).await;
    }
}

pub async fn handle_patch_progress(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    if let Err(e) = state.app_handle.emit("patch-progress", &payload) {
        log::error!("Failed to emit patch-progress event: {}", e);
    }
    Json(serde_json::json!({"success": true}))
}

pub async fn handle_set_batch_size(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let size = body.get("batchSize").and_then(Value::as_u64).unwrap_or(50).clamp(1, 1_000);
    state.data.write().await.batch_size = Some(size as u32);
    Json(serde_json::json!({"success": true}))
}

pub async fn handle_replace_ids(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let mappings_raw =
        payload.get("mappings").and_then(Value::as_array).cloned().unwrap_or_default();
    let over_limit = mappings_raw.len() > 5_000;
    let mappings = mappings_raw.into_iter().take(5_000).collect::<Vec<_>>();

    if mappings.is_empty() {
        return Json(serde_json::json!({ "ok": false, "truncated": over_limit }));
    }

    let mut guard = state.data.write().await;
    guard.stored_mappings = mappings;
    guard.stored_patches.clear();
    guard.request_sounds = true;
    guard.request_animations = true;
    guard.request_images = true;
    guard.request_meshes = true;
    guard.request_script_refs = true;
    guard.notify.notify_waiters();

    Json(serde_json::json!({ "ok": true, "truncated": over_limit }))
}

pub async fn handle_patch_results(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let succeeded = payload.get("succeeded").and_then(Value::as_u64).unwrap_or(0);
    let failed = payload.get("failed").and_then(Value::as_u64).unwrap_or(0);
    let total = payload.get("total").and_then(Value::as_u64).unwrap_or(succeeded + failed);
    if total > 0 {
        let level = if failed == 0 { "info" } else { "warn" };
        let _ = state.app_handle.emit(
            "spoofer-log",
            serde_json::json!({
                "level": level,
                "message": format!(
                    "Studio plugin applied {succeeded}/{total} patches (failed: {failed})."
                ),
            }),
        );
    }
    if let Err(e) = state.app_handle.emit("patch-results", &payload) {
        log::error!("Failed to emit patch-results event: {}", e);
    }
    Json(serde_json::json!({"success": true}))
}

fn clear_stale(store: &mut AssetStore) {
    let stale_incomplete = store.timestamp.is_some_and(|t| {
        !store.scanning && !store.complete && t.elapsed() > Duration::from_secs(60)
    });
    let stale_complete =
        store.timestamp.is_some_and(|t| store.complete && t.elapsed() > Duration::from_secs(600));
    if stale_incomplete || stale_complete {
        store.assets.clear();
        store.complete = false;
        store.timestamp = None;
    }
}

fn snapshot(store: &mut AssetStore) -> AssetStore {
    clear_stale(store);
    store.clone()
}

macro_rules! snapshot_handler {
    ($name:ident, $field:ident) => {
        pub async fn $name(State(state): State<AppState>) -> Json<AssetStore> {
            Json(snapshot(&mut state.data.write().await.$field))
        }
    };
}

snapshot_handler!(get_last_sounds, last_sounds);
snapshot_handler!(get_last_animations, last_animations);
snapshot_handler!(get_last_images, last_images);
snapshot_handler!(get_last_meshes, last_meshes);
snapshot_handler!(get_last_script_refs, last_script_refs);

macro_rules! request_handler {
    ($name:ident, $flag:ident, $store:ident) => {
        pub async fn $name(State(state): State<AppState>) -> Json<Value> {
            let mut guard = state.data.write().await;
            guard.$flag = true;
            if !guard.$store.scanning {
                guard.$store = AssetStore::default();
            }
            if guard.scan_status.is_none() {
                guard.scan_status = Some(serde_json::json!({
                    "scanning": true,
                    "current_service": "Pending...",
                    "scanned": 0,
                    "total": 0
                }));
            }
            guard.assets_revision = guard.assets_revision.saturating_add(1);
            guard.notify.notify_waiters();
            Json(serde_json::json!({"success": true}))
        }
    };
}

request_handler!(request_sounds, request_sounds, last_sounds);
request_handler!(request_animations, request_animations, last_animations);
request_handler!(request_images, request_images, last_images);
request_handler!(request_meshes, request_meshes, last_meshes);
request_handler!(request_script_refs, request_script_refs, last_script_refs);

pub async fn set_scan_options(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut guard = state.data.write().await;
    if let Some(types) = body.get("scanTypes").and_then(|v| v.as_array()) {
        guard.scan_types = types.iter().filter_map(|v| v.as_str().map(String::from)).collect();
    }
    if let Some(path) = body.get("scanPath").and_then(|v| v.as_str()) {
        guard.scan_path = if path.trim().is_empty() { None } else { Some(path.trim().to_string()) };
    }
    Json(serde_json::json!({"success": true}))
}

async fn legacy_poll(State(state): State<AppState>, kind: &'static str) -> Json<Value> {
    let timeout = tokio::time::Duration::from_secs(8);

    let heartbeat_interval = tokio::time::Duration::from_secs(5);
    let start = Instant::now();
    let notify = std::sync::Arc::clone(&state.data.read().await.notify);

    loop {
        {
            let mut guard = state.data.write().await;
            guard.last_plugin_poll_time = Some(Instant::now());
            let request_assets = match kind {
                "sounds" => std::mem::take(&mut guard.request_sounds),
                "animations" => std::mem::take(&mut guard.request_animations),
                "images" => std::mem::take(&mut guard.request_images),
                _ => false,
            };
            if request_assets {
                return Json(
                    serde_json::json!({ "requestAssets": request_assets, "skipOwnedCheck": guard.skip_owned_check }),
                );
            }
        }
        if start.elapsed() > timeout {
            let skip_owned = state.data.read().await.skip_owned_check;
            return Json(
                serde_json::json!({ "requestAssets": false, "skipOwnedCheck": skip_owned }),
            );
        }
        let remaining = timeout.saturating_sub(start.elapsed());
        let wait = remaining.min(heartbeat_interval);
        let _ = tokio::time::timeout(wait, notify.notified()).await;
    }
}

pub async fn handle_poll_sounds(state: State<AppState>) -> Json<Value> {
    legacy_poll(state, "sounds").await
}

pub async fn handle_poll_animations(state: State<AppState>) -> Json<Value> {
    legacy_poll(state, "animations").await
}

pub async fn handle_poll_images(state: State<AppState>) -> Json<Value> {
    legacy_poll(state, "images").await
}

fn append_legacy_assets(store: &mut AssetStore, payload: &Value) {
    if let Some(assets) = payload.get("assets").and_then(Value::as_array) {
        store.assets.extend(assets.iter().cloned());
    }
}

macro_rules! legacy_assets_handler {
    ($name:ident, $field:ident) => {
        pub async fn $name(
            State(state): State<AppState>,
            Json(payload): Json<Value>,
        ) -> Json<Value> {
            let mut guard = state.data.write().await;
            append_legacy_assets(&mut guard.$field, &payload);
            guard.assets_revision = guard.assets_revision.saturating_add(1);
            Json(serde_json::json!({"success": true}))
        }
    };
}

legacy_assets_handler!(handle_assets_sounds, last_sounds);
legacy_assets_handler!(handle_assets_animations, last_animations);
legacy_assets_handler!(handle_assets_images, last_images);
legacy_assets_handler!(handle_assets_meshes, last_meshes);
legacy_assets_handler!(handle_assets_script_refs, last_script_refs);

macro_rules! legacy_complete_handler {
    ($name:ident, $field:ident) => {
        pub async fn $name(State(state): State<AppState>) -> Json<Value> {
            let mut guard = state.data.write().await;
            guard.$field.scanning = false;
            guard.$field.complete = true;
            guard.$field.timestamp = Some(Instant::now());
            guard.assets_revision = guard.assets_revision.saturating_add(1);
            Json(serde_json::json!({"success": true}))
        }
    };
}

legacy_complete_handler!(handle_sounds_complete, last_sounds);
legacy_complete_handler!(handle_animations_complete, last_animations);
legacy_complete_handler!(handle_images_complete, last_images);
legacy_complete_handler!(handle_meshes_complete, last_meshes);
legacy_complete_handler!(handle_script_refs_complete, last_script_refs);

pub async fn handle_api_dump() -> Json<crate::api_dump::ApiDumpProperties> {
    Json(crate::api_dump::get_api_dump_properties().await)
}
