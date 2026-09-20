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
    tokio::fs::write(path, json_str).await.map_err(crate::error::AppError::from)
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

#[cfg(test)]
mod tests {
    use super::{logging::sanitized_context_pub, redact_log_message};

    #[test]
    fn redacts_identifying_paths_and_cookie_values() {
        let message = r#"C:\Users\private-name\project /Users/private-name/project /home/private-name/project username=private-name .ROBLOSECURITY=secret x-api-key=also-secret apiKey=another-secret"#;
        let redacted = redact_log_message(message);

        assert!(!redacted.contains("private-name"));
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("####"));
    }

    #[test]
    fn redacts_sensitive_support_report_context() {
        let context = serde_json::json!({
            "cookie": "secret-cookie",
            "apiKey": "secret-key",
            "nested": {
                "path": r"C:\Users\private-name\project"
            }
        });
        let redacted = sanitized_context_pub(Some(context)).to_string();

        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("private-name"));
        assert!(redacted.contains("####"));
    }
}
