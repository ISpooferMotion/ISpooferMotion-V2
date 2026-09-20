use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

#[tauri::command]
#[specta::specta]
pub async fn close_splashscreen(app: AppHandle) {
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

fn is_owned_plugin_file_name(file_name: &str) -> bool {
    if matches!(
        file_name,
        "ISpooferMotion.rbxmx" | ".ISpooferMotion.rbxmx.tmp" | ".ISpooferMotion.rbxmx.backup"
    ) {
        return true;
    }

    file_name
        .strip_prefix("ISpooferMotion (")
        .and_then(|rest| rest.strip_suffix(").rbxmx"))
        .is_some_and(|copy_number| {
            !copy_number.is_empty() && copy_number.chars().all(|ch| ch.is_ascii_digit())
        })
}

#[tauri::command]
#[specta::specta]
pub async fn sync_roblox_plugin(app: AppHandle) -> crate::error::Result<bool> {
    static SYNC_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let sync_lock = SYNC_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = sync_lock.lock().await;

    log::info!("Starting Roblox plugin sync...");

    let resource_path: Option<PathBuf> = {
        let mut candidates: Vec<PathBuf> = Vec::new();

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

        #[cfg(target_os = "windows")]
        let install_result = {
            let backup_path = dest_dir.join(".ISpooferMotion.rbxmx.backup");
            let _ = tokio::fs::remove_file(&backup_path).await;
            let had_previous = tokio::fs::try_exists(&dest_path).await.unwrap_or(false);

            if had_previous {
                if let Err(error) = tokio::fs::rename(&dest_path, &backup_path).await {
                    log::error!("Failed to stage existing Roblox plugin for replacement: {error}");
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    continue;
                }
            }

            match tokio::fs::rename(&temp_path, &dest_path).await {
                Ok(()) => {
                    if had_previous {
                        let _ = tokio::fs::remove_file(&backup_path).await;
                    }
                    Ok(())
                }
                Err(error) => {
                    if had_previous {
                        if let Err(restore_error) =
                            tokio::fs::rename(&backup_path, &dest_path).await
                        {
                            log::error!(
                                "Failed to restore previous Roblox plugin after update error: {restore_error}"
                            );
                        }
                    }
                    Err(error)
                }
            }
        };

        #[cfg(not(target_os = "windows"))]
        let install_result = tokio::fs::rename(&temp_path, &dest_path).await;

        if let Err(error) = install_result {
            log::error!("Failed to install Roblox plugin at {:?}: {error}", dest_path);
            let _ = tokio::fs::remove_file(&temp_path).await;
            continue;
        }

        if let Ok(mut entries) = tokio::fs::read_dir(&dest_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path == dest_path {
                    continue;
                }
                if let Some(file_name) = entry.file_name().to_str() {
                    if is_owned_plugin_file_name(file_name) {
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

pub fn uninstall_roblox_plugin() {
    for dest_dir in roblox_plugins_dirs() {
        if let Ok(entries) = std::fs::read_dir(&dest_dir) {
            for entry in entries.flatten() {
                if let Some(file_name) = entry.file_name().to_str() {
                    if is_owned_plugin_file_name(file_name) {
                        let _ = std::fs::remove_file(entry.path());
                        log::info!("Auto-uninstalled plugin from {:?}", entry.path());
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_owned_plugin_file_name;

    #[test]
    fn plugin_cleanup_only_matches_files_owned_by_the_app() {
        assert!(is_owned_plugin_file_name("ISpooferMotion.rbxmx"));
        assert!(is_owned_plugin_file_name("ISpooferMotion (2).rbxmx"));
        assert!(is_owned_plugin_file_name(".ISpooferMotion.rbxmx.tmp"));
        assert!(!is_owned_plugin_file_name("MyISpooferMotionNotes.rbxmx"));
        assert!(!is_owned_plugin_file_name("ISpooferMotion (backup).rbxmx"));
        assert!(!is_owned_plugin_file_name("ISpooferMotion-helper.lua"));
    }
}
