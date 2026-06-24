// Hide console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Pretty standard Tauri boilerplate here. Real logic lives in lib.rs
fn main() {
    app_lib::run();
}
