//! Lifecycle commands invoked when the Tauri app boots up.

use std::path::PathBuf;
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

/// Resolve the OS-specific Roblox Studio Plugins directory.
/// Returns `None` on unsupported platforms or when the relevant env var is missing.
fn roblox_plugins_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    return std::env::var("LOCALAPPDATA")
        .ok()
        .map(|local| PathBuf::from(local).join("Roblox").join("Plugins"));

    #[cfg(target_os = "macos")]
    return std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join("Documents").join("Roblox").join("Plugins"));

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return None;
}

/// Automatically installs or updates the ISpooferMotion Luau plugin in Studio's local plugins folder.
///
/// The `.rbxmx` plugin file is bundled into the Tauri binary at compile-time.
/// When the app boots, this copies it directly into `%LOCALAPPDATA%\Roblox\Plugins`.
#[tauri::command]
#[specta::specta]
pub async fn sync_roblox_plugin(app: AppHandle) -> crate::error::Result<bool> {
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

        // Standalone exe: walk up from the executable looking for dist-plugin/.
        // Covers target/release/, target/, src-tauri/, tmp_clone/, and project root.
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

    let Some(dest_dir) = roblox_plugins_dir() else {
        log::warn!("Could not determine Roblox plugins directory for this OS.");
        return Ok(false);
    };

    // Create plugins directory if it doesn't exist yet.
    if !dest_dir.exists() {
        tokio::fs::create_dir_all(&dest_dir).await?;
    }

    // Always overwrite: delete any existing ISpooferMotion plugin files so the
    // fresh copy replaces them. If Studio is holding a read handle the delete
    // may fail, but tokio::fs::copy can overwrite in-place on Windows anyway.
    if let Ok(mut entries) = tokio::fs::read_dir(&dest_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.contains("ISpooferMotion") {
                    let _ = tokio::fs::remove_file(entry.path()).await;
                }
            }
        }
    }

    let dest_path = dest_dir.join("ISpooferMotion.rbxmx");

    match tokio::fs::copy(&resource_path, &dest_path).await {
        Ok(n) => {
            log::info!("Copied plugin ({} bytes) to {:?}", n, dest_path);
            Ok(true)
        }
        Err(e) => {
            log::error!("Failed to copy plugin: {}", e);
            Err(crate::error::AppError::Io(e))
        }
    }
}
