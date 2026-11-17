use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use std::time::Instant;

static LOOSE_NUM_RE: OnceLock<Regex> = OnceLock::new();

#[inline]
fn loose_num_re() -> &'static Regex {
    LOOSE_NUM_RE.get_or_init(|| {
        Regex::new(r"(?ix)(?:rbxassetid://)?(\d{7,15})")
            .expect("LOOSE_NUM_RE pattern is a compile-time constant and must be valid")
    })
}

#[derive(Clone, Default, Serialize, Debug, specta::Type)]
pub struct AssetStore {
    #[specta(type = Vec<String>)]
    pub assets: Vec<Value>,
    pub scanning: bool,
    pub complete: bool,
    #[serde(skip)]
    pub timestamp: Option<Instant>,
}

impl AssetStore {
    #[must_use]
    pub fn completed() -> Self {
        Self { complete: true, timestamp: Some(Instant::now()), ..Default::default() }
    }
}

#[derive(Debug)]
pub struct AssetServerStateData {
    pub request_sounds: bool,
    pub request_animations: bool,
    pub request_images: bool,
    pub request_meshes: bool,
    pub request_script_refs: bool,
    pub last_sounds: AssetStore,
    pub last_animations: AssetStore,
    pub last_images: AssetStore,
    pub last_meshes: AssetStore,
    pub last_script_refs: AssetStore,
    pub stored_mappings: Vec<Value>,
    pub stored_patches: Vec<Value>,
    pub studio_records: std::sync::Arc<Vec<StudioRecord>>,
    pub pending_studio_records: std::sync::Arc<std::sync::Mutex<Vec<StudioRecord>>>,
    pub pending_record_bytes: usize,
    pub last_plugin_poll_time: Option<Instant>,
    pub skip_owned_check: bool,
    pub scan_status: Option<Value>,
    pub scan_id: Option<String>,
    pub received_scan_chunks: HashSet<u64>,
    pub scan_completion_in_progress: bool,
    pub last_scan_completion: Option<Value>,
    pub assets_revision: u64,
    pub scan_generation: u64,
    pub completed_scan_generation: u64,
    pub aborted_scan_generation: u64,
    pub studio_place_id: Option<String>,
    pub studio_place_name: Option<String>,
    pub keyframe_warning_count: usize,
    pub scan_records_truncated: bool,
    pub notify: std::sync::Arc<tokio::sync::Notify>,
    pub scan_types: Vec<String>,
    pub scan_path: Option<String>,
    pub batch_size: Option<u32>,
}

impl Default for AssetServerStateData {
    fn default() -> Self {
        Self {
            request_sounds: false,
            request_animations: false,
            request_images: false,
            request_meshes: false,
            request_script_refs: false,
            last_sounds: Default::default(),
            last_animations: Default::default(),
            last_images: Default::default(),
            last_meshes: Default::default(),
            last_script_refs: Default::default(),
            stored_mappings: Default::default(),
            stored_patches: Default::default(),
            studio_records: Default::default(),
            pending_studio_records: Default::default(),
            pending_record_bytes: 0,
            last_plugin_poll_time: None,
            skip_owned_check: false,
            scan_status: None,
            scan_id: None,
            received_scan_chunks: HashSet::new(),
            scan_completion_in_progress: false,
            last_scan_completion: None,
            assets_revision: 0,
            scan_generation: 0,
            completed_scan_generation: 0,
            aborted_scan_generation: 0,
            studio_place_id: None,
            studio_place_name: None,
            keyframe_warning_count: 0,
            scan_records_truncated: false,
            notify: std::sync::Arc::new(tokio::sync::Notify::new()),
            scan_types: vec![
                "sounds".into(),
                "animations".into(),
                "images".into(),
                "meshes".into(),
                "scripts".into(),
            ],
            scan_path: None,
            batch_size: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StudioRecord {
    pub token: String,
    pub class_name: String,
    pub name: String,
    pub full_name: String,
    pub property: String,
    pub value: String,
}

fn asset_id_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        #[allow(clippy::unwrap_used)]
        Regex::new(
            r#"^(?i)(?:(?:https?://(?:www\.)?)?roblox\.com/(?:asset/?\?[^"'\s&]*?id=|library/)|create\.roblox\.com/(?:marketplace/)?|rbxassetid://|rbxasset://|rbxthumb://[^/]*/?)?(\d+)$"#,
        ).expect("Invalid asset id regex")
    })
}

fn script_ref_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        #[allow(clippy::unwrap_used)]
        Regex::new(
            r#"(?ix)(?:(?:(?:https?://(?:www\.)?)?roblox\.com/asset/?\?[^"'\s&]*?id=|rbxassetid://|rbxthumb://[^/]*/?)|\.AnimationId\s*=\s*|\.SoundId\s*=\s*|\.MeshId\s*=\s*|\.TextureId\s*=\s*|\.TextureID\s*=\s*|\.Image\s*=\s*|anim[a-z_]*\s*[=:]\s*|sound[a-z_]*\s*[=:]\s*|audio[a-z_]*\s*[=:]\s*|music[a-z_]*\s*[=:]\s*|mesh[a-z_]*\s*[=:]\s*|assetid[a-z_]*\s*[=:]\s*|\["anim[a-z_]*"\]\s*=\s*|\["sound[a-z_]*"\]\s*=\s*|\["mesh[a-z_]*"\]\s*=\s*)(\d{7,15})"#,
        ).expect("Invalid script reference regex")
    })
}

