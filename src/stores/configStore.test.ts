import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useConfigStore, DEFAULT_APP_CONFIG } from './configStore';
import * as tauriCore from '@tauri-apps/api/core';

vi.mock('../utils/tauriRuntime', () => ({
  isTauriRuntime: vi.fn().mockReturnValue(true),
}));

describe('configStore', () => {
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
    localStorage.clear();
    useConfigStore.getState().resetConfig();
    vi.clearAllMocks();
  });

  it('initializes with default config', () => {
    const { config } = useConfigStore.getState();
    expect(config).toEqual(DEFAULT_APP_CONFIG);
  });

  it('updates a specific config value', () => {
    useConfigStore.getState().updateConfig('general', 'desktopNotifications', false);
    const { config } = useConfigStore.getState();
    expect(config.general.desktopNotifications).toBe(false);
  });

  it('updates an entire category', () => {
    useConfigStore
      .getState()
      .updateCategory('spoofing', { cookie: 'test_cookie', apiKey: 'test_key' });
    const { config } = useConfigStore.getState();
    expect(config.spoofing.cookie).toBe('test_cookie');
    expect(config.spoofing.apiKey).toBe('test_key');
  });

  it('resets to default config', () => {
    useConfigStore.getState().updateConfig('general', 'desktopNotifications', false);
    useConfigStore.getState().resetConfig();
    const { config } = useConfigStore.getState();
    expect(config.general.desktopNotifications).toBe(true);
  });

  it('loads secrets from backend', async () => {
    const invokeMock = (tauriCore.invoke as any).mockResolvedValueOnce({
      cookie: 'backend_cookie',
      apiKey: 'backend_key',
    });

    await useConfigStore.getState().loadSecrets();
    const { config } = useConfigStore.getState();

    expect(invokeMock).toHaveBeenCalledWith('load_profile_secrets');
    expect(config.spoofing.cookie).toBe('backend_cookie');
    expect(config.spoofing.apiKey).toBe('backend_key');
  });

  it('saves secrets to backend', async () => {
    const invokeMock = (tauriCore.invoke as any).mockResolvedValueOnce(undefined);

    // saveSecrets is gated on secretsLoaded so the restart cookie-auto-detect
    // race can't wipe a not-yet-loaded API key. Simulate a completed load.
    useConfigStore.setState({ secretsLoaded: true });

    useConfigStore
      .getState()
      .updateCategory('spoofing', { cookie: 'new_cookie', apiKey: 'new_key' });
    await useConfigStore.getState().saveSecrets();

    expect(invokeMock).toHaveBeenCalledWith('save_profile_secrets', {
      data: {
        cookie: 'new_cookie',
        apiKey: 'new_key',
        profileCookies: {},
        accountSecrets: {},
      },
    });
  });

  it('does not save secrets before the initial load completes', async () => {
    // Guards the restart race: cookie auto-detect fires saveSecrets on mount
    // before loadSecrets() has restored the API key. Without this guard, that
    // save reads apiKey='' and overwrites the persisted key with empty.
    const invokeMock = (tauriCore.invoke as any).mockResolvedValueOnce(undefined);
    useConfigStore.setState({ secretsLoaded: false });

    useConfigStore
      .getState()
      .updateCategory('spoofing', { cookie: 'race_cookie', apiKey: 'race_key' });
    await useConfigStore.getState().saveSecrets();

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
