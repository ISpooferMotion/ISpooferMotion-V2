#![allow(clippy::needless_pass_by_value)]
pub mod processor;
pub mod state;
pub mod types;

use tauri::AppHandle;

use processor::process_spoofer_action;
use state::update_spoofer_control;
use types::SpooferActionRequest;

#[tauri::command]
#[specta::specta]
pub async fn run_spoofer_action(
    app: AppHandle,
    data: SpooferActionRequest,
) -> crate::error::Result<()> {
    use validator::Validate;
    if let Err(e) = data.validate() {
        return Err(crate::error::AppError::Custom(format!("Validation failed: {}", e)));
    }
    process_spoofer_action(app, data).await
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn spoofer_pause(job_id: String) -> bool {
    update_spoofer_control(&job_id, |control| control.paused = true)
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn spoofer_resume(job_id: String) -> bool {
    update_spoofer_control(&job_id, |control| control.paused = false)
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn spoofer_cancel(job_id: String) -> bool {
    update_spoofer_control(&job_id, |control| control.cancelled = true)
}

#[tauri::command]
#[specta::specta]
pub fn force_reset_spoofer_job() {
    if let Ok(mut control) = state::spoofer_control().lock() {
        *control = state::SpooferControl::default();
    }
}