fn script_rewrite_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        #[allow(clippy::unwrap_used)]
        Regex::new(r#"(?ix)((?:(?:https?://(?:www\.)?)?roblox\.com/asset/?\?[^"'\s&]*?id=|rbxassetid://|rbxthumb://[^/]*/?)|\.AnimationId\s*=\s*|\.SoundId\s*=\s*|\.MeshId\s*=\s*|\.TextureId\s*=\s*|\.TextureID\s*=\s*|\.Image\s*=\s*|anim[a-z_]*\s*[=:]\s*|sound[a-z_]*\s*[=:]\s*|audio[a-z_]*\s*[=:]\s*|music[a-z_]*\s*[=:]\s*|mesh[a-z_]*\s*[=:]\s*|assetid[a-z_]*\s*[=:]\s*|\["anim[a-z_]*"\]\s*=\s*|\["sound[a-z_]*"\]\s*=\s*|\["mesh[a-z_]*"\]\s*=\s*)?(\d{7,15})"#).expect("Invalid script rewrite regex")
    })
}

fn table_block_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        #[allow(clippy::unwrap_used)]
        Regex::new(r"(?ix)(?:(anim|sound|audio|music|mesh|texture|image|assetid)[a-zA-Z0-9_]*\s*(?:=|:)\s*\{)").expect("Invalid table block regex")
    })
}

fn rich_text_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        #[allow(clippy::unwrap_used)]
        Regex::new(r#"(?i)<image\s*=\s*["']?(?:rbxassetid://)?(\d{4,15})["']?\s*/?>"#)
            .expect("Invalid rich text regex")
    })
}

fn runtime_load_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        #[allow(clippy::unwrap_used)]
        Regex::new(
            r#"(?x)
            (?:
                (?:InsertService|game\.InsertService)\s*:\s*LoadAsset\s*\(\s*(\d{7,15})\s*\)
                |
                \brequire\s*\(\s*(\d{7,15})\s*\)
                |
                :\s*GetAsync\s*\(\s*["']?(\d{7,15})["']?\s*\)
                |
                DataStoreService\s*:\s*GetDataStore\s*\(\s*["'](\d{7,15})["']
            )"#,
        )
        .expect("Invalid runtime load regex")
    })
}

fn infer_category_from_property(property: &str) -> Option<&'static str> {
    match property {
        "AnimationId" | "AnimationContent" | "ClimbAnimation" | "FallAnimation"
        | "IdleAnimation" | "JumpAnimation" | "RunAnimation" | "SwimAnimation"
        | "WalkAnimation" | "MoodAnimation" => Some("animation"),
        "SoundId" | "AudioContent" | "Asset" => Some("sound"),
        "Video" => Some("image"),

        "MeshId" | "MeshContent" | "ReferenceMeshId" | "CageMeshId" => Some("mesh"),
        "TextureID" => Some("image"),
        "BackAccessory" | "FaceAccessory" | "FrontAccessory" | "HairAccessory" | "HatAccessory"
        | "NeckAccessory" | "ShouldersAccessory" | "WaistAccessory" | "Head" | "LeftArm"
        | "LeftLeg" | "RightArm" | "RightLeg" | "Torso" => Some("mesh"),
        "Texture" | "Image" | "HoverImage" | "PressedImage" | "CursorIcon" | "BaseTextureId"
        | "OverlayTextureId" | "ColorMap" | "MetalnessMap" | "NormalMap" | "RoughnessMap"
        | "ShirtTemplate" | "PantsTemplate" | "Graphic" | "SkyboxBk" | "SkyboxDn" | "SkyboxFt"
        | "SkyboxLf" | "SkyboxRt" | "SkyboxUp" | "SunTextureId" | "MoonTextureId" | "TextureId"
        | "Face" | "GraphicTShirt" | "Pants" | "Shirt" => Some("image"),
        prop if prop.ends_with("Animation") => Some("animation"),
        prop if prop.ends_with("Sound") => Some("sound"),
        prop if prop.ends_with("Accessory") => Some("mesh"),
        prop if prop.ends_with("Map") => Some("image"),
        prop if prop.ends_with("Image") || prop.ends_with("Texture") => Some("image"),
        prop if prop.ends_with("Template") => Some("image"),
        _ => None,
    }
}

fn infer_category_from_attribute_name(property: &str) -> &'static str {
    let lower = property.to_lowercase();
    if lower.contains("anim") {
        "animation"
    } else if lower.contains("sound") || lower.contains("audio") || lower.contains("music") {
        "sound"
    } else if lower.contains("mesh") {
        "mesh"
    } else if lower.contains("image")
        || lower.contains("texture")
        || lower.contains("video")
        || lower.contains("decal")
        || lower.contains("icon")
    {
        "image"
    } else {
        "unknown"
    }
}

