// ISM-V2-PROVENANCE: 21DEA67E21C25314B89AB1AC
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct ConcurrentDownloadTask {
    pub direct_url: Option<String>,
    pub file_path: String,
    pub transfer_id: String,
    pub name: String,
    pub asset_id: String,
    pub asset_type: Option<String>,
}

// ISM-V2-PROVENANCE-END: 21DEA67E21C25314B89AB1AC
