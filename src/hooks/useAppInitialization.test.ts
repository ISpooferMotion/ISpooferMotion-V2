import { renderHook, act } from '@testing-library/react';
import { useAppInitialization } from './useAppInitialization';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';

import { DEFAULT_APP_CONFIG, useConfigStore } from '../stores/configStore';

// Mock Tauri plugin HTTP so we don't actually fetch
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

// Mock tauriRuntime utility
vi.mock('../utils/tauriRuntime', () => ({
  isTauriRuntime: vi.fn(() => true),
}));

// Mock the shortcut plugin
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  isRegistered: vi.fn().mockResolvedValue(false),
  register: vi.fn().mockResolvedValue(undefined),
  unregister: vi.fn().mockResolvedValue(undefined),
}));

describe('useAppInitialization', () => {
  let mockFetch: any;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useConfigStore.setState({ config: DEFAULT_APP_CONFIG });
    (tauriCore.invoke as any).mockImplementation((command: string) => {
      if (command === 'check_roblox_api_status') return Promise.resolve(true);
      return Promise.resolve(null);
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );

    const tauriHttp = await import('@tauri-apps/plugin-http');
    mockFetch = tauriHttp.fetch as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes with default state', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    );

    const { result } = renderHook(() => useAppInitialization());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isRobloxApiDown).toBe(false);
    expect(result.current.maintenance.mode).toBe(false);
  });

  it('sets Roblox API down if check_roblox_api_status returns false', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    );

    (tauriCore.invoke as any).mockImplementationOnce((cmd: string) => {
      if (cmd === 'check_roblox_api_status') return Promise.resolve(false);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useAppInitialization());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.isRobloxApiDown).toBe(true);
  });

  it('sets maintenance mode if config returns true', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ maintenanceMode: true, maintenanceMessage: 'Down for updates' }),
      }),
    );

    const { result } = renderHook(() => useAppInitialization());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.maintenance.mode).toBe(true);
    expect(result.current.maintenance.message).toBe('Down for updates');
  });

  it('clears maintenance mode when the server reports recovery', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ maintenanceMode: true, maintenanceMessage: 'Down for updates' }),
      })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ maintenanceMode: false }) });

    const { result, rerender } = renderHook(() => useAppInitialization());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.maintenance.mode).toBe(true);

    act(() => {
      useConfigStore.setState((state) => ({
        config: {
          ...state.config,
          general: {
            ...state.config.general,
            telemetryEnabled: false,
          },
        },
      }));
    });
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.maintenance).toEqual({ mode: false, message: '' });
  });

  it('disables cache contributions and heartbeat even if config fetch fails', async () => {
    useConfigStore.setState((state) => ({
      config: {
        ...state.config,
        general: {
          ...state.config.general,
          telemetryEnabled: false,
        },
      },
    }));
    mockFetch.mockRejectedValue(new Error('offline'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderHook(() => useAppInitialization());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(tauriCore.invoke).toHaveBeenCalledWith('initialize_remote_cache', { pushUrl: null });
    expect(mockFetch.mock.calls.some(([url]: [string]) => url.endsWith('/api/dev/heartbeat'))).toBe(
      false,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Could not connect to app config server:',
      expect.any(Error),
    );
  });

  it('does not let a stale config response re-enable cache contributions after opt-out', async () => {
    let resolveConfig!: (value: {
      ok: boolean;
      json: () => Promise<{ communityCacheUrl: string }>;
    }) => void;
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/api/config')) {
        return new Promise((resolve) => {
          resolveConfig = resolve;
        });
      }
      return Promise.resolve({ ok: true });
    });

    renderHook(() => useAppInitialization());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      useConfigStore.setState((state) => ({
        config: {
          ...state.config,
          general: {
            ...state.config.general,
            telemetryEnabled: false,
          },
        },
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    resolveConfig({
      ok: true,
      json: () => Promise.resolve({ communityCacheUrl: 'https://cache.example.test/write' }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const cacheCalls = vi
      .mocked(tauriCore.invoke)
      .mock.calls.filter(([command]) => command === 'initialize_remote_cache');
    expect(cacheCalls).toEqual([['initialize_remote_cache', { pushUrl: null }]]);
  });

  it('registers keyboard shortcuts and events on mount', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    );

    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAppInitialization());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(addEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