fn has_explicit_asset_reference(source: &str, asset_id: &str) -> bool {
    source.contains(&format!("rbxassetid://{asset_id}"))
        || source.contains(&format!("rbxasset://{asset_id}"))
        || source.contains(&format!("id={asset_id}"))
        || source.contains(&format!("roblox.com/asset/?id={asset_id}"))
        || source.contains(&format!("roblox.com/library/{asset_id}"))
        || source.contains(&format!("create.roblox.com/marketplace/asset/{asset_id}"))
}

fn extract_rich_text_asset_ids(text: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for cap in rich_text_pattern().captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let id = m.as_str();
            if !is_blocked_asset_id(id) {
                ids.push(id.to_string());
            }
        }
    }
    ids
}

fn walk_json_for_asset_ids(value: &Value, out: &mut Vec<String>, depth: u8) {
    if depth > 8 {
        return;
    }
    match value {
        Value::String(s) => {
            if let Some(id) = normalize_asset_id(s) {
                out.push(id.to_string());
            }

            if s.len() > 50 {
                if let Ok(nested) = serde_json::from_str::<Value>(s) {
                    walk_json_for_asset_ids(&nested, out, depth + 1);
                }
            }
        }
        Value::Number(n) => {
            if let Some(id_num) = n.as_u64() {
                let s = id_num.to_string();
                if s.len() >= 7 && s.len() <= 15 {
                    out.push(s);
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                walk_json_for_asset_ids(item, out, depth + 1);
            }
        }
        Value::Object(map) => {
            for v in map.values() {
                walk_json_for_asset_ids(v, out, depth + 1);
            }
        }
        _ => {}
    }
}

fn deep_scan_string(value: &str) -> Vec<String> {
    if value.len() < 20 {
        return vec![];
    }

    let mut found = Vec::new();

    if let Ok(parsed) = serde_json::from_str::<Value>(value) {
        walk_json_for_asset_ids(&parsed, &mut found, 0);

        if !found.is_empty() {
            return found;
        }
    }

    let trimmed = value.trim();

    let looks_base64 = trimmed.len() >= 8
        && trimmed.chars().all(|c| {
            c.is_alphanumeric() || c == '+' || c == '/' || c == '=' || c == '-' || c == '_'
        });

    if looks_base64 {
        let decoded = B64
            .decode(trimmed)
            .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(trimmed));
        if let Ok(bytes) = decoded {
            if let Ok(text) = std::str::from_utf8(&bytes) {
                if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                    walk_json_for_asset_ids(&parsed, &mut found, 0);
                }
            }
        }
    }

    found
}

fn infer_category_from_line(line: &str) -> Option<&'static str> {
    let lower = line.to_lowercase();
    if lower.contains("anim") {
        return Some("animation");
    }
    if lower.contains("sound") || lower.contains("audio") || lower.contains("music") {
        return Some("sound");
    }
    if lower.contains("mesh") {
        return Some("mesh");
    }
    if lower.contains("texture") || lower.contains("image") {
        return Some("image");
    }
    None
}

fn is_blocked_asset_id(id: &str) -> bool {
    id == "0" || id == "016666666666666" || id == "16666666666666"
}

fn extract_table_block_ids_with_context(
    source: &str,
) -> Vec<(String, Option<&'static str>, Option<String>)> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    for captures in table_block_pattern().captures_iter(source) {
        let Some(match_whole) = captures.get(0) else {
            continue;
        };
        let Some(keyword_match) = captures.get(1) else {
            continue;
        };
        let keyword = keyword_match.as_str().to_lowercase();

        let hint = if keyword.contains("anim") {
            Some("animation")
        } else if keyword.contains("sound")
            || keyword.contains("audio")
            || keyword.contains("music")
        {
            Some("sound")
        } else if keyword.contains("mesh") {
            Some("mesh")
        } else if keyword.contains("texture") || keyword.contains("image") {
            Some("image")
        } else {
            None
        };

        let mut depth = 1;
        let mut block_end = match_whole.end();
        let bytes = source.as_bytes();
        let max_scan = block_end + 20_000;
        let mut in_string = false;
        let mut string_char = 0;
        let mut escape = false;

        while block_end < bytes.len() && depth > 0 && block_end < max_scan {
            let ch = bytes[block_end];
            if in_string {
                if escape {
                    escape = false;
                } else if ch == b'\\' {
                    escape = true;
                } else if ch == string_char {
                    in_string = false;
                }
            } else if ch == b'"' || ch == b'\'' || ch == b'`' {
                in_string = true;
                string_char = ch;
            } else if ch == b'{' {
                depth += 1;
            } else if ch == b'}' {
                depth -= 1;
            }
            block_end += 1;
        }

        if depth == 0 {
            let end_idx = block_end - 1;
            if source.is_char_boundary(end_idx) {
                let block_text = &source[match_whole.end()..end_idx];

                for id_cap in loose_num_re().captures_iter(block_text) {
                    if let Some(asset_id) = id_cap.get(1) {
                        if !is_blocked_asset_id(asset_id.as_str())
                            && seen.insert(asset_id.as_str().to_string())
                        {
                            let Some(full_match) = id_cap.get(0) else { continue };
                            let id_start = match_whole.end() + full_match.start();
                            let line = find_line_containing(source, id_start);
                            let var_name = extract_variable_name(line);
                            results.push((asset_id.as_str().to_string(), hint, var_name));
                        }
                    }
                }
            }
        }
    }
    results
}

