use super::{
    build_roblox_cookie_header, get_asset_cache, is_valid_numeric_id, set_rate_limit,
    wait_rate_limit, AppHandle, Duration, Manager, RateLimitBucket, Value, COOKIE,
};
use std::collections::HashSet;

#[must_use]
pub fn parse_excluded_id_list(raw: Option<&str>) -> HashSet<String> {
    let mut ids = HashSet::new();
    for candidate in raw
        .unwrap_or_default()
        .split(|character: char| character == ',' || character.is_whitespace())
    {
        let trimmed = candidate.trim();
        if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit()) {
            ids.insert(trimmed.to_string());
        }
    }
    ids
}

// decides if we should ignore this asset based on whether the user already owns it or if it belongs to a blacklisted group
pub async fn should_skip_asset_for_spoofing(
    app: AppHandle,
    asset_id: &str,
    cookie: &str,
    skip_owned: bool,
    account_id: Option<&str>,
    group_id: Option<&str>,
    excluded_users: &HashSet<String>,
    excluded_groups: &HashSet<String>,
) -> bool {
    if !skip_owned && excluded_users.is_empty() && excluded_groups.is_empty() {
        return false;
    }

    let Ok((creator_type, creator_id)) =
        get_asset_creator_for_asset(app, asset_id.to_string(), cookie.to_string()).await
    else {
        return false;
    };

    if creator_type == "user" && excluded_users.contains(&creator_id) {
        return true;
    }
    if creator_type == "group" && excluded_groups.contains(&creator_id) {
        return true;
    }

    if !skip_owned {
        return false;
    }

    if creator_type == "user" {
        return account_id.is_some_and(|id| id == creator_id);
    }
    if creator_type == "group" {
        return group_id.is_some_and(|id| id == creator_id);
    }

    false
}

/// Fastest possible place-context path: resolves an asset directly to the universe(s)
/// that own it via the `asset-to-universe` endpoint, then batch-resolves those universes
/// to their root place IDs. One successful call here makes all creator/game-list
/// scraping unnecessary.
async fn asset_to_universe_fast_path(asset_id: &str, cookie_header: &str) -> Vec<String> {
    let client = crate::utils::get_http_client();

    // Asset -> universeIds
    let url = format!("https://games.roblox.com/v1/games/asset-to-universe?assetId={asset_id}");
    let mut resp_opt = None;
    for _ in 0..3 {
        wait_rate_limit(RateLimitBucket::PlaceLookup).await;
        let attempt = tokio::time::timeout(
            Duration::from_secs(8),
            client
                .get(&url)
                .header(reqwest::header::COOKIE, cookie_header)
                .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
                .send(),
        )
        .await;

        match attempt {
            Ok(Ok(r)) => {
                if r.status().is_success() {
                    resp_opt = Some(r);
                    break;
                } else if r.status().as_u16() == 429 {
                    let wait_ms = crate::utils::extract_retry_after(&r, None).unwrap_or(2000);
                    set_rate_limit(RateLimitBucket::PlaceLookup, Duration::from_millis(wait_ms));
                    tokio::time::sleep(Duration::from_millis(wait_ms)).await;
                } else {
                    break;
                }
            }
            _ => break,
        }
    }

    let Some(resp) = resp_opt else {
        return Vec::new();
    };

    let data: serde_json::Value = match resp.json().await {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };

    let universe_ids: Vec<String> = data
        .get("universeIds")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(value_to_string).collect())
        .unwrap_or_default();

    if universe_ids.is_empty() {
        return Vec::new();
    }

    // universeIds -> rootPlaceIds
    let mut place_ids: Vec<String> = Vec::new();
    for chunk in universe_ids.chunks(50) {
        let ids_str = chunk.join(",");
        let url2 = format!("https://games.roblox.com/v1/games?universeIds={ids_str}");
        let resp2 = match tokio::time::timeout(
            Duration::from_secs(8),
            client
                .get(&url2)
                .header(reqwest::header::COOKIE, cookie_header)
                .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
                .send(),
        )
        .await
        {
            Ok(Ok(r)) if r.status().is_success() => r,
            _ => continue,
        };
        if let Ok(data2) = resp2.json::<serde_json::Value>().await {
            if let Some(arr) = data2.get("data").and_then(|d| d.as_array()) {
                for game in arr {
                    if let Some(pid) = game.get("rootPlaceId").and_then(value_to_string) {
                        place_ids.push(pid);
                    }
                }
            }
        }
    }

    place_ids
}

