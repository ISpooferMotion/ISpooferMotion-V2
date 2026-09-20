pub mod messages;
pub mod middleware;
pub mod server;

use crate::commands::AnyValue;
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, Method},
    middleware as axum_middleware,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio::sync::RwLock;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
};

use messages::plan_patches;
use middleware::require_json_for_post;
use server::{
    get_last_animations, get_last_images, get_last_meshes, get_last_script_refs, get_last_sounds,
    handle_animations_complete, handle_api_dump, handle_assets_animations, handle_assets_images,
    handle_assets_meshes, handle_assets_script_refs, handle_assets_sounds, handle_images_complete,
    handle_meshes_complete, handle_patch_progress, handle_patch_results, handle_poll,
    handle_poll_animations, handle_poll_images, handle_poll_replacements, handle_poll_sounds,
    handle_replace_ids, handle_scan_abort, handle_scan_complete, handle_scan_progress,
    handle_scan_records, handle_scan_start, handle_script_refs_complete, handle_set_batch_size,
    handle_sounds_complete, handle_studio_health, request_animations, request_images,
    request_meshes, request_script_refs, request_sounds, set_scan_options,
};

const PLUGIN_PORT_START: u16 = 14285;
const PLUGIN_PORT_END: u16 = 14289;

const PLUGIN_PORT_FALLBACK_END: u16 = 14320;
const STUDIO_PROTOCOL_VERSION: u8 = 3;
const MAX_STUDIO_RECORDS: usize = 2_000_000;
const MAX_SCRIPT_SOURCE_BYTES: usize = 8_000_000;

static ACTIVE_BRIDGE_PORT: OnceLock<RwLock<Option<u16>>> = OnceLock::new();
static BRIDGE_DATA: OnceLock<Arc<RwLock<AssetServerStateData>>> = OnceLock::new();

pub fn bridge_data() -> Option<Arc<RwLock<AssetServerStateData>>> {
    BRIDGE_DATA.get().cloned()
}

pub(crate) fn active_bridge_port() -> &'static RwLock<Option<u16>> {
    ACTIVE_BRIDGE_PORT.get_or_init(|| RwLock::new(None))
}

static PORT_DIAGNOSTIC: OnceLock<RwLock<Value>> = OnceLock::new();

fn port_diagnostic() -> &'static RwLock<Value> {
    PORT_DIAGNOSTIC.get_or_init(|| {
        RwLock::new(json!({
            "boundPort": null,
            "defaultsOccupied": [],
            "extended": false,
            "failed": false
        }))
    })
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn set_bridge_skip_owned_check(skip_owned: bool) -> bool {
    if let Some(data) = bridge_data() {
        data.write().await.skip_owned_check = skip_owned;
        return true;
    }
    false
}

#[must_use]
pub async fn queue_replace_mappings_internal(mappings: Vec<Value>) -> bool {
    let Some(data) = bridge_data() else {
        return false;
    };
    if mappings.is_empty() {
        return false;
    }
    let records = std::sync::Arc::clone(&data.read().await.studio_records);
    let records_empty = records.is_empty();
    let patches = if records_empty { Vec::new() } else { plan_patches(&records, &mappings) };
    let mut guard = data.write().await;
    guard.stored_mappings = mappings;
    guard.stored_patches = patches;
    if records_empty {
        guard.request_sounds = true;
        guard.request_animations = true;
        guard.request_images = true;
        guard.request_meshes = true;
        guard.request_script_refs = true;
    }
    guard.notify.notify_waiters();
    true
}

use messages::AssetServerStateData;

#[derive(Clone)]
pub struct AppState {
    pub data: Arc<RwLock<AssetServerStateData>>,
    pub bridge_port: u16,
    pub started_at: u128,
    pub app_handle: AppHandle,
}

