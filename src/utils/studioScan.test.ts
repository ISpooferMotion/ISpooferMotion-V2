import * as tauriCore from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as pluginBridge from './pluginBridge';
import { triggerStudioScan } from './studioScan';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./pluginBridge', () => ({
  fetchPluginBridge: vi.fn(),
  findPluginBridgePort: vi.fn(),
  DEFAULT_PLUGIN_PORT: '14285',
}));

describe('studioScan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers scan on all endpoints and waits', async () => {
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue('5555');
    vi.mocked(pluginBridge.fetchPluginBridge).mockResolvedValue({ ok: true } as Response);

    let callCount = 0;
    vi.mocked(tauriCore.invoke).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ scanGeneration: 0, synced: true });
      }
      if (callCount === 2) {
        return Promise.resolve({ scanGeneration: 1, scanStatus: { scanning: true }, synced: true });
      }
      return Promise.resolve({ scanGeneration: 1, completedScanGeneration: 1, synced: true });
    });

    const scanPromise = triggerStudioScan();

    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1500);

    await scanPromise;

    expect(pluginBridge.fetchPluginBridge).toHaveBeenCalledTimes(5);
    expect(pluginBridge.fetchPluginBridge).toHaveBeenCalledWith(
      '/request-sounds',
      '5555',
      expect.any(Object),
    );
    expect(tauriCore.invoke).toHaveBeenCalledTimes(3);
  });

  it('throws error if a fetch fails', async () => {
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue('5555');
    vi.mocked(pluginBridge.fetchPluginBridge).mockResolvedValue({ ok: false } as Response);

    await expect(triggerStudioScan()).rejects.toThrow(/Could not start a Studio scan/);
  });

  it('throws error if plugin is not connected after 5 seconds of scanning', async () => {
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue('5555');
    vi.mocked(pluginBridge.fetchPluginBridge).mockResolvedValue({ ok: true } as Response);

    vi.mocked(tauriCore.invoke)
      .mockResolvedValueOnce({ scanGeneration: 0 })
      .mockResolvedValue({ scanGeneration: 1, scanStatus: { scanning: true }, synced: false });

    const scanPromise = triggerStudioScan();
    const expectPromise = expect(scanPromise).rejects.toThrow(/Roblox Studio is not connected/);

    await vi.advanceTimersByTimeAsync(1500);

    await vi.advanceTimersByTimeAsync(4500);

    await expectPromise;
  });

  it('throws error if scan takes longer than 5 minutes', async () => {
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue('5555');
    vi.mocked(pluginBridge.fetchPluginBridge).mockResolvedValue({ ok: true } as Response);

    vi.mocked(tauriCore.invoke)
      .mockResolvedValueOnce({ scanGeneration: 0 })
      .mockResolvedValue({ scanGeneration: 1, scanStatus: { scanning: true }, synced: true });

    const scanPromise = triggerStudioScan();
    const expectPromise = expect(scanPromise).rejects.toThrow(/no progress for 5 minutes/);

    await vi.advanceTimersByTimeAsync(300000);

    await expectPromise;
  });
  it('does not claim success when the plugin has not started a scan', async () => {
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue('5555');
    vi.mocked(pluginBridge.fetchPluginBridge).mockResolvedValue({ ok: true } as Response);
    vi.mocked(tauriCore.invoke).mockResolvedValue({ scanGeneration: 0, synced: true });

    const result = expect(triggerStudioScan()).rejects.toThrow(/did not start/);
    await vi.advanceTimersByTimeAsync(22500);
    await result;
  });

  it('reports a scan aborted by Studio', async () => {
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue('5555');
    vi.mocked(pluginBridge.fetchPluginBridge).mockResolvedValue({ ok: true } as Response);
    vi.mocked(tauriCore.invoke)
      .mockResolvedValueOnce({ scanGeneration: 0 })
      .mockResolvedValue({ scanGeneration: 1, abortedScanGeneration: 1, synced: true });

    await expect(triggerStudioScan()).rejects.toThrow(/cancelled the scan/);
  });

  it('rejects scan settings that the bridge did not accept', async () => {
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue('5555');
    vi.mocked(pluginBridge.fetchPluginBridge).mockResolvedValue({ ok: false } as Response);
    vi.mocked(tauriCore.invoke).mockResolvedValue({ scanGeneration: 0 });

    await expect(triggerStudioScan({ scanTypes: ['animations'] })).rejects.toThrow(/configure/);
  });
});
