pub mod app;
pub mod job;
pub mod logging;
pub mod profile;
pub mod secrets;

use keyring::Entry;
use regex::Regex;
use reqwest::header::{COOKIE, USER_AGENT};
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::utils::build_roblox_cookie_header;

static REDACTION_REGEXES: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();

pub(super) async fn read_json_file(path: &PathBuf) -> crate::error::Result<Value> {
    match tokio::fs::read_to_string(path).await {
        Ok(content) => Ok(serde_json::from_str(&content)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(Value::Object(serde_json::Map::new()))
        }
        Err(e) => Err(e.into()),
    }
}

pub(super) async fn write_json_file(path: &PathBuf, value: &Value) -> crate::error::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json_str = serde_json::to_string_pretty(value)?;
    let temp_path = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
    tokio::fs::write(&temp_path, json_str).await?;
    if let Err(error) = tokio::fs::rename(&temp_path, path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(error.into());
    }
    Ok(())
}

static REDACTION_ENV_VARS: OnceLock<Vec<String>> = OnceLock::new();

pub(super) fn redact_log_message(message: &str) -> String {
    let mut redacted = message.to_string();

    let env_vars = REDACTION_ENV_VARS.get_or_init(|| {
        let mut vars = Vec::new();
        for key in ["USERPROFILE", "HOME"] {
            if let Ok(value) = std::env::var(key) {
                if !value.is_empty() {
                    vars.push(value);
                }
            }
        }
        for key in ["USERNAME", "USER"] {
            if let Ok(value) = std::env::var(key) {
                if value.len() > 2 {
                    vars.push(value);
                }
            }
        }
        vars
    });

    for value in env_vars {
        redacted = redacted.replace(value, "####");
    }

    let regexes = REDACTION_REGEXES.get_or_init(|| {
        let patterns = [
            (r"(?i)([a-z]:\\users\\)[^\\/\s]+", "$1####"),
            (r"(?i)(/users/)[^/\s]+", "$1####"),
            (r"(?i)(/home/)[^/\s]+", "$1####"),
            (r"(?i)(\b(?:user(?:name)?|display[_ -]?name|profile)\s*[:=]\s*)[^\s,;]+", "$1####"),
            (r"(?i)(\.roblosecurity=)[^\s,;]+", "$1####"),
            (r"(?i)(\b(?:x-api-key|api[_ -]?key)\s*[:=]\s*)[^\s,;]+", "$1####"),
        ];
        patterns
            .into_iter()
            .filter_map(|(pat, rep)| Regex::new(pat).ok().map(|r| (r, rep)))
            .collect()
    });

    for (regex, replacement) in regexes {
        redacted = regex.replace_all(&redacted, *replacement).into_owned();
    }
    redacted
}

pub fn append_log_entry(
    app: &AppHandle,
    level: &str,
    source: &str,
    message: &str,
) -> crate::error::Result<()> {
    let logs_dir = app.path().app_data_dir()?.join("ispoofer_logs");
    std::fs::create_dir_all(&logs_dir)?;
    logging::cleanup_logs_dir(&logs_dir);
    let file_path = logs_dir.join(format!("debug-{}.txt", chrono::Local::now().format("%Y-%m-%d")));
    let mut file = OpenOptions::new().create(true).append(true).open(file_path)?;
    writeln!(
        file,
        "[{}] [{}] [{}] {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        level.to_uppercase(),
        source,
        redact_log_message(message)
    )?;
    Ok(())
}
