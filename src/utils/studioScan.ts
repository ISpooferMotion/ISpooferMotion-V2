import { invoke } from '@tauri-apps/api/core';

import { fetchPluginBridge } from './pluginBridge';

const SCAN_STALL_MS = 300_000;
const SCAN_POLL_MS = 1500;

interface StudioHealth {
  scanStatus?: { scanning?: boolean; scanned?: number } | null;
  synced?: boolean;
  scanGeneration?: number;
  completedScanGeneration?: number;
  abortedScanGeneration?: number;
}

const readStudioHealth = () => invoke<StudioHealth>('get_studio_health_status');

async function waitForStudioScanComplete(previousGeneration: number): Promise<void> {
  const startedAt = Date.now();
  let lastProgressScanned: number | undefined;
  let lastProgressTime = startedAt;
  let lastSyncedTime = startedAt;

  while (Date.now() - lastProgressTime < SCAN_STALL_MS) {
    const health = await readStudioHealth();
    const now = Date.now();

    if ((health.abortedScanGeneration ?? 0) > previousGeneration) {
      throw new Error('Studio cancelled the scan before it finished.');
    }
    if ((health.completedScanGeneration ?? 0) > previousGeneration) {
      return;
    }
    if (health.synced) {
      lastSyncedTime = now;
    } else if (now - lastSyncedTime > 5000) {
      throw new Error(
        'Roblox Studio is not connected or the ISpooferMotion plugin is disabled. Please open Studio and try again.',
      );
    }
    if ((health.scanGeneration ?? 0) <= previousGeneration) {
      if (now - startedAt > 20000) {
        throw new Error(
          'Studio did not start the requested scan. Please check the plugin and retry.',
        );
      }
    } else {
      const scanned = health.scanStatus?.scanned;
      if (scanned !== undefined && scanned !== lastProgressScanned) {
        lastProgressScanned = scanned;
        lastProgressTime = now;
      }
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
  const previousGeneration = (await readStudioHealth()).scanGeneration ?? 0;

  if (options) {
    const optionsResponse = await fetchPluginBridge('/scan-options', port, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    if (!optionsResponse.ok) {
      throw new Error('Could not configure the Studio scan. Please try again.');
    }
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

  await waitForStudioScanComplete(previousGeneration);
}