/// Fetches groups the user belongs to where their rank is at least `min_rank`, sorted
/// by rank descending and capped at `top_n`. Returns `(group_id, rank)` tuples.
async fn fetch_user_high_rank_groups(
    user_id: &str,
    cookie_header: &str,
    min_rank: u32,
    top_n: usize,
) -> Vec<(String, u32)> {
    let client = crate::utils::get_http_client();
    let mut groups: Vec<(String, u32)> = Vec::new();
    let mut cursor = String::new();

    for _ in 0..5 {
        let mut url = format!(
            "https://groups.roblox.com/v2/users/{user_id}/groups/roles?sortOrder=Asc&limit=50"
        );
        if !cursor.is_empty() {
            url.push_str(&format!("&cursor={cursor}"));
        }

        let resp = match tokio::time::timeout(
            Duration::from_secs(8),
            client
                .get(&url)
                .header(reqwest::header::COOKIE, cookie_header)
                .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
                .send(),
        )
        .await
        {
            Ok(Ok(r)) if r.status().is_success() => r,
            _ => break,
        };

        let data: serde_json::Value = match resp.json().await {
            Ok(d) => d,
            Err(_) => break,
        };

        let Some(entries) = data.get("data").and_then(|d| d.as_array()) else {
            break;
        };

        for entry in entries {
            let grp = entry.get("group").unwrap_or(&serde_json::Value::Null);
            let role = entry.get("role").unwrap_or(&serde_json::Value::Null);
            let Some(gid) = grp.get("id").and_then(value_to_string) else {
                continue;
            };
            let rank = role.get("rank").and_then(serde_json::Value::as_u64).unwrap_or(0) as u32;
            if rank >= min_rank {
                groups.push((gid, rank));
            }
        }

        cursor =
            data.get("nextPageCursor").and_then(|c| c.as_str()).unwrap_or_default().to_string();
        if cursor.is_empty() {
            break;
        }
    }

    groups.sort_by_key(|g| std::cmp::Reverse(g.1));
    groups.truncate(top_n);
    groups
}