fn find_line_containing(source: &str, index: usize) -> &str {
    let bytes = source.as_bytes();

    let mut start = index;
    while start > 0 && bytes[start - 1] != b'\n' {
        start -= 1;
    }

    let mut end = index;
    while end < source.len() && bytes[end] != b'\n' && bytes[end] != b'\r' {
        end += 1;
    }

    while start > 0 && !source.is_char_boundary(start) {
        start -= 1;
    }
    while end < source.len() && !source.is_char_boundary(end) {
        end += 1;
    }
    &source[start..end]
}

fn is_repeating_digits(s: &str) -> bool {
    let mut chars = s.chars();
    if let Some(first) = chars.next() {
        chars.all(|c| c == first)
    } else {
        false
    }
}

fn extract_variable_name(line: &str) -> Option<String> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        #[allow(clippy::unwrap_used)]
        Regex::new(r#"(?i)([a-zA-Z0-9_]+)\s*[:=]\s*(?:(?:(?:https?://(?:www\.)?)?roblox\.com/asset/?\?[^"'\s&]*?id=|rbxassetid://|rbxthumb://[^/]*/?)|['"]?)?\d{7,15}"#).expect("Invalid var name regex")
    });
    if let Some(caps) = re.captures(line) {
        if let Some(mat) = caps.get(1) {
            return Some(mat.as_str().to_string());
        }
    }
    None
}

fn extract_script_asset_ids_with_context(
    source: &str,
) -> Vec<(String, Option<&'static str>, Option<String>)> {
    let pattern = script_ref_pattern();
    let mut seen: HashSet<String> = HashSet::new();
    let mut results = Vec::new();

    for captures in pattern.captures_iter(source) {
        let Some(mat) = captures.get(1) else {
            continue;
        };
        let asset_id = mat.as_str();
        if is_blocked_asset_id(asset_id) {
            continue;
        }

        let start = mat.start();
        let line = find_line_containing(source, start);
        let mut hint = infer_category_from_line(line);
        let var_name = extract_variable_name(line);

        if hint.is_none() {
            let mut context_start = start.saturating_sub(160);
            while context_start > 0 && !source.is_char_boundary(context_start) {
                context_start -= 1;
            }
            let mut context_end = (start + 160).min(source.len());
            while context_end < source.len() && !source.is_char_boundary(context_end) {
                context_end += 1;
            }
            let context = &source[context_start..context_end];
            hint = infer_category_from_line(context);
        }

        if seen.insert(asset_id.to_string()) {
            results.push((asset_id.to_string(), hint, var_name));
        }
    }

    results
}

#[derive(Debug)]
struct RuntimeLoadRef {
    asset_id: String,
    call_type: &'static str,
}

fn extract_runtime_load_ids(source: &str) -> Vec<RuntimeLoadRef> {
    let pattern = runtime_load_pattern();
    let mut seen: HashSet<String> = HashSet::new();
    let mut results = Vec::new();

    for cap in pattern.captures_iter(source) {
        let (id, call_type) = if let Some(m) = cap.get(1) {
            (m.as_str(), "LoadAsset")
        } else if let Some(m) = cap.get(2) {
            (m.as_str(), "Require")
        } else if let Some(m) = cap.get(3) {
            (m.as_str(), "GetAsync")
        } else if let Some(m) = cap.get(4) {
            (m.as_str(), "DataStore")
        } else {
            continue;
        };

        if !is_blocked_asset_id(id) && seen.insert(id.to_string()) {
            results.push(RuntimeLoadRef { asset_id: id.to_string(), call_type });
        }
    }

    results
}

