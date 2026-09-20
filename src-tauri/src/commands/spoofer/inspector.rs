use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

pub struct PayloadMeta {
    pub file_type: String,
    pub extension: String,
}

pub async fn inspect_payload(path: &Path) -> crate::error::Result<PayloadMeta> {
    let mut file = File::open(path).await.map_err(|e| format!("Failed to open payload: {e}"))?;
    let mut buffer = [0u8; 512];
    let bytes_read = file.read(&mut buffer).await.unwrap_or(0);
    let sample = &buffer[..bytes_read];

    if sample.starts_with(b"<!doctype html")
        || sample.starts_with(b"<!DOCTYPE html")
        || sample.starts_with(b"<html")
    {
        return Err(
            "Roblox returned an HTML error page instead of an asset file. Please try again.".into(),
        );
    }

    if sample.starts_with(b"{\"errors\":") || sample.starts_with(b"{\"message\":") {
        return Err("Roblox returned a JSON error response instead of an asset file.".into());
    }

    if sample.starts_with(b"OggS") {
        return Ok(PayloadMeta { file_type: "audio/ogg".into(), extension: "ogg".into() });
    }

    if sample.starts_with(b"ID3")
        || sample.starts_with(&[0xFF, 0xFB])
        || sample.starts_with(&[0xFF, 0xF3])
        || sample.starts_with(&[0xFF, 0xF2])
    {
        return Ok(PayloadMeta { file_type: "audio/mpeg".into(), extension: "mp3".into() });
    }

    if sample.starts_with(b"RIFF") && sample.len() >= 12 && &sample[8..12] == b"WAVE" {
        return Ok(PayloadMeta { file_type: "audio/wav".into(), extension: "wav".into() });
    }

    if sample.starts_with(b"fLaC") {
        return Ok(PayloadMeta { file_type: "audio/flac".into(), extension: "flac".into() });
    }

    if sample.starts_with(b"<roblox!") {
        return Ok(PayloadMeta { file_type: "model/x-rbxm".into(), extension: "rbxm".into() });
    }

    if sample.starts_with(b"<roblox xmlns:xmime=") || sample.starts_with(b"<roblox xmlns=") {
        return Ok(PayloadMeta { file_type: "model/x-rbxm".into(), extension: "rbxmx".into() });
    }

    if sample.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Ok(PayloadMeta { file_type: "image/png".into(), extension: "png".into() });
    }

    if sample.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Ok(PayloadMeta { file_type: "image/jpeg".into(), extension: "jpeg".into() });
    }

    Ok(PayloadMeta { file_type: "application/octet-stream".into(), extension: "unknown".into() })
}
