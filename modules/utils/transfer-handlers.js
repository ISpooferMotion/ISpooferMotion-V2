// modules/utils/transfer-handlers.js
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { DEVELOPER_MODE } = require('./common');
const { uploadAsset } = require('./roblox-api');

/**
 * Downloads stuff
 */
async function downloadAnimationAssetWithProgress(url, robloxCookie, filePath, transferId, entryName, originalAssetId, sendTransferUpdate, placeId = null, options = {}) {
  sendTransferUpdate({ id: transferId, name: entryName, originalAssetId: originalAssetId, status: 'processing', direction: 'download', progress: 0, error: null, size: 0 });
  if (DEVELOPER_MODE) {
    console.log(`[DOWNLOAD DEBUG] Starting download for "${entryName}" (Asset ID: ${originalAssetId})`);
    console.log(`[DOWNLOAD DEBUG] URL: ${url}`);
    console.log(`[DOWNLOAD DEBUG] PlaceId: ${placeId || 'not provided'}`);
    console.log(`[DOWNLOAD DEBUG] Target file: ${filePath}`);
  }

  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  const retries = typeof options.retries === 'number' && options.retries > 0 ? options.retries : 2;
  const retryDelayMs = typeof options.retryDelayMs === 'number' && options.retryDelayMs > 0 ? options.retryDelayMs : 2000;
  let lastReportedProgress = 0;
  let fileStream = null;
  let attemptError = null;

  for (let attempt = 1; attempt <= (retries + 1); attempt++) {
    attemptError = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }, redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        const errorDetail = DEVELOPER_MODE
          ? `Failed to download asset: ${response.status} ${response.statusText} | Asset ID: ${originalAssetId} | PlaceId: ${placeId || 'N/A'} | URL: ${url}`
          : `Failed to download asset: ${response.status} ${response.statusText}`;
        throw new Error(errorDetail);
      }
      if (!response.body) throw new Error(`No response body for asset (ID: ${originalAssetId})`);

      const totalSize = Number(response.headers.get('content-length'));
      if (DEVELOPER_MODE) console.log(`[DOWNLOAD DEBUG] Content-Length: ${totalSize} bytes`);
      sendTransferUpdate({ id: transferId, size: isNaN(totalSize) ? 0 : totalSize });

      const reader = response.body.getReader();
      fileStream = fsSync.createWriteStream(filePath);
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(value);
        receivedLength += value.length;

        if (totalSize > 0) {
          const currentProgress = Math.round((receivedLength / totalSize) * 100);
          if (currentProgress > lastReportedProgress) {
            sendTransferUpdate({ id: transferId, progress: currentProgress });
            lastReportedProgress = currentProgress;
          }
        }
      }

      fileStream.end();
      await new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', (err) => reject(new Error(`File stream error: ${err.message}`)));
      });

      if (lastReportedProgress < 100 && totalSize > 0) sendTransferUpdate({ id: transferId, progress: 100 });
      sendTransferUpdate({ id: transferId, status: 'completed', progress: 100 });
      if (DEVELOPER_MODE) console.log(`[DOWNLOAD DEBUG] Successfully downloaded "${entryName}" (${receivedLength} bytes)`);
      return { success: true, filePath };
    } catch (error) {
      attemptError = error;
      const msg = error && error.message ? error.message : 'unknown error';
      const isTimeout = error && (error.name === 'AbortError' || /aborted|timeout/i.test(msg));
      const shouldRetry = isTimeout || /\b5\d\d\b/.test(msg) || /Failed to download asset: (500|502|503|504)/.test(msg);

      try { if (fileStream) fileStream.end(); } catch {}
      try { if (fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath); } catch {}

      if (DEVELOPER_MODE) console.warn(`[DOWNLOAD DEBUG] Attempt ${attempt}/${retries + 1} for "${entryName}" failed (${isTimeout ? 'timeout' : 'error'}): ${msg}${shouldRetry && attempt <= retries ? ' -> retrying' : ''}`);

      if (!shouldRetry || attempt > retries) {
        const errorMsg = DEVELOPER_MODE 
          ? `[DOWNLOAD ERROR] "${entryName}" (Asset ID: ${originalAssetId}, PlaceId: ${placeId || 'N/A'}): ${msg}`
          : `Download error for ${entryName}: ${msg}`;
        console.error(errorMsg);
        sendTransferUpdate({ id: transferId, status: 'error', error: msg, progress: lastReportedProgress || 0 });
        return { success: false, error: msg };
      }

      // On timeout, wait 5s; otherwise quick retry
      const waitMs = isTimeout ? 5000 : (retryDelayMs + Math.floor(Math.random() * 300));
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
  }
}

/**
 * Publishes an animation RBXM file to Roblox via the Open Cloud Assets API.
 * The legacy /ide/publish/uploadnewanimation endpoint was deprecated in early 2026.
 */
