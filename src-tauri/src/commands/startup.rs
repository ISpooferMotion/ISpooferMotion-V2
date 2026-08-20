//! Lifecycle commands invoked when the Tauri app boots up.

use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

/// Destroys the splashscreen window and spawns the main frameless React window.
///
/// This avoids the ugly white flash during React initialization.
#[tauri::command]
#[specta::specta]
pub async fn close_splashscreen(app: AppHandle) {
    // Dynamically create main window only after splash is done
    if app.get_webview_window("main").is_none() {
        match tauri::WebviewWindowBuilder::new(
            &app,
            "main",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("ISpooferMotion")
        .inner_size(1100.0, 620.0)
        .resizable(true)
        .fullscreen(false)
        .decorations(false)
        .transparent(true)
        .center()
        .build()
        {
            Ok(win) => {
                let _ = win.show();
            }
            Err(e) => {
                log::error!("Failed to create main window: {e}");
                // If the window already exists despite the initial check losing the race,
                // show it; otherwise there is nothing we can do.
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }
        }
    }

    if let Some(splashscreen) = app.get_webview_window("splashscreen") {
        let _ = splashscreen.close();
    }
}

/// Resolve all OS-specific Roblox Studio Plugins directories.
fn roblox_plugins_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Roblox").join("Plugins"));
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            dirs.push(PathBuf::from(userprofile).join("Documents").join("Roblox").join("Plugins"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(home).join("Documents").join("Roblox").join("Plugins"));
        }
    }

    dirs
}

/// Automatically installs or updates the ISpooferMotion Luau plugin in Studio's local plugins folder.
///
/// The `.rbxmx` plugin file is bundled into the Tauri binary at compile-time.
/// When the app boots, this copies it directly into Roblox plugins folders.
#[tauri::command]
#[specta::specta]
pub async fn sync_roblox_plugin(app: AppHandle) -> crate::error::Result<bool> {
    static SYNC_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let sync_lock = SYNC_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = sync_lock.lock().await;

    log::info!("Starting Roblox plugin sync...");

    // The bundled resource path varies between installed (NSIS) and standalone
    // (--no-bundle) builds. Try every candidate and use the first that exists.
    let resource_path: Option<PathBuf> = {
        let mut candidates: Vec<PathBuf> = Vec::new();

        // Tauri resource paths (installed builds).
        if let Ok(p) = app
            .path()
            .resolve("_up_/dist-plugin/ISpooferMotion.rbxmx", tauri::path::BaseDirectory::Resource)
        {
            candidates.push(p);
        }
        if let Ok(p) = app
            .path()
            .resolve("dist-plugin/ISpooferMotion.rbxmx", tauri::path::BaseDirectory::Resource)
        {
            candidates.push(p);
        }

        // Standalone exe or dev run: check direct relative paths from current_dir or workspace root.
        let local_candidates = [
            PathBuf::from("dist-plugin").join("ISpooferMotion.rbxmx"),
            PathBuf::from("tmp_clone").join("dist-plugin").join("ISpooferMotion.rbxmx"),
            PathBuf::from("../dist-plugin").join("ISpooferMotion.rbxmx"),
            PathBuf::from("../../dist-plugin").join("ISpooferMotion.rbxmx"),
        ];
        for c in local_candidates {
            candidates.push(c);
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for depth in 0..5u32 {
                    let mut base = dir.to_path_buf();
                    for _ in 0..depth {
                        base.push("..");
                    }
                    let mut p_tmp = base.clone();
                    p_tmp.push("tmp_clone");
                    p_tmp.push("dist-plugin");
                    p_tmp.push("ISpooferMotion.rbxmx");
                    candidates.push(p_tmp);

                    let mut p_root = base.clone();
                    p_root.push("dist-plugin");
                    p_root.push("ISpooferMotion.rbxmx");
                    candidates.push(p_root);
                }
            }
        }

        candidates.into_iter().find(|p| p.exists())
    };

    let Some(resource_path) = resource_path else {
        log::warn!("Bundled plugin resource not found in any location");
        return Ok(false);
    };

    log::info!("Found plugin resource at {:?}", resource_path);

    let dest_dirs = roblox_plugins_dirs();
    if dest_dirs.is_empty() {
        log::warn!("Could not determine Roblox plugins directory for this OS.");
        return Ok(false);
    }

    let mut any_copied = false;
    for dest_dir in dest_dirs {
        if !dest_dir.exists() {
            let _ = tokio::fs::create_dir_all(&dest_dir).await;
        }

        let dest_path = dest_dir.join("ISpooferMotion.rbxmx");
        let temp_path = dest_dir.join(".ISpooferMotion.rbxmx.tmp");
        let copied = match tokio::fs::copy(&resource_path, &temp_path).await {
            Ok(bytes) => bytes,
            Err(error) => {
                log::error!("Failed to stage Roblox plugin update in {:?}: {error}", dest_dir);
                continue;
            }
        };

        // Keep the previous plugin intact until the replacement has been copied fully.
        // POSIX rename replaces the destination atomically, so macOS/Linux never have a window
        // where the canonical plugin is missing. Windows cannot rename over an existing file.
        #[cfg(target_os = "windows")]
        let install_result = {
            let _ = tokio::fs::remove_file(&dest_path).await;
            tokio::fs::rename(&temp_path, &dest_path).await
        };

        #[cfg(not(target_os = "windows"))]
        let install_result = tokio::fs::rename(&temp_path, &dest_path).await;

        if let Err(error) = install_result {
            log::error!("Failed to install Roblox plugin at {:?}: {error}", dest_path);
            let _ = tokio::fs::remove_file(&temp_path).await;
            continue;
        }

        // Clean up older/duplicate plugin filenames only after the canonical copy exists.
        if let Ok(mut entries) = tokio::fs::read_dir(&dest_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path == dest_path {
                    continue;
                }
                if let Some(file_name) = entry.file_name().to_str() {
                    if file_name.contains("ISpooferMotion") {
                        let _ = tokio::fs::remove_file(path).await;
                    }
                }
            }
        }

        log::info!("Copied plugin ({} bytes) to {:?}", copied, dest_path);
        any_copied = true;
    }

    Ok(any_copied)
}

/// Uninstalls (deletes) the ISpooferMotion plugin from Roblox's plugins folder on app exit.
pub fn uninstall_roblox_plugin() {
    for dest_dir in roblox_plugins_dirs() {
        if let Ok(entries) = std::fs::read_dir(&dest_dir) {
            for entry in entries.flatten() {
                if let Some(file_name) = entry.file_name().to_str() {
                    if file_name.contains("ISpooferMotion") {
                        let _ = std::fs::remove_file(entry.path());
                        log::info!("Auto-uninstalled plugin from {:?}", entry.path());
                    }
                }
            }
        }
    }
}
