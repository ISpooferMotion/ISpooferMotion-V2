//! Heuristic parsing for asset references inside Studio inputs.
//!
//! Because Roblox Studio cannot reliably report asset IDs deeply embedded in script
//! source code, rich text, or JSON strings, this module contains regex patterns and
//! recursive string scanners to extract, classify, and validate them.
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use std::time::Instant;

/// Compiled once at first use; matches bare asset IDs inside Luau table blocks.
static LOOSE_NUM_RE: OnceLock<Regex> = OnceLock::new();

#[inline]
fn loose_num_re() -> &'static Regex {
    LOOSE_NUM_RE.get_or_init(|| {
        Regex::new(r"(?ix)(?:rbxassetid://)?(\d{7,15})")
            .expect("LOOSE_NUM_RE pattern is a compile-time constant and must be valid")
    })
}

/// Stores extracted assets for a specific category (e.g., Sounds, Meshes).
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

/// The central state container for the Studio bridge daemon.
///
/// Keeps track of what the frontend has requested, the latest scan results,
/// and pending patches waiting for the plugin to poll them.
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
    pub last_plugin_poll_time: Option<Instant>,
    pub skip_owned_check: bool,
    pub scan_status: Option<Value>,
    pub studio_place_id: Option<String>,
    pub studio_place_name: Option<String>,
    pub theme_accent: Option<String>,
    pub keyframe_warning_count: usize,
    pub scan_records_truncated: bool,
    pub notify: std::sync::Arc<tokio::sync::Notify>,
    pub scan_types: Vec<String>,
    pub script_scan_mode: String,
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
            last_plugin_poll_time: None,
            skip_owned_check: false,
            scan_status: None,
            studio_place_id: None,
            studio_place_name: None,
            theme_accent: None,
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
            script_scan_mode: "assetIds".into(),
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

/// Returns a regex that matches valid Roblox asset URLs or raw numerical IDs.
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