/// Fetches root place IDs for a single group. Designed to be spawned concurrently
/// across many groups - keeps its own rate limiting via short sleeps rather than
/// the shared bucket to avoid contention from parallel callers.
async fn fetch_group_place_ids_parallel(
    group_id: String,
    cookie_header: String,
    limit: usize,
) -> Vec<String> {
    let client = crate::utils::get_http_client();
    let mut place_ids: Vec<String> = Vec::new();
    let mut cursor = String::new();

    for _ in 0..5 {
        if place_ids.len() >= limit {
            break;
        }

        let mut url =
            format!("https://games.roblox.com/v2/groups/{group_id}/games?sortOrder=Desc&limit=25");
        if !cursor.is_empty() {
            url.push_str(&format!("&cursor={cursor}"));
        }

        let resp = match tokio::time::timeout(
            Duration::from_secs(8),
            client
                .get(&url)
                .header(reqwest::header::COOKIE, cookie_header.as_str())
                .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
                .send(),
        )
        .await
        {
            Ok(Ok(r)) if r.status().is_success() => r,
            _ => break,
        };

        let data: serde_json::Value = match resp.json().await {
            Ok(d) => d,
            Err(_) => break,
        };

        let Some(games) = data.get("data").and_then(|d| d.as_array()) else {
            break;
        };

        for game in games {
            if place_ids.len() >= limit {
                break;
            }
            let pid = game
                .get("rootPlace")
                .and_then(|rp| rp.get("id"))
                .or_else(|| game.get("rootPlaceId"))
                .and_then(value_to_string);
            if let Some(id) = pid {
                place_ids.push(id);
            }
        }

        cursor =
            data.get("nextPageCursor").and_then(|c| c.as_str()).unwrap_or_default().to_string();
        if cursor.is_empty() {
            break;
        }

        // Brief inter-page pause to avoid hammering the same group's endpoint.
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    place_ids
}

pub async fn get_place_ids_for_asset_creator(
    app: AppHandle,
    asset_id: String,
    cookie: String,
    max_place_ids: Option<u32>,
    place_name: Option<String>,
) -> crate::error::Result<Vec<String>> {
    let cookie_header = build_roblox_cookie_header(&cookie);

    // Fast path: asset-to-universe. This single API call resolves which universe(s)
    // directly reference this asset - no creator lookup or game-list scraping needed.
    // It is the highest-confidence source, so we try it first and only fall through
    // to the creator-based path when it returns nothing.
    let fast_ids = if cookie_header.is_empty() {
        Vec::new()
    } else {
        asset_to_universe_fast_path(&asset_id, &cookie_header).await
    };

    let mut place_ids = if fast_ids.is_empty() {
        match get_asset_creator_for_asset(app.clone(), asset_id, cookie.clone()).await {
            Ok((creator_type, creator_id)) => get_place_id_from_creator(
                app.clone(),
                creator_type,
                creator_id,
                cookie,
                max_place_ids,
                place_name,
            )
            .await
            .unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        fast_ids
    };

    if place_ids.is_empty() {
        place_ids.push("1818".to_string());
    }

    Ok(place_ids)
}

// hits the open cloud api to find out who actually made the asset so we know if we need to spoof it
pub async fn get_asset_creator_for_asset(
    app: AppHandle,
    asset_id: String,
    cookie: String,
) -> crate::error::Result<(String, String)> {
    if !is_valid_numeric_id(&asset_id) {
        return Err("Invalid Roblox asset id.".into());
    }

    static CREATOR_CACHE: std::sync::OnceLock<dashmap::DashMap<String, (String, String)>> =
        std::sync::OnceLock::new();
    let cache = CREATOR_CACHE.get_or_init(dashmap::DashMap::new);
    if let Some(cached) = cache.get(&asset_id) {
        return Ok(cached.value().clone());
    }

    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err(crate::error::AppError::Custom(
            "Missing or invalid ROBLOSECURITY cookie".into(),
        ));
    }

    let client = crate::utils::get_http_client();
    let url = format!("https://apis.roblox.com/assets/user-auth/v1/assets/{asset_id}");
    let resp = tokio::time::timeout(
        Duration::from_secs(8),
        client
            .get(&url)
            .header(reqwest::header::COOKIE, &cookie_header)
            .header(reqwest::header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")
            .header(reqwest::header::ACCEPT, "*/*")
            .header("Origin", "https://create.roblox.com")
            .header("Referer", "https://create.roblox.com/")
            .send()
    )
    .await
    .map_err(|_| crate::error::AppError::Custom("Request timed out".into()))??;

    crate::utils::check_for_roblosecurity_update(&app, &resp, &cookie_header);

    if !resp.status().is_success() {
        return get_asset_creator_from_economy(&asset_id, &cookie_header).await.ok_or_else(|| {
            crate::error::AppError::Custom(format!(
                "Failed to resolve asset creator: {}",
                resp.status()
            ))
        });
    }

    let data: Value = resp.json().await?;
    let creator = data.get("creationContext").and_then(|ctx| ctx.get("creator"));
    let (creator_type, creator_id) = if let Some(user_id) =
        creator.and_then(|c| c.get("userId")).and_then(value_to_string)
    {
        ("user".to_string(), user_id)
    } else if let Some(group_id) = creator.and_then(|c| c.get("groupId")).and_then(value_to_string)
    {
        ("group".to_string(), group_id)
    } else if let Some(fallback) = get_asset_creator_from_economy(&asset_id, &cookie_header).await {
        fallback
    } else {
        return Err(crate::error::AppError::Custom(
            "Asset creator was not present in Roblox response.".into(),
        ));
    };

    cache.insert(asset_id, (creator_type.clone(), creator_id.clone()));
    Ok((creator_type, creator_id))
}

async fn get_asset_creator_from_economy(
    asset_id: &str,
    cookie_header: &str,
) -> Option<(String, String)> {
    let client = crate::utils::get_http_client();
    let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
    let resp = tokio::time::timeout(
        Duration::from_secs(8),
        client
            .get(&url)
            .header(reqwest::header::COOKIE, cookie_header)
            .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
            .send(),
    )
    .await
    .ok()?
    .ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let data: Value = resp.json().await.ok()?;
    let creator = data.get("Creator")?;
    let creator_id = creator.get("CreatorTargetId").and_then(value_to_string)?;
    let creator_type = creator
        .get("CreatorType")
        .or_else(|| creator.get("creatorType"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();

    if creator_type.contains("group") {
        Some(("group".to_string(), creator_id))
    } else if creator_type.contains("user") {
        Some(("user".to_string(), creator_id))
    } else {
        None
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_u64()
        .map(|number| number.to_string())
        .or_else(|| value.as_str().map(std::string::ToString::to_string))
        .filter(|id| is_valid_numeric_id(id))
}

#[tauri::command]
#[specta::specta]
// scrapes a user's or group's games list to find a valid place id we can use for spoofing context
pub async fn get_place_id_from_creator(
    app: AppHandle,
    creator_type: String,
    creator_id: String,
    cookie: String,
    max_place_ids: Option<u32>,
    place_name: Option<String>,
) -> crate::error::Result<Vec<String>> {
    if !is_valid_numeric_id(&creator_id) {
        return Err("Invalid Roblox creator id.".into());
    }
    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err(crate::error::AppError::Custom(
            "Missing or invalid ROBLOSECURITY cookie".into(),
        ));
    }

    let cache_path = app.path().app_data_dir().map(|p| p.join("place_id_cache.json")).ok();
    let cache_key = format!("{}_{}", creator_type, creator_id);

    // Check persistent cache first
    if let Some(ref path) = cache_path {
        if let Ok(data) = tokio::fs::read_to_string(path).await {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(places) = json.get(&cache_key).and_then(|p| p.as_array()) {
                    let cached_places: Vec<String> = places
                        .iter()
                        .filter_map(|p| p.as_str().map(std::string::ToString::to_string))
                        .collect();
                    if !cached_places.is_empty() {
                        return Ok(cached_places);
                    }
                }
            }
        }
    }

    let limit = 50;
    let max_results = max_place_ids.unwrap_or(10).min(100);

    let is_group = creator_type.eq_ignore_ascii_case("group");
    let mut root_places: Vec<(String, String)> = Vec::new();
    let mut seen_places = std::collections::HashSet::new();
    let mut missing_root_universes = Vec::new();
    let mut cursor = String::new();
    let client = crate::utils::get_http_client();

    for sort_order in ["Desc", "Asc"] {
        for filter_opt in [Some("2"), Some("1"), Some("4"), None] {
            cursor.clear();
            while root_places.len() < max_results as usize {
                let mut url = if is_group {
                    if let Some(filter) = filter_opt {
                        format!("https://games.roblox.com/v2/groups/{creator_id}/games?accessFilter={filter}&sortOrder={sort_order}&limit={limit}")
                    } else {
                        format!("https://games.roblox.com/v2/groups/{creator_id}/games?sortOrder={sort_order}&limit={limit}")
                    }
                } else {
                    if let Some(filter) = filter_opt {
                        format!("https://games.roblox.com/v2/users/{creator_id}/games?accessFilter={filter}&limit={limit}&sortOrder={sort_order}")
                    } else {
                        format!("https://games.roblox.com/v2/users/{creator_id}/games?limit={limit}&sortOrder={sort_order}")
                    }
                };

                if !cursor.is_empty() {
                    url.push_str(&format!("&cursor={cursor}"));
                }

                wait_rate_limit(RateLimitBucket::PlaceLookup).await;
                let Ok(resp) = client
                    .get(&url)
                    .header(reqwest::header::COOKIE, &cookie_header)
                    .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
                    .send()
                    .await
                else {
                    break;
                };

                crate::utils::check_for_roblosecurity_update(&app, &resp, &cookie_header);

                if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    let wait_ms = crate::utils::extract_retry_after(&resp, None).unwrap_or(2_000);
                    set_rate_limit(RateLimitBucket::PlaceLookup, Duration::from_millis(wait_ms));
                    tokio::time::sleep(Duration::from_millis(wait_ms)).await;
                    continue;
                }

                if !resp.status().is_success() {
                    break;
                }

                let Ok(data): Result<serde_json::Value, _> = resp.json().await else {
                    break;
                };

                let Some(games) = data.get("data").and_then(|d| d.as_array()) else {
                    break;
                };

                if games.is_empty() {
                    break;
                }

                for game in games {
                    let game_name =
                        game.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();

                    let root_place_id = game
                        .get("rootPlace")
                        .and_then(|rp| rp.get("id"))
                        .or_else(|| game.get("rootPlaceId"))
                        .or_else(|| game.get("placeId"))
                        .or_else(|| game.get("id"))
                        .and_then(value_to_string);

                    let mut found_subplaces = false;
                    if let Some(universe_id) =
                        game.get("id").or_else(|| game.get("universeId")).and_then(value_to_string)
                    {
                        let url = format!("https://develop.roblox.com/v1/universes/{universe_id}/places?limit=100");
                        wait_rate_limit(RateLimitBucket::PlaceLookup).await;
                        if let Ok(resp) = client
                            .get(&url)
                            .header(reqwest::header::COOKIE, &cookie_header)
                            .send()
                            .await
                        {
                            if let Ok(data) = resp.json::<serde_json::Value>().await {
                                if let Some(places) = data.get("data").and_then(|d| d.as_array()) {
                                    for place in places {
                                        if let Some(pid) = place.get("id").and_then(value_to_string)
                                        {
                                            if seen_places.insert(pid.clone()) {
                                                root_places.push((pid, game_name.clone()));
                                                found_subplaces = true;
                                            }
                                        }
                                        if root_places.len() >= max_results as usize {
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if !found_subplaces {
                        if let Some(pid) = root_place_id {
                            if seen_places.insert(pid.clone()) {
                                root_places.push((pid, game_name.clone()));
                            }
                        } else if let Some(universe_id) = game
                            .get("universeId")
                            .or_else(|| game.get("id"))
                            .and_then(value_to_string)
                        {
                            missing_root_universes.push((universe_id, game_name));
                        }
                    }

                    if root_places.len() >= max_results as usize {
                        break;
                    }
                }

                if let Some(next_cursor) = data.get("nextPageCursor").and_then(|c| c.as_str()) {
                    cursor = next_cursor.to_string();
                } else {
                    break;
                }
            }

            if root_places.len() >= max_results as usize {
                break;
            }
        }
        if root_places.len() >= max_results as usize {
            break;
        }
    }

    if root_places.len() < max_results as usize && !missing_root_universes.is_empty() {
        missing_root_universes.dedup_by(|a, b| a.0 == b.0);
        for chunk in missing_root_universes.chunks(50) {
            if root_places.len() >= max_results as usize {
                break;
            }
            let universe_ids_str =
                chunk.iter().map(|(uid, _)| uid.as_str()).collect::<Vec<_>>().join(",");
            let url = format!("https://games.roblox.com/v1/games?universeIds={universe_ids_str}");

            wait_rate_limit(RateLimitBucket::PlaceLookup).await;
            if let Ok(resp) =
                client.get(&url).header(reqwest::header::COOKIE, &cookie_header).send().await
            {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    if let Some(games) = data.get("data").and_then(|d| d.as_array()) {
                        for game in games {
                            if let Some(root_place_id) =
                                game.get("rootPlaceId").and_then(value_to_string)
                            {
                                let uid =
                                    game.get("id").and_then(value_to_string).unwrap_or_default();
                                let game_name = chunk
                                    .iter()
                                    .find(|(id, _)| *id == uid)
                                    .map(|(_, n)| n.clone())
                                    .unwrap_or_default();
                                if seen_places.insert(root_place_id.clone()) {
                                    root_places.push((root_place_id, game_name));
                                }
                            }
                            if root_places.len() >= max_results as usize {
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // Secondary discovery for user-owned assets: if the direct game list didn't fill
    // the quota, also walk the user's high-rank group memberships and fetch their games
    // in parallel. Mirrors the Python script's Path 2 fallback.
    if !is_group && root_places.len() < max_results as usize {
        let remaining = max_results as usize - root_places.len();
        let high_rank_groups =
            fetch_user_high_rank_groups(&creator_id, &cookie_header, 50, 15).await;

        if !high_rank_groups.is_empty() {
            // Spawn one task per group so all fetches run concurrently.
            let handles: Vec<tokio::task::JoinHandle<Vec<String>>> = high_rank_groups
                .into_iter()
                .map(|(gid, _rank)| {
                    let ch = cookie_header.clone();
                    let lim = remaining;
                    tokio::spawn(async move { fetch_group_place_ids_parallel(gid, ch, lim).await })
                })
                .collect();

            for handle in handles {
                if root_places.len() >= max_results as usize {
                    break;
                }
                if let Ok(ids) = handle.await {
                    for id in ids {
                        if root_places.len() >= max_results as usize {
                            break;
                        }
                        if seen_places.insert(id.clone()) {
                            root_places.push((id, String::new()));
                        }
                    }
                }
            }
        }
    }

    if let Some(ref target_name) = place_name {
        let lower_target = target_name.to_lowercase();
        root_places.sort_by_cached_key(|(_, name)| {
            let lower = name.to_lowercase();
            let exact = lower == lower_target;
            let contains = lower.contains(&lower_target);
            // Sorting uses boolean tuple comparison: false < true.
            // By inverting the booleans, we ensure true (exact match) sorts before false.
            (!exact, !contains)
        });
    }

    let place_ids: Vec<String> = root_places.into_iter().map(|(id, _)| id).collect();

    if !place_ids.is_empty() {
        if let Some(ref path) = cache_path {
            let mut cache_json: serde_json::Value = tokio::fs::read_to_string(path)
                .await
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(|| serde_json::json!({}));

            if let Some(obj) = cache_json.as_object_mut() {
                obj.insert(cache_key, serde_json::json!(place_ids));
                if let Ok(new_data) = serde_json::to_string(&cache_json) {
                    let _ = tokio::fs::write(path, new_data).await;
                }
            }
        }
    }

    if place_ids.is_empty() {
        return Err(crate::error::AppError::Custom("No root places found in games".into()));
    }

    Ok(place_ids)
}

#[tauri::command]
#[specta::specta]
pub async fn get_multiple_place_ids(
    app: AppHandle,
    creator_type: String,
    creator_id: String,
    cookie: String,
    max_place_ids: Option<u32>,
    place_name: Option<String>,
) -> crate::error::Result<Vec<String>> {
    get_place_id_from_creator(app, creator_type, creator_id, cookie, max_place_ids, place_name)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_universe_id_from_place_id(
    place_id: String,
    cookie: String,
) -> crate::error::Result<String> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    let client = crate::utils::get_http_client();
    let url =
        format!("https://games.roblox.com/v1/games/multiget-place-details?placeIds={place_id}");

    let resp = client.get(&url).header(COOKIE, cookie_header).send().await?;

    if !resp.status().is_success() {
        return Err("Failed to resolve Universe ID".into());
    }

    let data: serde_json::Value = resp.json().await?;
    let universe_id =
        data.as_array().and_then(|arr| arr.first()).and_then(|obj| obj.get("universeId")).and_then(
            |id| {
                id.as_u64().map(|n| n.to_string()).or_else(|| id.as_str().map(ToString::to_string))
            },
        );

    universe_id.ok_or_else(|| "Universe ID not found".into())
}

#[tauri::command]
#[specta::specta]
pub async fn get_place_id_from_universe_id(
    universe_id: String,
    cookie: String,
) -> crate::error::Result<String> {
    static UNIVERSE_TO_PLACE_CACHE: std::sync::OnceLock<dashmap::DashMap<String, String>> =
        std::sync::OnceLock::new();
    let cache = UNIVERSE_TO_PLACE_CACHE.get_or_init(dashmap::DashMap::new);

    if let Some(cached) = cache.get(&universe_id) {
        return Ok(cached.value().clone());
    }

    let cookie_header = build_roblox_cookie_header(&cookie);
    let client = crate::utils::get_http_client();
    let url = format!("https://games.roblox.com/v1/games?universeIds={universe_id}");

    let resp = client.get(&url).header(COOKIE, cookie_header).send().await?;

    if !resp.status().is_success() {
        return Err("Failed to resolve Place ID from Universe ID".into());
    }

    let data: serde_json::Value = resp.json().await?;
    let place_id = data
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|arr| arr.first())
        .and_then(|obj| obj.get("rootPlaceId"))
        .and_then(|id| {
            id.as_u64().map(|n| n.to_string()).or_else(|| id.as_str().map(ToString::to_string))
        });

    if let Some(pid) = &place_id {
        cache.insert(universe_id, pid.clone());
    }

    place_id.ok_or_else(|| "Place ID not found".into())
}

#[tauri::command]
#[specta::specta]
pub async fn clear_downloads_directory_command(app: AppHandle) -> crate::error::Result<bool> {
    let downloads_dir = app.path().app_data_dir()?.join("downloads");
    crate::utils::clear_downloads_directory(&downloads_dir).await.map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
// paginates through the user's inventory to see if they already uploaded an asset with this exact name
pub async fn find_asset_by_name(
    cookie: String,
    asset_type: String,
    name: String,
    group_id: Option<String>,
) -> crate::error::Result<Option<String>> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Ok(None);
    }

    let cache_key = format!("{}_{}", asset_type, group_id.as_deref().unwrap_or("user"));
    {
        let cache = get_asset_cache();
        if let Some(items) = cache.get(&cache_key) {
            if let Some(id) = items.value().get(&name) {
                return Ok(Some(id.value().clone()));
            }
        }
    }

    let mut cursor = String::new();
    let mut base_url = format!("https://itemconfiguration.roblox.com/v1/creations/get-assets?assetType={asset_type}&isArchived=false&limit=100");
    if let Some(gid) = &group_id {
        if !is_valid_numeric_id(gid) {
            return Err("Invalid Roblox group id.".into());
        }
        base_url.push_str(&format!("&groupId={gid}"));
    }

    let client = crate::utils::get_http_client();

    loop {
        let mut url = base_url.clone();
        if !cursor.is_empty() {
            url.push_str(&format!("&cursor={cursor}"));
        }

        wait_rate_limit(RateLimitBucket::PlaceLookup).await;
        let resp = client
            .get(&url)
            .header(reqwest::header::COOKIE, &cookie_header)
            .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
            .send()
            .await?;

        if resp.status().as_u16() == 429 {
            let wait_ms = crate::utils::extract_retry_after(&resp, None).unwrap_or(2000);
            set_rate_limit(RateLimitBucket::PlaceLookup, Duration::from_millis(wait_ms));
            tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            continue;
        }
        if !resp.status().is_success() {
            break;
        }

        let data: serde_json::Value = resp.json().await?;
        let items = data.get("data").and_then(|d| d.as_array()).ok_or("Invalid response format")?;

        let mut found = None;
        {
            let cache = get_asset_cache();
            let entry = cache.entry(cache_key.clone()).or_default();
            for item in items {
                if let (Some(item_name), Some(asset_id)) = (
                    item.get("name").and_then(|n| n.as_str()),
                    item.get("assetId").and_then(|id| {
                        id.as_u64()
                            .map(|n| n.to_string())
                            .or_else(|| id.as_str().map(std::string::ToString::to_string))
                    }),
                ) {
                    entry.value().insert(item_name.to_string(), asset_id.clone());
                    if item_name == name {
                        found = Some(asset_id);
                    }
                }
            }
        }

        if found.is_some() {
            return Ok(found);
        }

        if let Some(next_cursor) = data.get("nextPageCursor").and_then(|c| c.as_str()) {
            cursor = next_cursor.to_string();
        } else {
            break;
        }
    }

    Ok(None)
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlobalPlacesResponse {
    pub previous_page_cursor: Option<String>,
    pub next_page_cursor: Option<String>,
    pub games: Vec<GlobalPlace>,
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlobalPlace {
    #[specta(type = f64)]
    pub creator_id: i64,
    pub creator_name: String,
    pub creator_type: String,
    #[specta(type = f64)]
    pub universe_id: i64,
    pub name: String,
    #[specta(type = f64)]
    pub place_id: i64,
}

#[tauri::command]
#[specta::specta]
pub async fn search_global_places(
    keyword: String,
    limit: Option<u32>,
) -> crate::error::Result<GlobalPlacesResponse> {
    let limit = limit.unwrap_or(20).min(50);
    let client = crate::utils::get_http_client();
    let encoded_keyword = urlencoding::encode(&keyword);
    let url = format!(
        "https://games.roblox.com/v1/games/list?keyword={}&maxRows={}",
        encoded_keyword, limit
    );

    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(crate::error::AppError::Custom(format!(
            "Failed to search games: {}",
            resp.status()
        )));
    }

    let data: GlobalPlacesResponse = resp.json().await?;
    Ok(data)
}

#[tauri::command]
#[specta::specta]
pub async fn discover_asset_place_id(
    app: AppHandle,
    asset_id: String,
    cookie: String,
    forced_place_id: Option<String>,
) -> crate::error::Result<Option<String>> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err("Missing ROBLOSECURITY cookie".into());
    }

    let client = crate::utils::get_http_client();

    // 0. If a pinned forced_place_id is provided, test it first
    if let Some(ref pid) = forced_place_id {
        if !pid.is_empty() && pid != "1818" {
            let loc = crate::commands::spoofer::download::resolve_asset_id_location(
                &app,
                &client,
                &asset_id,
                &cookie_header,
                Some(pid),
            )
            .await
            .unwrap_or(None);

            if loc.is_some() {
                return Ok(Some(pid.clone()));
            }
        }
    }

    // 1. Try creator places & asset-to-universe
    let candidates = get_place_ids_for_asset_creator(
        app.clone(),
        asset_id.clone(),
        cookie.clone(),
        Some(20),
        None,
    )
    .await
    .unwrap_or_default();

    let client = crate::utils::get_http_client();
    for pid in &candidates {
        if pid.is_empty() || pid == "1818" {
            continue;
        }
        let loc = crate::commands::spoofer::download::resolve_asset_id_location(
            &app,
            &client,
            &asset_id,
            &cookie_header,
            Some(pid),
        )
        .await
        .unwrap_or(None);

        if loc.is_some() {
            return Ok(Some(pid.clone()));
        }
    }

    // 2. Try Asset Usage discovery
    let usage_pids = crate::commands::spoofer::download::attempt_asset_usage_place_id_discovery(
        &asset_id,
        &cookie_header,
    )
    .await;

    for pid in &usage_pids {
        if pid.is_empty() || pid == "1818" {
            continue;
        }
        let loc = crate::commands::spoofer::download::resolve_asset_id_location(
            &app,
            &client,
            &asset_id,
            &cookie_header,
            Some(pid),
        )
        .await
        .unwrap_or(None);

        if loc.is_some() {
            return Ok(Some(pid.clone()));
        }
    }

    // 3. Try Social Graph discovery
    let social_pids = crate::commands::spoofer::download::attempt_social_graph_place_id_discovery(
        &asset_id,
        &cookie_header,
    )
    .await;

    for pid in &social_pids {
        if pid.is_empty() || pid == "1818" {
            continue;
        }
        let loc = crate::commands::spoofer::download::resolve_asset_id_location(
            &app,
            &client,
            &asset_id,
            &cookie_header,
            Some(pid),
        )
        .await
        .unwrap_or(None);

        if loc.is_some() {
            return Ok(Some(pid.clone()));
        }
    }

    if let Some(first) = candidates.into_iter().find(|p| !p.is_empty() && p != "1818") {
        return Ok(Some(first));
    }

    Ok(None)
}
