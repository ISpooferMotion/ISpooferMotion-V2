//! The core ISpooferMotion application library.
//!
//! This module registers all Tauri commands, initializes plugins, sets up global state,
//! and bootstraps both the React frontend and the background Studio polling daemon.

pub mod api_dump;
pub mod commands;
pub mod domain;
pub mod error;
pub mod studio_bridge;
pub mod utils;

use tauri::Manager;

/// Generates the Specta type bindings for frontend-to-backend commands.
///
/// Specta inspects the signatures of these commands at compile time and generates
/// a `bindings.ts` file so the React frontend has strongly-typed RPC calls.
macro_rules! specta_commands {
    () => {
        tauri_specta::collect_commands![
            crate::commands::anim_parser::parse_animation_data,
            crate::commands::assets::fetch_assets,
            crate::commands::assets::fetch_roblox_thumbnail,
            crate::commands::assets::fetch_animation_xml,
            crate::commands::auth::get_cookie_from_roblox_studio,
            crate::commands::auth::get_cookie_from_auto_detect,
            crate::commands::auth::delete_saved_roblox_profile_cookie,
            crate::commands::auth::get_csrf_token,
            crate::commands::auth::get_authenticated_user_id,
            crate::commands::auth::get_roblox_user_info,
            crate::commands::auth::get_roblox_user_avatar,
            crate::commands::auth::get_manageable_groups,
            crate::commands::auth::get_group_icon,
            crate::commands::auth::get_group_icons_batch,
            crate::commands::auth::detect_opencloud_api_key_owner,
            crate::commands::auth::validate_opencloud_api_key,
            crate::commands::auth::get_auth_metadata,
            crate::commands::startup::close_splashscreen,
            crate::commands::startup::sync_roblox_plugin,
            crate::commands::fs::open_data_folder,
            crate::commands::fs::clear_app_cache,
            crate::commands::fs::play_roblox_audio,
            crate::commands::fs::show_notification,
            crate::commands::fs::open_dev_console,
            crate::commands::ipc::app::window_minimize,
            crate::commands::ipc::app::window_close,
            crate::commands::ipc::app::quit_app,
            crate::commands::ipc::app::get_app_version,
            crate::commands::ipc::app::get_release_source,
            crate::commands::ipc::app::get_runtime_info,
            crate::commands::ipc::app::open_external,
            crate::commands::ipc::app::select_folder,
            crate::commands::ipc::app::uninstall_app,
            crate::commands::ipc::app::clear_plugin_cache,
            crate::commands::ipc::app::open_frontend_devtools,
            crate::commands::ipc::app::set_proxy_url,
            crate::commands::ipc::job::run_spoofer_action,
            crate::commands::ipc::job::spoofer_pause,
            crate::commands::ipc::job::spoofer_resume,
            crate::commands::ipc::job::spoofer_cancel,
            crate::commands::ipc::job::check_session,
            crate::commands::ipc::logging::append_debug_log,
            crate::commands::ipc::logging::open_logs_folder,
            crate::commands::ipc::logging::open_plugins_folder,
            crate::commands::ipc::logging::copy_debug_info,
            crate::commands::ipc::logging::export_support_report,
            crate::commands::ipc::profile::get_roblox_profile,
            crate::commands::ipc::profile::fetch_audio_quota,
            crate::commands::ipc::secrets::load_renderer_settings,
            crate::commands::ipc::secrets::save_renderer_settings,
            crate::commands::ipc::secrets::load_profile_secrets,
            crate::commands::ipc::secrets::save_profile_secrets,
            crate::commands::ipc::secrets::clear_profile_secrets,
            crate::commands::jobs::get_jobs,
            crate::commands::jobs::delete_job,
            crate::commands::jobs::open_job_log,
            crate::commands::resolver::resolve_asset_creators,
            crate::commands::resolver::resolve_script_references,
            crate::commands::resolver::validate_asset_ids,
            crate::commands::roblox_status::check_roblox_api_status,
            crate::commands::session::save_session,
            crate::commands::session::load_session,
            crate::commands::session::clear_session,
            crate::commands::place_parser::parse_place_file,
            crate::commands::spoofer::memory::find_studio_process,
            crate::commands::spoofer::memory::focus_and_save_studio,
            crate::commands::spoofer::memory::scan_and_replace_multiple_strings,
            crate::commands::spoofer::clear_asset_cache,
            crate::commands::spoofer::remote_cache::initialize_remote_cache,
            crate::commands::spoofer::permissions::patch_asset_permissions,
            crate::commands::spoofer::permissions::batch_grant_asset_permissions,
            crate::commands::spoofer::permissions::set_asset_privacy,
            crate::commands::spoofer::place::get_place_id_from_creator,
            crate::commands::spoofer::place::get_multiple_place_ids,
            crate::commands::spoofer::place::discover_asset_place_id,
            crate::commands::spoofer::place::get_universe_id_from_place_id,
            crate::commands::spoofer::place::search_global_places,
            crate::commands::spoofer::place::clear_downloads_directory_command,
            crate::commands::spoofer::place::find_asset_by_name,
            crate::commands::studio::push_to_studio,
            crate::commands::studio::set_plugin_theme_accent,
            crate::studio_bridge::set_bridge_skip_owned_check,
            crate::studio_bridge::get_plugin_bridge_port,
            crate::studio_bridge::get_studio_health_status,
            crate::studio_bridge::get_port_diagnostic,
            crate::studio_bridge::get_studio_asset_snapshots
        ]
    };
}

