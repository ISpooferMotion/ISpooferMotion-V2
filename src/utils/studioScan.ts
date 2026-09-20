import { invoke } from '@tauri-apps/api/core';

import { fetchPluginBridge } from './pluginBridge';

const SCAN_STALL_MS = 300_000;
const SCAN_POLL_MS = 1500;

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
  scanPath?: string;
}

export async function triggerStudioScan(options?: ScanOptions): Promise<void> {
  const { findPluginBridgePort } = await import('./pluginBridge');
  const activePort = await findPluginBridgePort();

  if (!activePort) {
    const pid = await invoke<number | null>('find_studio_process').catch(() => null);
    if (!pid) {
      throw new Error('Please open Roblox Studio to connect the plugin.');
    } else {
      throw new Error(
        'Roblox Studio is open, but the ISpooferMotion plugin is not connected. Please enable the plugin in Studio.',
      );
    }
  }

  const port = activePort;

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