#[must_use]
pub fn analyze_records(
    records: &[StudioRecord],
) -> (AssetStore, AssetStore, AssetStore, AssetStore, AssetStore) {
    let mut animations = AssetStore::completed();
    let mut sounds = AssetStore::completed();
    let mut images = AssetStore::completed();
    let mut meshes = AssetStore::completed();
    let mut script_refs = AssetStore::completed();
    let mut seen: HashSet<(String, String, String)> = HashSet::new();
    let mut seen_instance_tokens: HashSet<(String, String, String)> = HashSet::new();

    let mut category_id_indices: HashMap<(&'static str, String, String), usize> = HashMap::new();

    for record in records {
        if record.property == "KeyframeSequence" {
            if seen.insert(("kf".into(), record.token.clone(), record.full_name.clone())) {
                script_refs.assets.push(json!({
                    "kind": "UnuploadedAnimation",
                    "script": record.full_name,
                    "scriptType": record.class_name,
                    "assetId": null,
                    "rawUrl": null,
                    "resolvedType": "unuploaded",
                    "warning": "This animation has not been uploaded to Roblox yet and cannot be spoofed."
                }));
            }
            continue;
        }

        let is_script =
            matches!(record.class_name.as_str(), "Script" | "LocalScript" | "ModuleScript")
                && record.property == "Source";

        if is_script
            || matches!(record.property.as_str(), "__Tags__" | "__Emotes__" | "__Accessories__")
        {
            if is_script {
                for rt in extract_runtime_load_ids(&record.value) {
                    let key = ("runtime".to_string(), record.token.clone(), rt.asset_id.clone());
                    if seen.insert(key) {
                        script_refs.assets.push(json!({
                            "kind": "RuntimeLoad",
                            "script": record.full_name,
                            "scriptType": record.class_name,
                            "assetId": rt.asset_id,
                            "rawUrl": format!("rbxassetid://{}", rt.asset_id),
                            "resolvedType": "unknown",
                            "callType": rt.call_type
                        }));
                    }
                }
            }

            let all_extracted = if is_script {
                let mut table_extracted = extract_table_block_ids_with_context(&record.value);
                let line_extracted = extract_script_asset_ids_with_context(&record.value);
                let mut block_seen: HashSet<String> =
                    table_extracted.iter().map(|(id, _, _)| id.clone()).collect();
                for (id, hint, var_name) in line_extracted {
                    if block_seen.insert(id.clone()) {
                        table_extracted.push((id, hint, var_name));
                    }
                }
                table_extracted
            } else if record.property == "__Emotes__" {
                extract_script_asset_ids(&record.value)
                    .into_iter()
                    .map(|id| (id.clone(), Some("animation"), None))
                    .collect()
            } else if record.property == "__Accessories__" {
                extract_script_asset_ids(&record.value)
                    .into_iter()
                    .map(|id| (id.clone(), Some("mesh"), None))
                    .collect()
            } else {
                extract_script_asset_ids(&record.value)
                    .into_iter()
                    .map(|id| (id.clone(), None, None))
                    .collect()
            };

            for (asset_id, hint, var_name) in all_extracted {
                match hint {
                    Some("animation") => {
                        use std::collections::hash_map::Entry;
                        match category_id_indices.entry((
                            "animation",
                            record.token.clone(),
                            asset_id.clone(),
                        )) {
                            Entry::Vacant(e) => {
                                e.insert(animations.assets.len());
                                animations.assets.push(json!({
                                    "kind": record.class_name,
                                    "name": var_name.clone().unwrap_or_else(|| record.name.clone()),
                                    "fullName": record.full_name,
                                    "property": record.property,
                                    "assetId": asset_id,
                                    "instanceCount": 1,
                                    "sourceHint": "animation"
                                }));
                            }
                            Entry::Occupied(e) => {
                                if let Some(existing) = animations.assets.get_mut(*e.get()) {
                                    existing["instanceCount"] =
                                        json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                                }
                            }
                        }
                        continue;
                    }
                    Some("sound") => {
                        use std::collections::hash_map::Entry;
                        match category_id_indices.entry((
                            "sound",
                            record.token.clone(),
                            asset_id.clone(),
                        )) {
                            Entry::Vacant(e) => {
                                e.insert(sounds.assets.len());
                                sounds.assets.push(json!({
                                    "kind": record.class_name,
                                    "name": var_name.clone().unwrap_or_else(|| record.name.clone()),
                                    "fullName": record.full_name,
                                    "property": record.property,
                                    "assetId": asset_id,
                                    "instanceCount": 1,
                                    "sourceHint": "sound"
                                }));
                            }
                            Entry::Occupied(e) => {
                                if let Some(existing) = sounds.assets.get_mut(*e.get()) {
                                    existing["instanceCount"] =
                                        json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                                }
                            }
                        }
                        continue;
                    }
                    Some("image") => {
                        use std::collections::hash_map::Entry;
                        match category_id_indices.entry((
                            "image",
                            record.token.clone(),
                            asset_id.clone(),
                        )) {
                            Entry::Vacant(e) => {
                                e.insert(images.assets.len());
                                images.assets.push(json!({
                                    "kind": record.class_name,
                                    "name": var_name.clone().unwrap_or_else(|| record.name.clone()),
                                    "fullName": record.full_name,
                                    "property": record.property,
                                    "assetId": asset_id,
                                    "instanceCount": 1,
                                    "sourceHint": "image"
                                }));
                            }
                            Entry::Occupied(e) => {
                                if let Some(existing) = images.assets.get_mut(*e.get()) {
                                    existing["instanceCount"] =
                                        json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                                }
                            }
                        }
                        continue;
                    }
                    Some("mesh") => {
                        use std::collections::hash_map::Entry;
                        match category_id_indices.entry((
                            "mesh",
                            record.token.clone(),
                            asset_id.clone(),
                        )) {
                            Entry::Vacant(e) => {
                                e.insert(meshes.assets.len());
                                meshes.assets.push(json!({
                                    "kind": record.class_name,
                                    "name": var_name.clone().unwrap_or_else(|| record.name.clone()),
                                    "fullName": record.full_name,
                                    "property": record.property,
                                    "assetId": asset_id,
                                    "instanceCount": 1,
                                    "sourceHint": "mesh"
                                }));
                            }
                            Entry::Occupied(e) => {
                                if let Some(existing) = meshes.assets.get_mut(*e.get()) {
                                    existing["instanceCount"] =
                                        json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                                }
                            }
                        }
                        continue;
                    }
                    _ => {}
                }

                if has_explicit_asset_reference(&record.value, &asset_id)
                    && seen.insert(("script".to_string(), record.token.clone(), asset_id.clone()))
                {
                    script_refs.assets.push(json!({
                        "kind": "ScriptReference",
                        "script": record.full_name,
                        "scriptType": record.class_name,
                        "assetId": asset_id,
                        "rawUrl": format!("rbxassetid://{asset_id}"),
                        "resolvedType": "unknown"
                    }));
                }
            }
            continue;
        }

        if !record.value.is_empty()
            && record.property != "Source"
            && !matches!(record.property.as_str(), "__Tags__" | "__Emotes__" | "__Accessories__")
        {
            for asset_id in extract_rich_text_asset_ids(&record.value) {
                if seen.insert(("richtext".to_string(), record.token.clone(), asset_id.clone())) {
                    images.assets.push(json!({
                        "kind": record.class_name,
                        "name": record.name.clone(),
                        "fullName": record.full_name,
                        "property": record.property,
                        "assetId": asset_id,
                        "instanceCount": 1,
                        "sourceHint": "richtext"
                    }));
                }
            }

            for asset_id in extract_script_asset_ids(&record.value) {
                if let Some(category) = infer_category_from_property(&record.property) {
                    use std::collections::hash_map::Entry;
                    match category_id_indices.entry((
                        category,
                        record.token.clone(),
                        asset_id.clone(),
                    )) {
                        Entry::Vacant(e) => {
                            let store = match category {
                                "animation" => &mut animations,
                                "sound" => &mut sounds,
                                "image" => &mut images,
                                "mesh" => &mut meshes,
                                _ => continue,
                            };
                            e.insert(store.assets.len());
                            store.assets.push(json!({
                                "kind": record.class_name,
                                "name": record.name.clone(),
                                "fullName": record.full_name,
                                "property": record.property,
                                "assetId": asset_id,
                                "instanceCount": 1,
                                "sourceHint": "embedded"
                            }));
                        }
                        Entry::Occupied(e) => {
                            let store = match category {
                                "animation" => &mut animations,
                                "sound" => &mut sounds,
                                "image" => &mut images,
                                "mesh" => &mut meshes,
                                _ => continue,
                            };
                            if let Some(existing) = store.assets.get_mut(*e.get()) {
                                existing["instanceCount"] =
                                    json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                            }
                        }
                    }
                }
            }
        }

        if record.value.len() >= 20
            && record.property != "Source"
            && !matches!(record.property.as_str(), "__Tags__" | "__Emotes__" | "__Accessories__")
        {
            for asset_id in deep_scan_string(&record.value) {
                let category = infer_category_from_property(&record.property)
                    .or_else(|| {
                        if record.property.starts_with("__Attribute__:") {
                            Some(infer_category_from_attribute_name(
                                &record.property["__Attribute__:".len()..],
                            ))
                        } else {
                            None
                        }
                    })
                    .filter(|cat| *cat != "unknown");

                if let Some(category) = category {
                    use std::collections::hash_map::Entry;
                    match category_id_indices.entry((
                        category,
                        record.token.clone(),
                        asset_id.clone(),
                    )) {
                        Entry::Vacant(e) => {
                            let store = match category {
                                "animation" => &mut animations,
                                "sound" => &mut sounds,
                                "image" => &mut images,
                                "mesh" => &mut meshes,
                                _ => continue,
                            };
                            e.insert(store.assets.len());
                            store.assets.push(json!({
                                "kind": record.class_name,
                                "name": record.name.clone(),
                                "fullName": record.full_name,
                                "property": record.property,
                                "assetId": asset_id,
                                "instanceCount": 1,
                                "sourceHint": "deepscan"
                            }));
                        }
                        Entry::Occupied(e) => {
                            let store = match category {
                                "animation" => &mut animations,
                                "sound" => &mut sounds,
                                "image" => &mut images,
                                "mesh" => &mut meshes,
                                _ => continue,
                            };
                            if let Some(existing) = store.assets.get_mut(*e.get()) {
                                existing["instanceCount"] =
                                    json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                            }
                        }
                    }
                    continue;
                }

                if seen.insert(("deepscan".to_string(), record.token.clone(), asset_id.clone())) {
                    script_refs.assets.push(json!({
                        "kind": "DeepScan",
                        "script": record.full_name,
                        "scriptType": record.class_name,
                        "assetId": asset_id,
                        "rawUrl": format!("rbxassetid://{asset_id}"),
                        "resolvedType": "unknown"
                    }));
                }
            }
        }

        let Some(asset_id) = normalize_asset_id(&record.value) else {
            continue;
        };
        let category = if record.property.starts_with("__Attribute__:") {
            infer_category_from_attribute_name(&record.property["__Attribute__:".len()..])
        } else if record.property == "Value" {
            let lower = record.name.to_lowercase();
            if lower.contains("anim") {
                "animation"
            } else if lower.contains("sound") || lower.contains("audio") || lower.contains("music")
            {
                "sound"
            } else if lower.contains("mesh") {
                "mesh"
            } else if lower.contains("image")
                || lower.contains("texture")
                || lower.contains("video")
            {
                "image"
            } else {
                "unknown"
            }
        } else {
            infer_category_from_property(&record.property).unwrap_or("unknown")
        };
        if category.is_empty() {
            continue;
        }

        if category == "unknown" {
            if has_explicit_asset_reference(&record.value, asset_id)
                && seen.insert(("script".to_string(), record.token.clone(), asset_id.to_string()))
            {
                script_refs.assets.push(json!({
                    "kind": "ScriptReference",
                    "script": record.full_name,
                    "scriptType": record.class_name,
                    "assetId": asset_id,
                    "rawUrl": format!("rbxassetid://{asset_id}"),
                    "resolvedType": "unknown"
                }));
            }
            continue;
        }

        if !seen.insert((category.to_string(), record.token.clone(), asset_id.to_string())) {
            let store = match category {
                "animation" => &mut animations,
                "sound" => &mut sounds,
                "image" => &mut images,
                "mesh" => &mut meshes,
                _ => continue,
            };
            if let Some(last) = store.assets.iter_mut().find(|a| a["assetId"] == asset_id) {
                if seen_instance_tokens.insert((
                    category.to_string(),
                    asset_id.to_string(),
                    record.token.clone(),
                )) {
                    last["instanceCount"] = json!(last["instanceCount"].as_u64().unwrap_or(1) + 1);
                }
            }
            continue;
        }
        seen_instance_tokens.insert((
            category.to_string(),
            asset_id.to_string(),
            record.token.clone(),
        ));
        let asset = json!({
            "kind": record.class_name,
            "name": record.name.clone(),
            "fullName": record.full_name,
            "property": record.property,
            "assetId": asset_id,
            "instanceCount": 1
        });
        match category {
            "animation" => animations.assets.push(asset),
            "sound" => sounds.assets.push(asset),
            "image" => images.assets.push(asset),
            "mesh" => meshes.assets.push(asset),
            _ => {}
        }
    }

    (animations, sounds, images, meshes, script_refs)
}

fn path_matches_target(target: &str, record_full_name: &str) -> bool {
    let t = target.trim();
    let r = record_full_name.trim();
    if t == r {
        return true;
    }
    let norm_target = t.replace('/', ".");
    let norm_record = r.replace('/', ".");
    if norm_target == norm_record {
        return true;
    }
    let t_clean = norm_target.trim_start_matches("game.");
    let r_clean = norm_record.trim_start_matches("game.");
    if t_clean == r_clean {
        return true;
    }
    if !t_clean.is_empty()
        && !r_clean.is_empty()
        && (t_clean.ends_with(r_clean) || r_clean.ends_with(t_clean))
    {
        return true;
    }
    false
}

#[must_use]
pub fn plan_patches(records: &[StudioRecord], mappings: &[Value]) -> Vec<Value> {
    let mapping_map: HashMap<&str, &str> = mappings
        .iter()
        .filter_map(|mapping| {
            Some((mapping.get("originalId")?.as_str()?, mapping.get("newId")?.as_str()?))
        })
        .collect();

    let mapping_targets: HashMap<&str, Vec<&str>> = mappings
        .iter()
        .filter_map(|mapping| {
            let orig = mapping.get("originalId")?.as_str()?;
            let targets = mapping
                .get("targetPaths")
                .and_then(|t| t.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
                .unwrap_or_default();
            Some((orig, targets))
        })
        .collect();

    let is_path_allowed = |asset_id: &str, record_full_name: &str| -> bool {
        match mapping_targets.get(asset_id) {
            Some(targets) if !targets.is_empty() => {
                targets.iter().any(|target| path_matches_target(target, record_full_name))
            }
            _ => true,
        }
    };

    let mut patches = Vec::new();
    let mut mesh_patches: HashMap<String, Value> = HashMap::new();

    let bounded_re_cache: HashMap<&str, Regex> = mapping_map
        .keys()
        .filter_map(|id| {
            let pattern = format!(r"(?<![0-9]){}(?![0-9])", regex::escape(id));
            #[allow(clippy::unwrap_used)]
            Regex::new(&pattern).ok().map(|re| (*id, re))
        })
        .collect();

    for record in records {
        if matches!(
            record.property.as_str(),
            "Source" | "__Tags__" | "__Emotes__" | "__Accessories__"
        ) {
            let filtered_mappings: HashMap<&str, &str> = mapping_map
                .iter()
                .filter(|(orig, _)| is_path_allowed(orig, &record.full_name))
                .map(|(k, v)| (*k, *v))
                .collect();
            if filtered_mappings.is_empty() {
                continue;
            }
            let rewritten = replace_script_asset_ids(&record.value, &filtered_mappings);
            if let std::borrow::Cow::Owned(rewritten) = rewritten {
                let action = match record.property.as_str() {
                    "Source" => "replaceScriptSource",
                    "__Tags__" => "replaceTags",
                    "__Emotes__" => "replaceEmotes",
                    "__Accessories__" => "replaceAccessories",
                    _ => unreachable!(),
                };
                patches.push(json!({
                    "action": action,
                    "token": record.token,
                    "fullName": record.full_name,
                    "value": rewritten
                }));
            }
            continue;
        }

        let Some(asset_id) = normalize_asset_id(&record.value) else {
            continue;
        };
        let Some(new_id) = mapping_map.get(&asset_id) else {
            continue;
        };

        if !is_path_allowed(asset_id, &record.full_name) {
            continue;
        }

        if record.class_name == "MeshPart"
            && matches!(record.property.as_str(), "MeshId" | "MeshContent" | "TextureID")
        {
            let patch = mesh_patches.entry(record.token.clone()).or_insert_with(|| {
                json!({
                    "action": "replaceMeshPart",
                    "token": record.token,
                    "fullName": record.full_name
                })
            });
            patch[if record.property == "TextureID" { "textureId" } else { "meshId" }] =
                Value::String((*new_id).to_string());
            continue;
        }

        let do_bounded_replace = |value: &str| -> String {
            bounded_re_cache
                .get(asset_id)
                .map(|re| re.replace_all(value, *new_id).into_owned())
                .unwrap_or_else(|| value.replace(asset_id, new_id))
        };

        if record.property.starts_with("__Attribute__:") {
            let attr_name = &record.property["__Attribute__:".len()..];
            let replaced_str = do_bounded_replace(&record.value);
            let replaced_val = if replaced_str.chars().all(|c| c.is_ascii_digit()) {
                #[allow(clippy::unwrap_used)]
                Value::Number(replaced_str.parse::<u64>().unwrap_or(0).into())
            } else {
                Value::String(replaced_str)
            };
            patches.push(json!({
                "action": "replaceAttribute",
                "token": record.token,
                "fullName": record.full_name,
                "property": attr_name,
                "value": replaced_val
            }));
            continue;
        }

        patches.push(json!({
            "action": "setProperty",
            "token": record.token,
            "fullName": record.full_name,
            "property": record.property,
            "value": do_bounded_replace(&record.value)
        }));
    }

    patches.extend(mesh_patches.into_values());
    patches.truncate(100_000);
    patches
}

fn normalize_asset_id(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() || is_blocked_asset_id(trimmed) {
        return None;
    }

    if let Some(captures) = asset_id_pattern().captures(trimmed) {
        if let Some(asset_id) = captures.get(1) {
            let id = asset_id.as_str();
            if !is_blocked_asset_id(id) && !id.is_empty() {
                return Some(id);
            }
        }
    }

    let captures = script_ref_pattern().captures(trimmed)?;
    let asset_id = captures.get(1)?.as_str();
    (!is_blocked_asset_id(asset_id)).then_some(asset_id)
}

fn extract_script_asset_ids(source: &str) -> Vec<String> {
    struct AstExtractor {
        ids: HashSet<String>,
    }

    impl full_moon::visitors::Visitor for AstExtractor {
        fn visit_string_literal(&mut self, token: &full_moon::tokenizer::Token) {
            let text = token.to_string();
            let pattern = script_ref_pattern();
            for captures in pattern.captures_iter(&text) {
                if let Some(asset_id) = captures.get(1) {
                    if !is_blocked_asset_id(asset_id.as_str()) {
                        self.ids.insert(asset_id.as_str().to_string());
                    }
                }
            }
        }

        fn visit_number(&mut self, token: &full_moon::tokenizer::Token) {
            let text = token.to_string();
            if text.len() >= 7
                && text.chars().all(|c| c.is_ascii_digit())
                && !is_repeating_digits(&text)
                && !is_blocked_asset_id(&text)
            {
                self.ids.insert(text);
            }
        }
    }

    if let Ok(ast) = full_moon::parse(source) {
        let mut extractor = AstExtractor { ids: HashSet::new() };
        full_moon::visitors::Visitor::visit_ast(&mut extractor, &ast);
        return extractor.ids.into_iter().collect();
    }

    let pattern = script_ref_pattern();
    let mut ids = HashSet::new();
    for captures in pattern.captures_iter(source) {
        if let Some(asset_id) = captures.get(1) {
            if !is_blocked_asset_id(asset_id.as_str()) {
                ids.insert(asset_id.as_str().to_string());
            }
        }
    }
    ids.into_iter().collect()
}

fn replace_script_asset_ids<'a>(
    source: &'a str,
    mappings: &HashMap<&str, &str>,
) -> std::borrow::Cow<'a, str> {
    script_rewrite_pattern().replace_all(source, |captures: &Captures<'_>| {
        let prefix = captures.get(1).map_or("", |item| item.as_str());
        let asset_id = captures.get(2).map_or("", |item| item.as_str());
        mappings
            .get(asset_id)
            .map_or_else(|| captures[0].to_string(), |new_id| format!("{prefix}{new_id}"))
    })
}

#[must_use]
pub fn count_keyframe_warnings(script_refs: &AssetStore) -> usize {
    script_refs.assets.iter().filter(|a| a["kind"] == "UnuploadedAnimation").count()
}
