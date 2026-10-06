// ISM-V2-PROVENANCE: 710004FD4865D2D627D2D845
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

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

// ISM-V2-PROVENANCE-END: 710004FD4865D2D627D2D845
