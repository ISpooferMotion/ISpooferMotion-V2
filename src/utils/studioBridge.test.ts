import * as tauriCore from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as debugLogger from './debugLogger';
import * as pluginBridge from './pluginBridge';
import { queueStudioReplacements } from './studioBridge';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./debugLogger', () => ({
  addDebugLog: vi.fn(),
}));

vi.mock('./pluginBridge', () => ({
  findPluginBridgePort: vi.fn(),
  DEFAULT_PLUGIN_PORT: '14285',
}));

describe('studioBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing if replacements empty', async () => {
    await queueStudioReplacements({});
    expect(debugLogger.addDebugLog).toHaveBeenCalled();
    expect(tauriCore.invoke).not.toHaveBeenCalled();
  });

  it('throws error on plugin_not_connected', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue('plugin_not_connected');
    await expect(queueStudioReplacements({ a: 'b' })).rejects.toThrow(/Could not reach/);
  });

  it('throws error on bridge_unavailable', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue('bridge_unavailable');
    await expect(queueStudioReplacements({ a: 'b' })).rejects.toThrow(/Could not reach/);
  });

  it('throws error on empty_mappings', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue('empty_mappings');
    await expect(queueStudioReplacements({ a: 'b' })).rejects.toThrow(/No valid asset/);
  });

  it('succeeds normally', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue(true);
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue('1234');
    await queueStudioReplacements({ a: 'b' });
    expect(tauriCore.invoke).toHaveBeenCalledWith('push_to_studio', {
      replacementsMap: { a: 'b' },
      pluginPort: '1234',
    });
  });

  it('falls back to default plugin port if findPluginBridgePort returns null', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue(true);
    vi.mocked(pluginBridge.findPluginBridgePort).mockResolvedValue(null);
    await queueStudioReplacements({ a: 'b' });
    expect(tauriCore.invoke).toHaveBeenCalledWith('push_to_studio', {
      replacementsMap: { a: 'b' },
      pluginPort: '14285',
    });
  });
});
