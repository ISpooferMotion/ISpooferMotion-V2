//! Parses local `.rbxl` and `.rbxm` files directly without needing Roblox Studio open.
//!
//! Exposes a command that reads a local file using `rbx_dom_weak`, walks the tree,
//! and extracts any property that looks like an asset ID so the user can spoof
//! an entire place file offline.

use rbx_dom_weak::types::Variant;
use rbx_dom_weak::WeakDom;
use serde::Serialize;

use std::io::BufReader;

#[derive(Debug, Serialize, Clone, specta::Type)]
pub struct ParsedAssetRef {
    pub r#type: String, // "animation", "audio", "image", "mesh", "script_ref", etc.
    #[serde(rename = "assetId")]
    pub asset_id: String,
    #[serde(rename = "rawValue")]
    pub raw_value: String,
    #[serde(rename = "className")]
    pub class_name: String,
    #[serde(rename = "instanceName")]
    pub instance_name: String,
    #[serde(rename = "propertyName")]
    pub property_name: String,
    pub path: String,
}

#[derive(Debug, Serialize, Clone, specta::Type)]
pub struct RbxInstance {
    pub referent: String,
    #[serde(rename = "className")]
    pub class_name: String,
    pub name: String,
    pub assets: Vec<ParsedAssetRef>,
    pub children: Vec<RbxInstance>,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct PlaceParseResult {
    #[serde(rename = "fileType")]
    pub file_type: String, // "rbxl" or "rbxlx"
    #[serde(rename = "rootInstances")]
    pub root_instances: Vec<RbxInstance>,
    pub warnings: Vec<String>,
}

fn extract_asset_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Try extracting from standard "rbxassetid://12345"
    if let Some(stripped) = trimmed.strip_prefix("rbxassetid://") {
        return Some(stripped.to_string());
    }
    // Try extracting from "?id=12345" or "&id=12345"
    if let Some(idx) = trimmed.find("id=") {
        let rest = &trimmed[idx + 3..];
        let end = rest.find('&').unwrap_or(rest.len());
        let id_str = &rest[..end];
        if id_str.chars().all(|c| c.is_ascii_digit()) {
            return Some(id_str.to_string());
        }
    }
    // Try numeric string
    if trimmed.chars().all(|c| c.is_ascii_digit()) && trimmed.len() >= 7 {
        return Some(trimmed.to_string());
    }

    None
}

fn classify_property(class_name: &str, property_name: &str) -> Option<&'static str> {
    let lower = property_name.to_lowercase();
    match class_name {
        "Animation" | "AnimationTrack" if lower.contains("animation") => Some("animation"),
        "Sound" if lower.contains("sound") => Some("audio"),
        "Decal" | "Texture" | "ImageLabel" | "ImageButton"
            if lower.contains("image") || lower.contains("texture") =>
        {
            Some("image")
        }
        "SpecialMesh" | "FileMesh" | "MeshPart" if lower.contains("texture") => Some("image"),
        "Sky" if lower.starts_with("skybox") => Some("image"),
        "SpecialMesh" | "FileMesh" | "MeshPart" if lower.contains("mesh") => Some("mesh"),
        "Script" | "LocalScript" | "ModuleScript" if lower.contains("linkedsource") => {
            Some("script_ref")
        }
        _ => {
            if lower.contains("animationid") {
                return Some("animation");
            }
            if lower.contains("soundid") {
                return Some("audio");
            }
            if lower.contains("textureid") {
                return Some("image");
            }
            if lower.contains("meshid") {
                return Some("mesh");
            }
            if lower.contains("linkedsource") {
                return Some("script_ref");
            }
            None
        }
    }
}

fn process_instance(
    dom: &WeakDom,
    id: rbx_dom_weak::types::Ref,
    parent_path: &str,
) -> Option<RbxInstance> {
    let instance = dom.get_by_ref(id)?;

    let name = instance.name.clone();
    let class_name = instance.class.to_string();
    let current_path =
        if parent_path.is_empty() { name.clone() } else { format!("{parent_path}/{name}") };

    let mut assets = Vec::new();

    // Check properties for assets
    for (prop_name, prop_value) in &instance.properties {
        if let Some(asset_type) = classify_property(&class_name, prop_name.as_str()) {
            let raw_val_str = match prop_value {
                Variant::String(s) => s.clone(),
                Variant::Content(c) => match c.value() {
                    rbx_dom_weak::types::ContentType::Uri(uri) => uri.clone(),
                    _ => String::new(),
                },
                Variant::SharedString(s) => String::from_utf8_lossy(s.data()).into_owned(),
                // All other variant types cannot carry an asset URL; skip them.
                _ => continue,
            };

            if let Some(asset_id) = extract_asset_id(&raw_val_str) {
                assets.push(ParsedAssetRef {
                    r#type: asset_type.to_string(),
                    asset_id,
                    raw_value: raw_val_str,
                    class_name: class_name.clone(),
                    instance_name: name.clone(),
                    property_name: prop_name.to_string(),
                    path: current_path.clone(),
                });
            }
        }
    }

    let mut children = Vec::new();
    for child_id in instance.children() {
        if let Some(child_node) = process_instance(dom, *child_id, &current_path) {
            children.push(child_node);
        }
    }

    // Only return the node if it has assets or if any of its children have assets (to keep tree small)
    if !assets.is_empty() || !children.is_empty() {
        Some(RbxInstance { referent: id.to_string(), class_name, name, assets, children })
    } else {
        None
    }
}

/// Reads a local Roblox place or model file and extracts all spoofable assets.
///
/// Supports both XML (`.rbxlx`, `.rbxmx`) and binary (`.rbxl`, `.rbxm`) formats.
#[tauri::command]
#[specta::specta]
pub fn parse_place_file(file_path: String) -> Result<PlaceParseResult, String> {
    let path = std::path::Path::new(&file_path);
    let file = std::fs::File::open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "File does not exist".to_string()
        } else {
            e.to_string()
        }
    })?;
    let mut reader = BufReader::new(file);

    let ext = path.extension().unwrap_or_default().to_str().unwrap_or_default().to_lowercase();

    let warnings = Vec::new();
    let dom = if ext == "rbxl" || ext == "rbxm" {
        rbx_binary::from_reader(&mut reader).map_err(|e| e.to_string())?
    } else if ext == "rbxlx" || ext == "rbxmx" {
        rbx_xml::from_reader_default(&mut reader).map_err(|e| e.to_string())?
    } else {
        return Err("Unsupported file extension. Must be .rbxl, .rbxlx, .rbxm, or .rbxmx".into());
    };

    let mut root_instances = Vec::new();

    // Process top-level children of the DOM root
    let root = dom.root();
    for child_id in root.children() {
        if let Some(node) = process_instance(&dom, *child_id, "") {
            root_instances.push(node);
        }
    }

    Ok(PlaceParseResult { file_type: ext, root_instances, warnings })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_place_file() {
        let result = parse_place_file("test_place.rbxmx".to_string());
        assert!(result.is_err(), "Expected an error because the file does not exist");
        assert_eq!(result.expect_err("Expected an error"), "File does not exist");
    }
}