pub async fn start_server(app_handle: AppHandle) {
    let data = Arc::new(RwLock::new(AssetServerStateData::default()));
    let _ = BRIDGE_DATA.set(Arc::clone(&data));
    let Some((listener, addr, occupied_defaults)) = bind_available_listener().await else {
        log::error!(
            "Could not start plugin HTTP server: all ports {}-{} are occupied. \
             Close other ISpooferMotion instances or programs using these ports.",
            PLUGIN_PORT_START,
            PLUGIN_PORT_FALLBACK_END
        );
        *port_diagnostic().write().await = json!({
            "boundPort": null,
            "defaultsOccupied": [],
            "extended": false,
            "failed": true
        });
        return;
    };
    let bound_port = addr.port();
    let extended = bound_port > PLUGIN_PORT_END;
    let defaults_occupied = detect_occupied_ports(&occupied_defaults).await;
    if extended {
        let names: Vec<String> =
            defaults_occupied.iter().map(|o| format!("{}:{}", o.exe, o.port)).collect();
        log::warn!(
            "Plugin server moved past the default ports to {bound_port}: ports \
             14285-14289 occupied by [{}]. Set the Studio plugin's Daemon Port \
             Scan Range to 14285-{bound_port} so it can find the app.",
            names.join(", ")
        );
    }
    let occupied_value = serde_json::to_value(&defaults_occupied).unwrap_or(Value::Null);
    *port_diagnostic().write().await = json!({
        "boundPort": bound_port,
        "defaultsOccupied": occupied_value,
        "extended": extended,
        "failed": false
    });
    let state = AppState {
        data: Arc::clone(&data),
        bridge_port: bound_port,
        started_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        app_handle: app_handle.clone(),
    };
    *active_bridge_port().write().await = Some(bound_port);

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _req_parts: &axum::http::request::Parts| {
                let bytes = origin.as_bytes();

                if bytes.is_empty() {
                    return true;
                }
                matches!(
                    origin.to_str().unwrap_or(""),
                    "http://localhost:5173"
                        | "http://127.0.0.1:5173"
                        | "http://localhost:3000"
                        | "http://127.0.0.1:3000"
                        | "https://ispoofermotion.com"
                        | "tauri://localhost"
                        | "http://tauri.localhost"
                        | "https://tauri.localhost"
                )
            },
        ))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::AUTHORIZATION])
        .allow_private_network(true);

    let app = Router::new()
        .route(
            "/health",
            get(|State(state): State<AppState>| async move {
                let port = *active_bridge_port().read().await;
                Json(json!({
                    "app": "ISpooferMotion",
                    "port": port.unwrap_or(14285),
                    "startedAt": state.started_at,
                    "allowStudioPairing": true
                }))
            }),
        )
        .route("/studio-health", get(handle_studio_health))
        .route("/api-dump", get(handle_api_dump))
        .route("/poll", get(handle_poll))
        .route("/scan-start", post(handle_scan_start))
        .route("/scan-progress", post(handle_scan_progress))
        .route("/scan-records", post(handle_scan_records))
        .route("/scan-complete", post(handle_scan_complete))
        .route("/scan-abort", post(handle_scan_abort))
        .route("/poll-sounds", get(handle_poll_sounds))
        .route("/assets-sounds", post(handle_assets_sounds))
        .route("/sounds-complete", post(handle_sounds_complete))
        .route("/poll-animations", get(handle_poll_animations))
        .route("/assets-animations", post(handle_assets_animations))
        .route("/animations-complete", post(handle_animations_complete))
        .route("/poll-images", get(handle_poll_images))
        .route("/assets-images", post(handle_assets_images))
        .route("/images-complete", post(handle_images_complete))
        .route("/assets-meshes", post(handle_assets_meshes))
        .route("/meshes-complete", post(handle_meshes_complete))
        .route("/assets-script-refs", post(handle_assets_script_refs))
        .route("/script-refs-complete", post(handle_script_refs_complete))
        .route("/poll-replacements", get(handle_poll_replacements))
        .route("/patch-results", post(handle_patch_results))
        .route("/replace-ids", post(handle_replace_ids))
        .route("/last-sounds", get(get_last_sounds))
        .route("/last-animations", get(get_last_animations))
        .route("/last-images", get(get_last_images))
        .route("/last-meshes", get(get_last_meshes))
        .route("/last-script-refs", get(get_last_script_refs))
        .route("/request-sounds", post(request_sounds))
        .route("/request-animations", post(request_animations))
        .route("/request-images", post(request_images))
        .route("/request-meshes", post(request_meshes))
        .route("/request-script-refs", post(request_script_refs))
        .route("/patch-progress", post(handle_patch_progress))
        .route("/batch-size", post(handle_set_batch_size))
        .route("/scan-options", post(set_scan_options))
        .layer(axum_middleware::from_fn(require_json_for_post))
        .layer(RequestBodyLimitLayer::new(64 * 1024 * 1024))
        .layer(DefaultBodyLimit::disable())
        .layer(cors)
        .with_state(state);

    tokio::spawn(async move {
        log::info!("Plugin HTTP server listening on {addr}");
        if let Err(err) = axum::serve(listener, app).await {
            log::error!("Plugin HTTP server stopped with an error on {addr}: {err}");
        }
        let mut active_port = active_bridge_port().write().await;
        if *active_port == Some(addr.port()) {
            *active_port = None;
        }
    });
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn get_plugin_bridge_port() -> Option<u16> {
    *active_bridge_port().read().await
}

#[derive(serde::Serialize, Clone)]
struct OccupiedPort {
    port: u16,
    exe: String,
}

