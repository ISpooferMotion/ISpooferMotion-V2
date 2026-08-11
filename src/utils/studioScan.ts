import { invoke } from '@tauri-apps/api/core';

import { fetchPluginBridge } from './pluginBridge';

const SCAN_STALL_MS = 300_000;
const SCAN_POLL_MS = 1500;

// Poll backend until the studio plugin finishes active scan. The timeout is
// progress-based: the watchdog resets whenever the scanned count advances, so a
// huge place that's actively scanning runs to completion instead of being killed
// at a hard 5-minute wall. It only throws if the scan stalls (no progress for
// SCAN_STALL_MS) or Studio disconnects mid-scan.
async function waitForStudioScanComplete(): Promise<void> {
  let lastProgressScanned: number | undefined;
  let lastProgressTime = Date.now();
  let lastSyncedTime = Date.now();
  while (Date.now() - lastProgressTime < SCAN_STALL_MS) {
    try {
      const health = await invoke<{
        scanStatus?: { scanning?: boolean; scanned?: number } | null;
        synced?: boolean;
      }>('get_studio_health_status');
      if (!health.scanStatus || !health.scanStatus.scanning) {
        return;
      }
      // Reset the stall watchdog whenever the scanned count advances.
      const scanned = health.scanStatus.scanned;
      if (scanned !== undefined && scanned !== lastProgressScanned) {
        lastProgressScanned = scanned;
        lastProgressTime = Date.now();
      }
      if (health.synced) {
        lastSyncedTime = Date.now();
      } else if (Date.now() - lastSyncedTime > 5000) {
        throw new Error(
          'Roblox Studio is not connected or the ISpooferMotion plugin is disabled. Please open Studio and try again.',
        );
      }
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_MS));
  }
  throw new Error(
    'Studio scan stalled — no progress for 5 minutes. Open Roblox Studio and check that the ISpooferMotion plugin is connected, then try again. Very large places may need to be scanned manually from the plugin panel.',
  );
}

export interface ScanOptions {
  scanTypes: string[];
  scriptScanMode: string;
}

export async function triggerStudioScan(options?: ScanOptions): Promise<void> {
  const { findPluginBridgePort, DEFAULT_PLUGIN_PORT } = await import('./pluginBridge');
  const port = (await findPluginBridgePort()) || DEFAULT_PLUGIN_PORT;

  // Push scan options to the backend so the plugin picks them up via /poll.
  if (options) {
    await fetchPluginBridge('/scan-options', port, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  const allTypes = options?.scanTypes ?? ['sounds', 'animations', 'images', 'meshes', 'scripts'];
  const endpointMap: Record<string, string> = {
    sounds: '/request-sounds',
    animations: '/request-animations',
    images: '/request-images',
    meshes: '/request-meshes',
    scripts: '/request-script-refs',
  };
  const endpoints = allTypes.map((t) => endpointMap[t]).filter(Boolean);

  for (const endpoint of endpoints) {
    const startResponse = await fetchPluginBridge(endpoint, port, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!startResponse.ok) {
      throw new Error('Could not start a Studio scan. Is the plugin connected?');
    }
  }

  await waitForStudioScanComplete();
}
