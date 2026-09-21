#[tauri::command]
#[specta::specta]
pub async fn check_roblox_api_status() -> crate::error::Result<bool> {
    let client = crate::utils::get_http_client();

    match client.get("https://users.roblox.com/v1/health").send().await {
        Ok(resp) => Ok(!resp.status().is_server_error()),
        Err(_) => Ok(false),
    }
}