async function publishAnimationRbxmWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate, assetTypeName = 'Animation', apiKey = null, userId = null) {
  let fileBuffer;
  let fileSize = 0;
  try {
    fileBuffer = await fs.readFile(filePath);
    fileSize = fileBuffer.length;
  } catch (fileError) {
    sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: `File system error: ${fileError.message}` });
    return { success: false, error: `File system error: ${fileError.message}` };
  }

  sendTransferUpdate({
    id: transferId,
    name,
    size: fileSize,
    status: 'processing',
    direction: 'upload',
    progress: 0,
    error: null,
  });

  if (!apiKey) {
    const errorMsg = 'Animation uploads require an Open Cloud API key. The legacy Roblox upload endpoint was deprecated in early 2026. Go to create.roblox.com → Open Cloud → API Keys, create a key with Assets Read & Write permissions, and paste it into the "Open Cloud API Key" field.';
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }

  const creatorObj = groupId ? { groupId: String(groupId) } : { userId: String(userId) };
  const requestMetadata = {
    assetType: 'Animation',
    displayName: name,
    description: 'Placeholder',
    creationContext: { creator: creatorObj },
  };

  if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Attempting Animation upload for "${name}" via Open Cloud Assets API`);

  const MAX_RATE_LIMIT_RETRIES = 4;

  try {
    let response, responseData;

    // Retry loop — handles 429 rate limits by waiting the retry-after duration
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      // FormData must be rebuilt each attempt since the body stream is consumed after fetch
      const formData = new FormData();
      formData.append('request', JSON.stringify(requestMetadata));
      formData.append('fileContent', new Blob([fileBuffer], { type: 'model/x-rbxm' }), 'animation.rbxm');

      response = await fetch('https://apis.roblox.com/assets/v1/assets', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: formData,
      });

      if (response.status === 429) {
        if (attempt >= MAX_RATE_LIMIT_RETRIES) {
          throw new Error(`Rate limit hit after ${MAX_RATE_LIMIT_RETRIES} retries. Try reducing the number of concurrent uploads or wait a minute and try again.`);
        }
        const retryAfter = Math.min(parseInt(response.headers.get('retry-after') || '60', 10), 120);
        if (DEVELOPER_MODE) console.log(`[UPLOAD] Rate limited on "${name}". Waiting ${retryAfter}s (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})...`);
        // Keep the transfer in processing state while waiting
        sendTransferUpdate({ id: transferId, status: 'processing', progress: 0 });
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      responseData = await response.json();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(`API key unauthorized (${response.status}). Verify your Open Cloud API key has Assets Read & Write permissions.`);
        } else if (response.status >= 500) {
          throw new Error(`Server error (${response.status}). Response: ${JSON.stringify(responseData)}`);
        } else {
          throw new Error(`Upload failed (Status: ${response.status}). Response: ${JSON.stringify(responseData)}`);
        }
      }

      break; // success — exit retry loop
    }

    // Synchronous success: done=true with assetId in response
    if (responseData.done && responseData.response) {
      const assetId = responseData.response.assetId || responseData.response.Id;
      if (assetId) {
        sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: String(assetId) });
        return { success: true, assetId: String(assetId) };
      }
    }

    // Asynchronous: poll the operation path until done
    if (responseData.path && !responseData.done) {
      const operationPath = responseData.path;
      if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Polling operation: ${operationPath}`);
      for (let attempt = 1; attempt <= 15; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        const pollResp = await fetch(`https://apis.roblox.com/assets/v1/${operationPath}`, {
          headers: { 'x-api-key': apiKey },
        });
        const pollData = await pollResp.json();
        if (pollData.done && pollData.response) {
          const assetId = pollData.response.assetId || pollData.response.Id;
          if (assetId) {
            sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: String(assetId) });
            return { success: true, assetId: String(assetId) };
          }
        }
        if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Poll attempt ${attempt}/15, done=${pollData.done}`);
      }
      throw new Error('Upload timed out waiting for Roblox to process the animation.');
    }

    throw new Error(`Unexpected response from Open Cloud API: ${JSON.stringify(responseData)}`);
  } catch (err) {
    const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
    console.error(`[UPLOAD ERROR - ANIMATION] ${errorMsg}`, err.cause || err);
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

/**
 * Publishes an audio/sound file to Roblox via publish.roblox.com/v1/audio
 */
async function publishAudioWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate) {
  let fileBuffer;
  let fileSize = 0;
  try {
    fileBuffer = await fs.readFile(filePath);
    fileSize = fileBuffer.length;
  } catch (fileError) {
    sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: `File system error: ${fileError.message}` });
    return { success: false, error: `File system error: ${fileError.message}` };
  }

  sendTransferUpdate({
    id: transferId,
    name,
    size: fileSize,
    status: 'processing',
    direction: 'upload',
    progress: 0,
    error: null,
  });

  // Use modern publish API with base64 payload and group support
  const payload = {
    name,
    file: fileBuffer.toString('base64'),
    assetPrivacy: 1,
    estimatedFileSize: fileSize,
    estimatedDuration: 0,
    paymentSource: 'User',
  };
  if (groupId) payload.groupId = parseInt(groupId);

  // Get a fresh CSRF token for publish.roblox.com if available
  let publishCsrfToken = csrfToken;
  try {
    const csrfResponse = await fetch('https://publish.roblox.com/v1/audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `.ROBLOSECURITY=${cookie}`,
      },
      body: JSON.stringify({}),
    });
    const newToken = csrfResponse.headers.get('x-csrf-token');
    if (newToken) publishCsrfToken = newToken;
  } catch (csrfError) {
    if (DEVELOPER_MODE) console.warn(`[UPLOAD DEBUG] Failed to get fresh CSRF token, using existing one:`, csrfError.message);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `.ROBLOSECURITY=${cookie}`,
    'x-csrf-token': publishCsrfToken,
    'User-Agent': 'RobloxStudio/WinInet',
  };

  if (DEVELOPER_MODE) {
    console.log(`[UPLOAD DEBUG - FETCH] Attempting Audio upload for "${name}" to: https://publish.roblox.com/v1/audio`);
    console.log(`[UPLOAD DEBUG] Payload size: ${fileSize} bytes (base64: ${payload.file.length} chars)`);
  }

  try {
    const response = await fetch('https://publish.roblox.com/v1/audio', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || 'unknown';
        throw new Error(`Rate limit exceeded (429). Retry-After: ${retryAfter}s. Response: ${JSON.stringify(responseData)}`);
      } else if (response.status >= 500) {
        throw new Error(`Server error (${response.status}). Response: ${JSON.stringify(responseData)}`);
      } else {
        throw new Error(`Upload failed (Status: ${response.status}). Response: ${JSON.stringify(responseData)}`);
      }
    }

    const newAssetId = responseData.Id || responseData.id || responseData.assetId;
    if (newAssetId) {
      sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: newAssetId.toString() });
      return { success: true, assetId: newAssetId.toString() };
    }

    throw new Error(`Upload successful (Status ${response.status}) but the response did not contain an asset ID. Response: ${JSON.stringify(responseData)}`);
  } catch (err) {
    const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
    const isRateLimit = errorMsg.includes('429') || errorMsg.includes('Rate limit');
    if (DEVELOPER_MODE || isRateLimit) {
      console.error(`[UPLOAD ERROR - FETCH] Audio upload failed${isRateLimit ? ' (RATE LIMIT)' : ''}: ${errorMsg}`, err.cause || err);
    }
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

/**
 * Router function that selects the appropriate upload method based on asset type
 * @param {string} assetType - 'Sound', 'Audio', 'Animation', 'Image', 'Decal'
 */
async function publishAssetWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate, assetType, userId = null, apiKey = null) {
  // Route based on asset type
  if (assetType === 'Sound' || assetType === 'Audio') {
    return await publishAudioWithProgress(filePath, name, cookie, csrfToken, groupId, transferId, sendTransferUpdate);
  }

  // Images/Decals: use generic asset upload endpoint with correct type
  if (assetType === 'Image' || assetType === 'Decal') {
    try {
      const stat = await fs.stat(filePath).catch(() => null);
      const size = stat ? stat.size : 0;
      sendTransferUpdate({ id: transferId, name, size, status: 'processing', direction: 'upload', progress: 0, error: null });

      if (DEVELOPER_MODE) console.log(`[IMAGE UPLOAD] Starting upload: ${name}, groupId=${groupId}, userId=${userId}`);

      const result = await uploadAsset(filePath, assetType, name, groupId, userId, cookie, null);

      if (result.success && result.assetId) {
        if (DEVELOPER_MODE) console.log(`[IMAGE UPLOAD] ✓ Success: ${name} → assetId ${result.assetId}`);
        sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: result.assetId.toString() });
      } else {
        if (DEVELOPER_MODE) console.error(`[IMAGE UPLOAD] ✗ Failed: ${name} - ${result.error}`);
        sendTransferUpdate({ id: transferId, status: 'error', error: result.error || 'Upload failed', progress: 0 });
      }
      return result;
    } catch (err) {
      const msg = err && err.message ? err.message : 'Upload failed';
      if (DEVELOPER_MODE) console.error(`[IMAGE UPLOAD] Exception: ${name} - ${msg}`);
      sendTransferUpdate({ id: transferId, status: 'error', error: msg, progress: 0 });
      return { success: false, error: msg };
    }
  }

  // For animations (and other types by fallback), use the Open Cloud RBXM uploader
  const assetTypeName = assetType === 'Animation' ? 'Animation' : (assetType || 'Animation');
  if (assetType !== 'Animation' && DEVELOPER_MODE) console.warn(`[UPLOAD WARNING] No specific handler for ${assetType}, using animation endpoint`);
  return await publishAnimationRbxmWithProgress(filePath, name, cookie, csrfToken, groupId, transferId, sendTransferUpdate, assetTypeName, apiKey, userId);
}

module.exports = {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
  publishAudioWithProgress,
  publishAssetWithProgress,
};
