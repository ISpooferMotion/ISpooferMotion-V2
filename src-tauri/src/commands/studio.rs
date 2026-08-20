//! Commands that bridge the gap between the Tauri app and the Roblox Studio plugin.

pub(crate) fn parse_replacements_map(
    replacements_map: &crate::commands::AnyValue,
) -> Vec<serde_json::Value> {
    if let Some(arr) = replacements_map.0.as_array() {
        return arr
            .iter()
            .filter_map(|item| {
                let orig = item.get("originalId")?.as_str()?;
                let new_id = item.get("newId")?.as_str()?;
                if new_id.is_empty() || new_id == orig {
                    return None;
                }
                let mut mapping = serde_json::json!({
                    "originalId": orig,
                    "newId": new_id,
                });
                if let Some(targets) = item.get("targetPaths") {
                    mapping["targetPaths"] = targets.clone();
                }
                Some(mapping)
            })
            .collect();
    }
    replacements_map
        .0
        .as_object()
        .cloned()
        .map(|replacements| {
            replacements
                .into_iter()
                .filter_map(|(original_id, new_id)| {
                    let (new_id_str, target_paths) = if let Some(s) = new_id.as_str() {
                        (s.to_string(), None)
                    } else if let Some(n) = new_id.as_u64() {
                        (n.to_string(), None)
                    } else if let Some(n) = new_id.as_i64() {
                        (n.to_string(), None)
                    } else {
                        let obj = new_id.as_object()?;
                        let new_id_str = if let Some(s) =
                            obj.get("newId").and_then(serde_json::Value::as_str)
                        {
                            s.to_string()
                        } else if let Some(n) = obj.get("newId").and_then(serde_json::Value::as_u64)
                        {
                            n.to_string()
                        } else {
                            let n = obj.get("newId").and_then(serde_json::Value::as_i64)?;
                            n.to_string()
                        };
                        let targets = obj.get("targetPaths").cloned();
                        (new_id_str, targets)
                    };
                    if new_id_str.is_empty() || new_id_str == original_id {
                        return None;
                    }
                    let mut mapping = serde_json::json!({
                        "originalId": original_id,
                        "newId": new_id_str,
                    });
                    if let Some(targets) = target_paths {
                        mapping["targetPaths"] = targets;
                    }
                    Some(mapping)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

/// Dispatches a mapping of original asset IDs to spoofed asset IDs directly into Roblox Studio.
///
/// Tries to use the high-performance memory bridge first. If the plugin isn't connected
/// to the bridge, it falls back to a direct local HTTP POST.
#[tauri::command]
#[specta::specta]
pub async fn push_to_studio(
    replacements_map: crate::commands::AnyValue,
    plugin_port: Option<String>,
) -> crate::error::Result<String> {
    log::info!("push_to_studio called with replacements_map: {:?}", replacements_map);
    let mappings = parse_replacements_map(&replacements_map);

    if mappings.is_empty() {
        log::error!("push_to_studio: no valid mappings after parsing");
        return Ok("empty_mappings".into());
    }

    if crate::studio_bridge::queue_replace_mappings_internal(mappings.clone()).await {
        log::info!("push_to_studio: queued {} mappings via internal bridge", mappings.len());
        return Ok("ok".into());
    }

    log::warn!("push_to_studio: internal bridge unavailable, trying direct HTTP fallback");
    let port = plugin_port.and_then(|value| value.parse::<u16>().ok()).unwrap_or(14285);
    let url = format!("http://127.0.0.1:{port}/replace-ids");
    let send_result = crate::utils::get_local_http_client()
        .post(&url)
        .json(&serde_json::json!({ "mappings": mappings }))
        .send()
        .await;

    match send_result {
        Ok(response) if response.status().is_success() => Ok("ok".into()),
        Ok(response) => {
            log::error!("push_to_studio: fallback returned HTTP {}", response.status());
            Ok("bridge_unavailable".into())
        }
        Err(e) => {
            log::error!("push_to_studio: fallback HTTP failed: {}", e);
            Ok("plugin_not_connected".into())
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn set_plugin_theme_accent(color: String) -> Result<(), String> {
    crate::studio_bridge::set_theme_accent(color).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_plugin_batch_size(batch_size: u32) -> Result<(), String> {
    crate::studio_bridge::set_batch_size(batch_size).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_replacements_map_valid_strings() {
        let json = serde_json::json!({
            "123": "456",
            "abc": "def"
        });
        let any_val = crate::commands::AnyValue(json);

        let mut parsed = parse_replacements_map(&any_val);
        // Sort to ensure deterministic order in test
        parsed.sort_by(|a, b| {
            a["originalId"].as_str().expect("str").cmp(b["originalId"].as_str().expect("str"))
        });

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0]["originalId"], "123");
        assert_eq!(parsed[0]["newId"], "456");
        assert_eq!(parsed[1]["originalId"], "abc");
        assert_eq!(parsed[1]["newId"], "def");
    }

    #[test]
    fn test_parse_replacements_map_numbers() {
        let json = serde_json::json!({
            "123": 456,
            "789": -100
        });
        let any_val = crate::commands::AnyValue(json);

        let mut parsed = parse_replacements_map(&any_val);
        parsed.sort_by(|a, b| {
            a["originalId"].as_str().expect("str").cmp(b["originalId"].as_str().expect("str"))
        });

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0]["originalId"], "123");
        assert_eq!(parsed[0]["newId"], "456"); // numbers convert to string
        assert_eq!(parsed[1]["originalId"], "789");
        assert_eq!(parsed[1]["newId"], "-100");
    }

    #[test]
    fn test_parse_replacements_map_filters_invalid() {
        let json = serde_json::json!({
            "123": "", // empty string rejected
            "456": "456", // same as original rejected
            "789": null, // null rejected
            "abc": ["array"], // array rejected
            "valid": "yes"
        });
        let any_val = crate::commands::AnyValue(json);

        let parsed = parse_replacements_map(&any_val);

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["originalId"], "valid");
        assert_eq!(parsed[0]["newId"], "yes");
    }
}
