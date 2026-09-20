const MAGIC_PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
const MAGIC_JPEG: &[u8] = &[0xff, 0xd8, 0xff];
const MAGIC_GIF87A: &[u8] = b"GIF87a";
const MAGIC_GIF89A: &[u8] = b"GIF89a";
const MAGIC_OGG: &[u8] = b"OggS";
const MAGIC_ID3: &[u8] = b"ID3";
const MAGIC_RIFF: &[u8] = b"RIFF";
const MAGIC_FLAC: &[u8] = b"fLaC";
const MAGIC_MAC: &[u8] = b"MAC ";
const MAGIC_FORM: &[u8] = b"FORM";
const MAGIC_WEBM_MKV: &[u8] = b"\x1A\x45\xDF\xA3";

fn is_valid_audio(head: &[u8]) -> bool {
    head.starts_with(MAGIC_OGG)
        || head.starts_with(MAGIC_ID3)
        || (head.len() >= 2 && head[0] == 0xff && (head[1] & 0xe0) == 0xe0)
        || head.starts_with(MAGIC_RIFF)
        || head.starts_with(MAGIC_FLAC)
        || head.windows(4).any(|w| w == b"ftyp")
        || head.starts_with(MAGIC_MAC)
        || head.starts_with(MAGIC_FORM)
}

fn is_valid_image(head: &[u8]) -> bool {
    head.starts_with(MAGIC_PNG)
        || head.starts_with(MAGIC_JPEG)
        || head.starts_with(MAGIC_GIF87A)
        || head.starts_with(MAGIC_GIF89A)
}

fn is_valid_video(head: &[u8]) -> bool {
    head.windows(4)
        .any(|w| w == b"ftyp" || w == b"moov" || w == b"mdat" || w == b"free" || w == b"webm")
        || head.starts_with(MAGIC_WEBM_MKV)
}

fn contains_ignore_ascii_case(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w.eq_ignore_ascii_case(needle))
}

fn starts_with_ignore_ascii_case(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.len() >= needle.len() && haystack[..needle.len()].eq_ignore_ascii_case(needle)
}

pub async fn validate_downloaded_payload(
    file_path: &str,
    asset_type: Option<&str>,
) -> Result<(), String> {
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::open(file_path)
        .await
        .map_err(|error| format!("Could not open downloaded asset for validation: {error}"))?;
    let mut bytes = [0u8; 4096];
    let n = file.read(&mut bytes).await.unwrap_or(0);
    if n == 0 {
        return Err("Downloaded asset was empty.".into());
    }
    let valid_bytes = &bytes[..n];

    let trimmed_start =
        valid_bytes.iter().position(|byte| !byte.is_ascii_whitespace()).unwrap_or(0);
    let head = &valid_bytes[trimmed_start..];

    if starts_with_ignore_ascii_case(head, b"<!doctype html")
        || starts_with_ignore_ascii_case(head, b"<html")
        || starts_with_ignore_ascii_case(head, b"{\"errors\"")
        || starts_with_ignore_ascii_case(head, b"{\"error\"")
        || (starts_with_ignore_ascii_case(head, b"<?xml")
            && !contains_ignore_ascii_case(head, b"<roblox"))
        || (starts_with_ignore_ascii_case(head, b"<error")
            && !contains_ignore_ascii_case(head, b"<roblox"))
    {
        return Err("Downloaded asset response was an error page, not usable asset content.".into());
    }

    match asset_type.unwrap_or_default().to_ascii_lowercase().as_str() {
        "audio" => {
            if is_valid_audio(head) {
                Ok(())
            } else {
                Err("Downloaded audio was not a recognized audio file.".into())
            }
        }
        "image" => {
            if is_valid_image(head) {
                Ok(())
            } else {
                Err("Downloaded image was not a recognized image file.".into())
            }
        }
        "video" => {
            if is_valid_video(head) {
                Ok(())
            } else {
                Err("Downloaded video was not a recognized video format.".into())
            }
        }
        "mesh" | "animation" | "plugin" | "model" => Ok(()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn validation_accepts_valid_video() -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join("ispoofer-valid-video.mp4");
        tokio::fs::write(&path, b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom").await?;
        let path_string = path.to_string_lossy().to_string();
        let result = validate_downloaded_payload(&path_string, Some("video")).await;
        let _ = tokio::fs::remove_file(path).await;
        assert!(result.is_ok());
        Ok(())
    }
}
