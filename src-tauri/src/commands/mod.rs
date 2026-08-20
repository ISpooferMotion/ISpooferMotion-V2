//! Commands module root. Registers Tauri IPC endpoints.
//!
//! This module houses the frontend-to-backend RPC bridge. Functions marked with
//! `#[tauri::command]` are directly callable from the React frontend, and we use
//! `specta` to automatically generate TypeScript bindings for them.
pub mod anim_parser;
pub mod assets;
pub mod auth;
pub mod fs;
pub mod ipc;
pub mod jobs;
pub mod place_parser;
pub mod resolver;
pub mod roblox_status;
pub mod session;
pub mod spoofer;
pub mod startup;
pub mod studio;

/// A wrapper around `serde_json::Value` used to bypass strict type-checking
/// over the IPC boundary. This allows the backend to send dynamic, unstructured
/// JSON objects to the frontend without defining a rigid struct for every possible shape.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct AnyValue(pub serde_json::Value);

impl specta::Type for AnyValue {
    fn definition(_types: &mut specta::Types) -> specta::datatype::DataType {
        specta::datatype::DataType::Primitive(specta::datatype::Primitive::str)
    }
}
