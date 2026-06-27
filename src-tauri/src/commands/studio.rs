
#[tauri::command]
#[specta::specta]
// sends the final asset mappings over to the roblox studio plugin so it can actually swap the ids in their game
pub async fn push_to_studio(
    replacements_map: serde_json::Value,
    plugin_port: Option<String>,
) -> crate::error::Result<bool> {
    log::info!("push_to_studio called with replacements_map: {:?}", replacements_map);
    let mappings = replacements_map
        .as_object()
        .cloned()
        .map(|replacements| {
            replacements
                .into_iter()
                .map(|(original_id, new_id)| {
                    let new_id_str = if let Some(s) = new_id.as_str() {
                        s.to_string()
                    } else if let Some(n) = new_id.as_u64() {
                        n.to_string()
                    } else if let Some(n) = new_id.as_i64() {
                        n.to_string()
                    } else {
                        String::new()
                    };
                    
                    serde_json::json!({
                        "originalId": original_id,
                        "newId": new_id_str,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if mappings.is_empty() {
        log::error!("push_to_studio: mappings is empty!");
        return Ok(false);
    }

    if crate::studio_bridge::queue_replace_mappings_internal(mappings.clone()).await {
        log::info!("push_to_studio: queue_replace_mappings_internal succeeded");
        return Ok(true);
    }

    log::error!("push_to_studio: queue_replace_mappings_internal returned false, trying fallback");
    let port = plugin_port.and_then(|value| value.parse::<u16>().ok()).unwrap_or(14285);
    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/replace-ids"))
        .header("X-API-Key", crate::studio_bridge::bridge_api_key())
        .json(&serde_json::json!({ "mappings": mappings }))
        .send()
        .await?;
    
    let success = response.status().is_success();
    log::info!("push_to_studio: fallback response success = {}", success);
    Ok(success)
}
