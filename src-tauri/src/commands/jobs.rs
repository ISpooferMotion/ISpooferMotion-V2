use crate::commands::AnyValue;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use super::ipc::{read_json_file, write_json_file};

static JOB_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

fn job_mutex() -> &'static Mutex<()> {
    JOB_MUTEX.get_or_init(|| Mutex::new(()))
}

fn get_jobs_path(app: &AppHandle) -> crate::error::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("job-history.json"))
}

fn sanitize_job(job: &mut Value) -> bool {
    let mut dirty = false;
    if let Some(config) = job.get_mut("config").and_then(Value::as_object_mut) {
        dirty |= config.remove("cookie").is_some();
        dirty |= config.remove("apiKey").is_some();
        dirty |= config.remove("api_key").is_some();
    }
    dirty
}

fn sanitize_job_history(jobs: &mut Value) -> bool {
    let mut dirty = false;
    if let Some(entries) = jobs.as_array_mut() {
        for job in entries {
            dirty |= sanitize_job(job);
        }
    }
    dirty
}

#[tauri::command]
#[specta::specta]
pub async fn get_jobs(app: AppHandle) -> crate::error::Result<AnyValue> {
    let _guard = job_mutex().lock().await;
    let path = get_jobs_path(&app)?;
    let mut jobs = read_json_file(&path).await?;
    if !jobs.is_array() {
        jobs = Value::Array(vec![]);
    }
    if sanitize_job_history(&mut jobs) {
        write_json_file(&path, &jobs).await?;
    }
    Ok(AnyValue(jobs))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_job(app: AppHandle, job_id: String) -> crate::error::Result<bool> {
    let _guard = job_mutex().lock().await;
    let path = get_jobs_path(&app)?;
    let mut jobs = read_json_file(&path).await?;
    if let Some(entries) = jobs.as_array_mut() {
        let before_len = entries.len();
        entries.retain(|job| job.get("id").and_then(Value::as_str) != Some(job_id.as_str()));
        if entries.len() == before_len {
            return Ok(false);
        }
        write_json_file(&path, &jobs).await?;
    }
    Ok(true)
}

pub(super) async fn persist_job(app: &AppHandle, job: Value) -> crate::error::Result<bool> {
    let _guard = job_mutex().lock().await;
    let path = get_jobs_path(app)?;
    let mut jobs = read_json_file(&path).await?;
    if !jobs.is_array() {
        jobs = Value::Array(vec![]);
    }
    let mut sanitized_job = job;
    sanitize_job(&mut sanitized_job);
    if let Some(entries) = jobs.as_array_mut() {
        entries.insert(0, sanitized_job);
        entries.truncate(250);
    }
    write_json_file(&path, &jobs).await?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn open_job_log(app: AppHandle, log_path: String) -> crate::error::Result<bool> {
    let logs_dir = app.path().app_data_dir()?.join("ispoofer_logs");
    let canonical_logs_dir = tokio::fs::canonicalize(logs_dir).await?;
    let canonical_log_path = tokio::fs::canonicalize(log_path).await?;

    if !canonical_log_path.starts_with(canonical_logs_dir) {
        return Err("Job log path is outside the logs directory.".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(canonical_log_path.to_string_lossy().into_owned(), None::<String>)
        .map_err(|err| err.to_string())?;
    Ok(true)
}