async fn detect_occupied_ports(ports: &[u16]) -> Vec<OccupiedPort> {
    if ports.is_empty() {
        return Vec::new();
    }
    let ports = ports.to_vec();
    tokio::task::spawn_blocking(move || {
        let owners = port_owners(&ports);
        ports
            .iter()
            .map(|&p| {
                let exe = owners.get(&p).cloned().unwrap_or_else(|| "unknown".to_string());
                OccupiedPort { port: p, exe }
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default()
}

#[cfg(windows)]
fn port_owners(ports: &[u16]) -> std::collections::HashMap<u16, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID,
    };

    const AF_INET: u32 = 2;

    const TCP_TABLE_OWNER_PID_ALL: i32 = 5;

    let mut map = std::collections::HashMap::new();
    let mut size: u32 = 0;

    unsafe {
        GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut size,
            0,
            AF_INET,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );
    }
    if size == 0 {
        return map;
    }
    let mut buf: Vec<u8> = vec![0u8; size as usize];
    let ret = unsafe {
        GetExtendedTcpTable(
            buf.as_mut_ptr() as *mut std::ffi::c_void,
            &mut size,
            0,
            AF_INET,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        )
    };
    if ret != 0 {
        return map;
    }
    let table = buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
    unsafe {
        let count = (*table).dwNumEntries as usize;
        let rows = std::slice::from_raw_parts((*table).table.as_ptr(), count);
        for row in rows {
            let addr = row.dwLocalAddr.to_ne_bytes();

            if addr != [127, 0, 0, 1] && addr != [0, 0, 0, 0] {
                continue;
            }
            let port = u16::from_be((row.dwLocalPort >> 16) as u16);
            if !ports.contains(&port) {
                continue;
            }
            let pid = row.dwOwningPid;
            map.entry(port).or_insert_with(|| process_image_name(pid));
        }
    }
    map
}

#[cfg(windows)]
fn process_image_name(pid: u32) -> String {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return "unknown".to_string();
        }
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 {
            return "unknown".to_string();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string()
    }
}

#[cfg(not(windows))]
fn port_owners(ports: &[u16]) -> std::collections::HashMap<u16, String> {
    use std::process::Command;
    let mut map = std::collections::HashMap::new();
    let (lo, hi) = match (ports.iter().min(), ports.iter().max()) {
        (Some(&lo), Some(&hi)) => (lo, hi),
        _ => return map,
    };

    let filter = format!("-iTCP:{lo}-{hi}");
    let out = match Command::new("lsof").args(["-nP", filter.as_str(), "-sTCP:LISTEN"]).output() {
        Ok(o) => o,
        Err(_) => return map,
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines().skip(1) {
        let cmd = match line.split_whitespace().next() {
            Some(c) => c,
            None => continue,
        };
        if let Some(port) = extract_listen_port(line) {
            if ports.contains(&port) {
                map.entry(port).or_insert_with(|| cmd.to_string());
            }
        }
    }
    map
}

#[cfg(not(windows))]
fn extract_listen_port(line: &str) -> Option<u16> {
    let idx = line.find("(LISTEN)")?;
    let before = &line[..idx];
    let colon = before.rfind(':')?;
    let num: String = before[colon + 1..].chars().take_while(|c| c.is_ascii_digit()).collect();
    num.parse().ok()
}

async fn bind_available_listener() -> Option<(tokio::net::TcpListener, SocketAddr, Vec<u16>)> {
    let mut occupied_defaults: Vec<u16> = Vec::new();
    for port in PLUGIN_PORT_START..=PLUGIN_PORT_FALLBACK_END {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => return Some((listener, addr, occupied_defaults)),
            Err(_) => {
                if port <= PLUGIN_PORT_END {
                    occupied_defaults.push(port);
                }
            }
        }
    }
    None
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn get_port_diagnostic() -> AnyValue {
    let guard = port_diagnostic().read().await;
    AnyValue((*guard).clone())
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn get_studio_health_status() -> AnyValue {
    let Some(data) = bridge_data() else {
        return AnyValue(
            json!({ "synced": false, "protocolVersion": STUDIO_PROTOCOL_VERSION, "scanStatus": null, "studioPlaceId": null, "studioPlaceName": null }),
        );
    };
    let guard = data.read().await;
    let synced = guard
        .last_plugin_poll_time
        .is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(30));
    AnyValue(json!({
        "synced": synced,
        "protocolVersion": STUDIO_PROTOCOL_VERSION,
        "scanStatus": guard.scan_status,
        "studioPlaceId": guard.studio_place_id,
        "studioPlaceName": guard.studio_place_name
    }))
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn get_studio_asset_snapshots() -> AnyValue {
    let Some(data) = bridge_data() else {
        return AnyValue(json!({
            "anims": { "assets": [], "scanning": false, "complete": false },
            "sounds": { "assets": [], "scanning": false, "complete": false },
            "images": { "assets": [], "scanning": false, "complete": false },
            "meshes": { "assets": [], "scanning": false, "complete": false },
            "scriptRefs": { "assets": [], "scanning": false, "complete": false }
        }));
    };
    let guard = data.read().await;
    AnyValue(json!({
        "anims": guard.last_animations,
        "sounds": guard.last_sounds,
        "images": guard.last_images,
        "meshes": guard.last_meshes,
        "scriptRefs": guard.last_script_refs
    }))
}

pub async fn set_batch_size(size: u32) {
    if let Some(data) = bridge_data() {
        data.write().await.batch_size = Some(size);
    }
}
