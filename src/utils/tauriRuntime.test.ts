import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMemoryInjectionSupported, isTauriRuntime } from './tauriRuntime';

describe('tauriRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('returns false for isTauriRuntime when not in Tauri', () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns true for isTauriRuntime when in Tauri', () => {
    (window as any).__TAURI_INTERNALS__ = { invoke: () => {}, transformCallback: () => {} };
    expect(isTauriRuntime()).toBe(true);
  });

  it('isMemoryInjectionSupported returns false outside tauri', async () => {
    expect(await isMemoryInjectionSupported()).toBe(false);
  });

  it('isMemoryInjectionSupported detects windows', async () => {
    (window as any).__TAURI_INTERNALS__ = { invoke: () => {}, transformCallback: () => {} };
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockResolvedValue({ platform: 'windows' }),
    }));

    const module = await import('./tauriRuntime');
    expect(await module.isMemoryInjectionSupported()).toBe(true);
  });

  it('isMemoryInjectionSupported returns false on non-windows', async () => {
    (window as any).__TAURI_INTERNALS__ = { invoke: () => {}, transformCallback: () => {} };
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockResolvedValue({ platform: 'macos' }),
    }));

    const module = await import('./tauriRuntime');
    expect(await module.isMemoryInjectionSupported()).toBe(false);
  });
});
