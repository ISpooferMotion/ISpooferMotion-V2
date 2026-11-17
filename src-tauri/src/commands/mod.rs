pub mod anim_parser;
pub mod assets;
pub mod auth;
pub mod fs;
pub mod ipc;
pub mod jobs;
pub mod place_parser;
pub mod resolver;
pub mod roblox_status;
pub mod spoofer;
pub mod startup;
pub mod studio;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct AnyValue(pub serde_json::Value);

impl specta::Type for AnyValue {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <specta_typescript::Unknown as specta::Type>::definition(types)
    }
}
