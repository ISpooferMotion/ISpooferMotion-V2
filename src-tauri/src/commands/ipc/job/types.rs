use crate::commands::AnyValue;
use validator::Validate;

#[derive(serde::Deserialize, specta::Type, Validate)]
// Configurable settings for a spoofing job.
pub struct SpooferActionRequest {
    #[validate(length(min = 1))]
    pub assets: Option<String>,
    pub cookie: Option<String>,
    #[serde(rename = "fallbackCookies")]
    pub fallback_cookies: Option<Vec<String>>,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(rename = "spoofSounds")]
    pub spoof_sounds: Option<bool>,
    #[serde(rename = "uploadTypes")]
    pub upload_types: Option<Vec<String>>,
    #[serde(rename = "downloadPath")]
    pub download_path: Option<String>,
    #[serde(rename = "forcePlaceIds")]
    pub force_place_ids: Option<String>,
    #[serde(rename = "assetForcePlaceIds")]
    pub asset_force_place_ids: Option<std::collections::HashMap<String, String>>,
    #[serde(rename = "operationPollIntervalMs")]
    pub operation_poll_interval_ms: Option<u32>,

    #[serde(rename = "placeName")]
    pub place_name: Option<String>,
    pub concurrent: Option<bool>,
    #[serde(rename = "concurrentDownloading")]
    pub concurrent_downloading: Option<bool>,
    // Range validation removed — processor.rs already clamps these to
    // [1, 100] at the call site. Hard-failing here meant that any user
    // with a stale >100 value in their persisted config (e.g. someone who
    // typed 1000 into the frontend input before we added a max attribute)
    // couldn't start ANY spoofer job until they knew to open Settings and
    // manually lower the value. Now we just clamp silently.
    #[serde(rename = "maxConcurrency")]
    pub max_concurrency: Option<u32>,
    #[serde(rename = "maxDownloadConcurrency")]
    pub max_download_concurrency: Option<u32>,
    #[serde(rename = "skipOwned")]
    pub skip_owned: Option<bool>,
    #[serde(rename = "excludedUserIds")]
    pub excluded_user_ids: Option<String>,
    #[serde(rename = "excludedGroupIds")]
    pub excluded_group_ids: Option<String>,
    #[serde(rename = "skipExistingReplacements")]
    pub skip_existing_replacements: Option<bool>,
    #[serde(rename = "existingReplacements")]
    #[specta(type = Option<String>)]
    pub existing_replacements: Option<AnyValue>,
    #[specta(type = Option<String>)]
    pub account: Option<AnyValue>,
    #[specta(type = Option<String>)]
    pub group: Option<AnyValue>,
    #[serde(rename = "preserveMetadata")]
    pub preserve_metadata: Option<bool>,
    #[serde(rename = "enableArchiveRecovery")]
    pub enable_archive_recovery: Option<bool>,
    #[serde(rename = "proxyUrl")]
    pub proxy_url: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct AssetDetails {
    pub name: String,
    pub description: String,
}
