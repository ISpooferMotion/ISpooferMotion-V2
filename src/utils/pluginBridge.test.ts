import * as tauriCore from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as tauriRuntime from './tauriRuntime';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./tauriRuntime', () => ({
  isTauriRuntime: vi.fn(),
}));

describe('pluginBridge', () => {
  let mockFetch: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('fetchPluginBridge calls fetch with correct args', async () => {
    const { fetchPluginBridge } = await import('./pluginBridge');
    mockFetch.mockResolvedValue(new Response());
    await fetchPluginBridge('/api', '1234', { method: 'POST' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:1234/api',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  describe('findPluginBridgePort', () => {
    it('returns null if tauri backend throws', async () => {
      const { findPluginBridgePort } = await import('./pluginBridge');
      vi.mocked(tauriRuntime.isTauriRuntime).mockReturnValue(true);
      vi.mocked(tauriCore.invoke).mockRejectedValue(new Error('fail'));

      const result = await findPluginBridgePort();
      expect(result).toBeNull();
    });

    it('returns port if tauri backend succeeds', async () => {
      const { findPluginBridgePort } = await import('./pluginBridge');
      vi.mocked(tauriRuntime.isTauriRuntime).mockReturnValue(true);
      vi.mocked(tauriCore.invoke).mockResolvedValue(5555);

      const result = await findPluginBridgePort();
      expect(result).toBe('5555');
      expect(tauriCore.invoke).toHaveBeenCalledWith('get_plugin_bridge_port');
    });

    it('falls back to fetch if not tauri runtime', async () => {
      const { findPluginBridgePort } = await import('./pluginBridge');
      vi.mocked(tauriRuntime.isTauriRuntime).mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ app: 'ISpooferMotion', port: 14285 }),
      });

      const result = await findPluginBridgePort();
      expect(result).toBe('14285');
      expect(mockFetch).toHaveBeenCalledWith(`http://localhost:14285/health`, expect.anything());
    });

    it('returns null if fetch not ok outside tauri', async () => {
      const { findPluginBridgePort } = await import('./pluginBridge');
      vi.mocked(tauriRuntime.isTauriRuntime).mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: false });

      const result = await findPluginBridgePort();
      expect(result).toBeNull();
    });

    it('returns null if fetch succeeds but invalid payload', async () => {
      const { findPluginBridgePort } = await import('./pluginBridge');
      vi.mocked(tauriRuntime.isTauriRuntime).mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ app: 'WrongApp', port: 14285 }),
      });

      const result = await findPluginBridgePort();
      expect(result).toBeNull();
    });

    it('returns cached port if called within 1 second', async () => {
      const { findPluginBridgePort } = await import('./pluginBridge');
      vi.mocked(tauriRuntime.isTauriRuntime).mockReturnValue(true);
      vi.mocked(tauriCore.invoke).mockResolvedValue(9999);

      const result1 = await findPluginBridgePort();
      expect(result1).toBe('9999');

      vi.mocked(tauriCore.invoke).mockResolvedValue(8888);

      await vi.advanceTimersByTimeAsync(500);
      const result2 = await findPluginBridgePort();
      expect(result2).toBe('9999');

      await vi.advanceTimersByTimeAsync(1000);
      const result3 = await findPluginBridgePort();
      expect(result3).toBe('8888');
    });
  });
});