/// Returns a regex that captures runtime asset loads via `require`, `InsertService`, etc.
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
        // AnimationContent is the newer Content-typed alias for AnimationId --
        // Roblox's runtime reads whichever is set, so we scan and categorize
        // both.
        "AnimationId" | "AnimationContent" | "ClimbAnimation" | "FallAnimation"
        | "IdleAnimation" | "JumpAnimation" | "RunAnimation" | "SwimAnimation"
        | "WalkAnimation" | "MoodAnimation" => Some("animation"),
        "SoundId" | "AudioContent" | "Asset" => Some("sound"),
        "Video" => Some("image"),
        // MeshPart.TextureID (all-caps ID) is a *texture* asset, not a mesh.
        // Keeping it in the mesh category pushes image IDs into the mesh bucket
        // and shows up to the user as "I asked for meshes and got images".
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
        // Deliberately no `contains("id")` fallback here -- it swept any
        // attribute with "Id" in the name (PlayerId, BadgeId, MatchId, etc.)
        // into the image bucket regardless of what asset type the value
        // actually pointed at.
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

                // Inside a table block, any bare number is highly likely an asset ID.
                for id_cap in loose_num_re().captures_iter(block_text) {
                    if let Some(asset_id) = id_cap.get(1) {
                        if !is_blocked_asset_id(asset_id.as_str())
                            && seen.insert(asset_id.as_str().to_string())
                        {
                            let Some(full_match) = id_cap.get(0) else { continue };
                            let id_start = match_whole.start() + full_match.start();
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
    // Walk back to the start of this line.
    let mut start = index;
    while start > 0 && bytes[start - 1] != b'\n' {
        start -= 1;
    }
    // Walk forward to the end of this line.
    let mut end = index;
    while end < source.len() && bytes[end] != b'\n' && bytes[end] != b'\r' {
        end += 1;
    }
    // Ensure the slice boundaries are on valid UTF-8 char boundaries.
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

        // Plugin-side extraction (asset-IDs scan mode): the plugin found asset IDs
        // in the script locally and sent them as a JSON array instead of shipping
        // the full source. Build script_refs directly from them. Less context than
        // the full-source AST path, but a fraction of the payload for large scripts.
        if record.property == "SourceIds"
            && matches!(record.class_name.as_str(), "Script" | "LocalScript" | "ModuleScript")
        {
            if let Ok(ids) = serde_json::from_str::<Vec<String>>(&record.value) {
                for asset_id in ids {
                    if seen.insert(("script".to_string(), record.token.clone(), asset_id.clone())) {
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
                // See `infer_category_from_attribute_name`: `contains("id")`
                // used to live here as a fallback and mis-bucketed every
                // Value named "SomethingId" into images.
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

    // Pre-compile bounded-replace regexes once per unique asset ID to avoid
    // O(n * records) regex compilations inside the per-record loop.
    let bounded_re_cache: HashMap<&str, Regex> = mapping_map
        .keys()
        .filter_map(|id| {
            let pattern = format!(r"(?<![0-9]){}(?![0-9])", regex::escape(id));
            #[allow(clippy::unwrap_used)]
            Regex::new(&pattern).ok().map(|re| (*id, re))
        })
        .collect();

    for record in records {
        // asset-IDs scan mode: the record carries a JSON array of IDs, not a
        // source. Send back an old->new mapping (a JSON object); the plugin re-reads
        // the source and applies it locally. This avoids shipping the full source
        // both ways for large scripts.
        if record.property == "SourceIds"
            && matches!(record.class_name.as_str(), "Script" | "LocalScript" | "ModuleScript")
        {
            if let Ok(ids) = serde_json::from_str::<Vec<String>>(&record.value) {
                let mut mapping = serde_json::Map::new();
                for id in ids {
                    if is_path_allowed(id.as_str(), &record.full_name) {
                        if let Some(new_id) = mapping_map.get(id.as_str()) {
                            mapping.insert(id, json!(*new_id));
                        }
                    }
                }
                if !mapping.is_empty() {
                    patches.push(json!({
                        "action": "replaceScriptSource",
                        "token": record.token,
                        "fullName": record.full_name,
                        "value": mapping
                    }));
                }
            }
            continue;
        }

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

        // Use the pre-compiled bounded regex to avoid substring corruption.
        // Falls back to plain replace if the regex was not built (should not happen).
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

    // Fallback to regex if AST parsing fails.
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
    // Regex fallback is preferred over full_moon AST parsing to avoid stack overflows from deeply nested scripts.
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

#[cfg(test)]
mod tests {
    use super::*;

    fn record(property: &str, value: &str) -> StudioRecord {
        StudioRecord {
            token: "1".into(),
            class_name: "Animation".into(),
            name: "Example".into(),
            full_name: "Workspace.Example".into(),
            property: property.into(),
            value: value.into(),
        }
    }

    #[test]
    fn extracts_supported_content_ids() {
        assert_eq!(normalize_asset_id("rbxassetid://12345"), Some("12345"));
        assert_eq!(normalize_asset_id("0"), None);
    }

    #[test]
    fn extracts_all_long_numbers_as_script_ids() {
        let mut ids = extract_script_asset_ids("local count = 12345678\nlocal soundId = 87654321");
        ids.sort();
        assert_eq!(ids, vec!["12345678".to_string(), "87654321".to_string()]);
    }

    #[test]
    fn ignores_unhinted_script_numbers() {
        let records = vec![StudioRecord {
            token: "6".into(),
            class_name: "Script".into(),
            name: "Script".into(),
            full_name: "Workspace.Script".into(),
            property: "Source".into(),
            value: "local score = 12345678\nlocal cooldown = 87654321".into(),
        }];
        let (animations, sounds, images, meshes, script_refs) = analyze_records(&records);
        assert!(animations.assets.is_empty());
        assert!(sounds.assets.is_empty());
        assert!(images.assets.is_empty());
        assert!(meshes.assets.is_empty());
        assert!(script_refs.assets.is_empty());
    }

    #[test]
    fn ignores_unhinted_non_asset_strings() {
        let records = vec![StudioRecord {
            token: "7".into(),
            class_name: "StringValue".into(),
            name: "BuildNumber".into(),
            full_name: "ReplicatedStorage.BuildNumber".into(),
            property: "Value".into(),
            value: "build 12345678 generated at 87654321".into(),
        }];
        let (animations, sounds, images, meshes, script_refs) = analyze_records(&records);
        assert!(animations.assets.is_empty());
        assert!(sounds.assets.is_empty());
        assert!(images.assets.is_empty());
        assert!(meshes.assets.is_empty());
        assert!(script_refs.assets.is_empty());
    }

    #[test]
    fn rewrites_all_script_references() {
        let mappings = HashMap::from([("87654321", "99999999"), ("12345678", "11111111")]);
        let rewritten =
            replace_script_asset_ids("local count = 12345678\nlocal soundId = 87654321", &mappings);
        assert_eq!(rewritten.into_owned(), "local count = 11111111\nlocal soundId = 99999999");
    }

    #[test]
    fn categorizes_records_and_builds_targeted_patches() {
        let mut records = vec![record("AnimationId", "rbxassetid://123")];
        records.push(StudioRecord {
            token: "2".into(),
            class_name: "Script".into(),
            name: "Script".into(),
            full_name: "Workspace.Script".into(),
            property: "Source".into(),
            value: "local animationId = 12345678".into(),
        });
        let (animations, _, _, _, script_refs) = analyze_records(&records);
        assert_eq!(animations.assets.len(), 2);

        assert_eq!(script_refs.assets.len(), 0);
        let patches = plan_patches(
            &records,
            &[
                json!({"originalId": "123", "newId": "456"}),
                json!({"originalId": "12345678", "newId": "87654321"}),
            ],
        );
        assert_eq!(patches.len(), 2);
    }

    #[test]
    fn categorizes_attribute_records() {
        let records = vec![StudioRecord {
            token: "3".into(),
            class_name: "Part".into(),
            name: "Example".into(),
            full_name: "Workspace.Example".into(),
            property: "__Attribute__:RunAnimationId".into(),
            value: "rbxassetid://12345678".into(),
        }];
        let (animations, _, _, _, script_refs) = analyze_records(&records);
        assert_eq!(animations.assets.len(), 1);
        assert_eq!(script_refs.assets.len(), 0);
    }

    #[test]
    fn rich_text_extracts_image_ids() {
        let ids = extract_rich_text_asset_ids(
            r#"Hello <image="rbxassetid://12345678"></image> and <image="rbxassetid://87654321"></image>"#,
        );
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"12345678".to_string()));
        assert!(ids.contains(&"87654321".to_string()));
    }

    #[test]
    fn deep_scan_extracts_ids_from_json() {
        let json_blob = r#"{"animations":{"run":12345678,"idle":87654321, "padding": "this is some padding to make the string longer than 50 chars"}}"#;
        let ids = deep_scan_string(json_blob);
        assert!(ids.contains(&"12345678".to_string()));
        assert!(ids.contains(&"87654321".to_string()));
    }

    #[test]
    fn ast_hints_animation_from_variable_name() {
        let results = extract_script_asset_ids_with_context("local RunAnimation = 12345678");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1, Some("animation"));
        assert_eq!(results[0].2, Some("RunAnimation".to_string()));
    }

    #[test]
    fn ast_hints_sound_from_variable_name() {
        let results = extract_script_asset_ids_with_context("local backgroundMusic = 12345678");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1, Some("sound"));
        assert_eq!(results[0].2, Some("backgroundMusic".to_string()));
    }

    #[test]
    fn ast_hints_from_multi_line_table() {
        let source = r#"
        local PlayerAnimations = {
            Idle = 12345678,
            Run = 87654321,
            -- Even nested tables work
            Actions = {
                Jump = 99999999
            }
        }
        "#;
        let results = extract_table_block_ids_with_context(source);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].1, Some("animation"));
        assert_eq!(results[0].2, Some("Idle".to_string()));
        assert_eq!(results[1].1, Some("animation"));
        assert_eq!(results[2].1, Some("animation"));
        assert!(results.iter().any(|(id, _, _)| id == "12345678"));
        assert!(results.iter().any(|(id, _, _)| id == "87654321"));
        assert!(results.iter().any(|(id, _, _)| id == "99999999"));
    }

    #[test]
    fn runtime_load_detects_loadasset() {
        let refs = extract_runtime_load_ids(
            "local obj = InsertService:LoadAsset(12345678)\nrequire(87654321)",
        );
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].call_type, "LoadAsset");
        assert_eq!(refs[1].call_type, "Require");
    }

    #[test]
    fn keyframe_sequence_warning_detected() {
        let records = vec![StudioRecord {
            token: "5".into(),
            class_name: "KeyframeSequence".into(),
            name: "Run".into(),
            full_name: "Workspace.Character.Animate.run.RunAnim".into(),
            property: "KeyframeSequence".into(),
            value: "Workspace.Character.Animate.run.RunAnim".into(),
        }];
        let (_, _, _, _, script_refs) = analyze_records(&records);
        assert_eq!(count_keyframe_warnings(&script_refs), 1);
        assert_eq!(script_refs.assets[0]["kind"], "UnuploadedAnimation");
    }

    #[test]
    fn set_property_replacement_does_not_corrupt_longer_ids() {
        // "12345" is a substring of "123456789". Plain str::replace would corrupt the longer ID.
        // The bounded-regex replace must only replace the exact ID "12345", leaving "123456789" intact.
        let records = vec![StudioRecord {
            token: "10".into(),
            class_name: "Sound".into(),
            name: "MySound".into(),
            full_name: "Workspace.MySound".into(),
            property: "SoundId".into(),
            value: "rbxassetid://12345".into(),
        }];
        let patches = plan_patches(&records, &[json!({"originalId": "12345", "newId": "99999"})]);
        assert_eq!(patches.len(), 1);
        assert_eq!(patches[0]["value"], "rbxassetid://99999");
    }

    #[test]
    fn script_rewrite_does_not_replace_short_numbers() {
        // 4-6 digit numbers (game constants, dates) must NOT be replaced by the script rewriter
        // since script_rewrite_pattern now requires 7+ digits.
        let mappings = HashMap::from([("1234", "9999")]);
        let source = "local LEVEL_CAP = 1234\nlocal score = 9999999";
        let rewritten = replace_script_asset_ids(source, &mappings);
        // "1234" is only 4 digits so must NOT be rewritten; "9999999" has no mapping so unchanged.
        assert_eq!(rewritten.into_owned(), source);
    }

    #[test]
    fn attribute_replacement_does_not_corrupt_longer_ids() {
        // Ensure that replacing attribute value "12345" doesn't touch "123456789".
        let records = vec![StudioRecord {
            token: "11".into(),
            class_name: "Part".into(),
            name: "Part".into(),
            full_name: "Workspace.Part".into(),
            property: "__Attribute__:SoundAsset".into(),
            value: "12345".into(),
        }];
        let patches = plan_patches(&records, &[json!({"originalId": "12345", "newId": "67890"})]);
        assert_eq!(patches.len(), 1);
        // The value should be replaced cleanly to the numeric new_id.
        assert_eq!(patches[0]["value"], 67890u64);
    }

    #[test]
    fn targeted_replacement_only_replaces_matching_path() {
        let records = vec![
            StudioRecord {
                token: "1".into(),
                class_name: "Sound".into(),
                name: "SoundA".into(),
                full_name: "Workspace.ModelA.SoundA".into(),
                property: "SoundId".into(),
                value: "rbxassetid://12345".into(),
            },
            StudioRecord {
                token: "2".into(),
                class_name: "Sound".into(),
                name: "SoundB".into(),
                full_name: "Workspace.ModelB.SoundB".into(),
                property: "SoundId".into(),
                value: "rbxassetid://12345".into(),
            },
        ];
        let mappings = vec![json!({
            "originalId": "12345",
            "newId": "99999",
            "targetPaths": ["Workspace.ModelA.SoundA"]
        })];
        let patches = plan_patches(&records, &mappings);
        assert_eq!(patches.len(), 1);
        assert_eq!(patches[0]["token"], "1");
        assert_eq!(patches[0]["fullName"], "Workspace.ModelA.SoundA");
        assert_eq!(patches[0]["value"], "rbxassetid://99999");
    }
}
