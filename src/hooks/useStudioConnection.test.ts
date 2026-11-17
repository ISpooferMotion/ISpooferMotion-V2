import * as tauriCore from '@tauri-apps/api/core';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as pluginBridge from '../utils/pluginBridge';
import { useStudioConnection } from './useStudioConnection';

vi.mock('../utils/pluginBridge', () => ({
  findPluginBridgePort: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('useStudioConnection', () => {
  const storeData: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => storeData[key] || null),
    setItem: vi.fn((key: string, val: string) => {
      storeData[key] = val;
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(storeData)) delete storeData[k];
    }),
  };

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage);
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('initializes with disconnected state if no port found', async () => {
    (pluginBridge.findPluginBridgePort as any).mockResolvedValue(null);

    const { result } = renderHook(() => useStudioConnection());

    expect(result.current.studioConnected).toBe(false);
    expect(result.current.scanStatus).toBeNull();
  });

  it('sets connected and reads place ID if bridge port active and synced', async () => {
    (pluginBridge.findPluginBridgePort as any).mockResolvedValue(55055);
    vi.mocked(tauriCore.invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_studio_health_status') {
        return {
          synced: true,
          scanStatus: null,
          studioPlaceId: '123456789',
        };
      }
      return null;
    });

    const { result } = renderHook(() => useStudioConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.studioConnected).toBe(true);
    expect(result.current.studioPlaceId).toBe('123456789');

    expect(window.localStorage.getItem('ISpooferMotion_LastStudioPlaceId')).toBe('123456789');
  });

  it('caches and loads place ID from local storage', async () => {
    window.localStorage.setItem('ISpooferMotion_LastStudioPlaceId', '987654321');
    (pluginBridge.findPluginBridgePort as any).mockResolvedValue(null);

    const { result } = renderHook(() => useStudioConnection());

    expect(result.current.studioPlaceId).toBe('987654321');
  });

  it('updates scan status', async () => {
    (pluginBridge.findPluginBridgePort as any).mockResolvedValue(55055);
    const mockStatus = {
      scanning: true,
      current_service: 'Animations',
      scanned: 10,
      total: 100,
    };
    vi.mocked(tauriCore.invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_studio_health_status') {
        return {
          synced: true,
          scanStatus: mockStatus,
          studioPlaceId: '12345',
        };
      }
      return null;
    });

    const { result } = renderHook(() => useStudioConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.scanStatus).toEqual(mockStatus);
  });

  it('backs off polling interval on failure', async () => {
    (pluginBridge.findPluginBridgePort as any).mockResolvedValue(null);

    renderHook(() => useStudioConnection());

    await vi.advanceTimersByTimeAsync(100);

    await vi.advanceTimersByTimeAsync(1300);
    expect(pluginBridge.findPluginBridgePort).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(pluginBridge.findPluginBridgePort).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2100);
    expect(pluginBridge.findPluginBridgePort).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(pluginBridge.findPluginBridgePort).toHaveBeenCalledTimes(3);
  });
});
