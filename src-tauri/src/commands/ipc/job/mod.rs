#![allow(clippy::needless_pass_by_value)]
pub mod processor;
pub mod state;
pub mod types;

use crate::commands::AnyValue;
use tauri::AppHandle;

use processor::process_spoofer_action;
use state::update_spoofer_control;
use types::SpooferActionRequest;

#[tauri::command]
#[specta::specta]
// Entry point for initiating a spoofing job.
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
// Toggle the pause flag in the job control state.
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

/// Force-clears the global spoofer job lock even if the active job_id doesn't match.
///
/// Normally only `finish_spoofer_job` should clear this, which requires matching the
/// active job_id. This command exists as an escape hatch for the "Force Reset (Stuck?)"
/// button: if a Rust panic orphaned the lock (job finished abnormally and never called
/// finish_spoofer_job), the user can clear it without restarting the app.
#[tauri::command]
#[specta::specta]
pub fn force_reset_spoofer_job() {
    if let Ok(mut control) = state::spoofer_control().lock() {
        *control = state::SpooferControl::default();
    }
}

#[tauri::command]
#[specta::specta]
pub async fn check_session(app: AppHandle) -> crate::error::Result<AnyValue> {
    let result = crate::commands::session::load_session(app).await?;
    Ok(result.unwrap_or(AnyValue(serde_json::Value::Null)))
}