/// Initializes and runs the Tauri application lifecycle.
///
/// This sets up global crash handlers, initializes Specta types (if in debug mode),
/// registers plugins, starts the local IPC daemon for Roblox Studio, and finally
/// launches the webview.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Export TypeScript bindings during debug builds.
    #[cfg(debug_assertions)]
    {
        log::info!("ISpooferMotion: Exporting Specta bindings in a high-stack thread...");
        std::thread::Builder::new()
            .stack_size(128 * 1024 * 1024)
            .name("specta-export".to_string())
            .spawn(|| {
                let builder =
                    tauri_specta::Builder::<tauri::Wry>::new().commands(specta_commands!());
                builder
                    .export(specta_typescript::Typescript::default(), "../src/types/bindings.ts")
                    .expect("Failed to export typescript bindings");
            })
            .expect("Failed to spawn specta thread")
            .join()
            .expect("Failed to join specta thread");
        log::info!("ISpooferMotion: Finished Exporting Specta bindings!");
    }

    // Initialize native OS panic dialogs and logging.
    std::panic::set_hook(Box::new(|info| {
        let msg =
            format!("ISpooferMotion encountered a fatal error. Please check the logs.\n\n{}", info);
        log::error!("FATAL PANIC: {}", msg);
        let _ = rfd::MessageDialog::new()
            .set_title("Fatal Error")
            .set_description(&msg)
            .set_level(rfd::MessageLevel::Error)
            .show();
    }));

    log::info!("ISpooferMotion: Initializing Tauri Builder...");
    let builder = tauri_specta::Builder::<tauri::Wry>::new().commands(specta_commands!());

    #[allow(unused_mut)]
    let mut app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .invoke_handler(builder.invoke_handler())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(debug_assertions)]
    {
        app_builder = app_builder.plugin(tauri_plugin_playwright::init());
    }

    app_builder
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                crate::commands::startup::uninstall_roblox_plugin();
            }
        })
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            app.handle().plugin(
                tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
            )?;

            // Initialize the bridge server asynchronously.
            tauri::async_runtime::spawn(crate::studio_bridge::start_server(app.handle().clone()));

            // Initialize system tray icon.
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let _tray = TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("default window icon should be bundled for tray setup"),
                )
                .tooltip("ISpooferMotion")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    log::info!("ISpooferMotion: Exiting run()");
}
