import * as tauriCore from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_CONFIG, useConfigStore } from './configStore';

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
    useConfigStore.setState({ accountSecrets: {}, secretsLoaded: false });
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

    useConfigStore.setState({ secretsLoaded: true });

    useConfigStore
      .getState()
      .updateCategory('spoofing', { cookie: 'new_cookie', apiKey: 'new_key' });
    await useConfigStore.getState().saveSecrets();

    expect(invokeMock).toHaveBeenCalledWith('save_profile_secrets', {
      data: {
        cookie: 'new_cookie',
        apiKey: 'new_key',
        groupApiKey: '',
        profileCookies: {},
        accountSecrets: {},
      },
    });
  });

  it('does not save secrets before the initial load completes', async () => {
    const invokeMock = (tauriCore.invoke as any).mockResolvedValueOnce(undefined);
    useConfigStore.setState({ secretsLoaded: false });

    useConfigStore
      .getState()
      .updateCategory('spoofing', { cookie: 'race_cookie', apiKey: 'race_key' });
    await useConfigStore.getState().saveSecrets();

    expect(invokeMock).not.toHaveBeenCalled();
  });
  it('removes deleted account credentials from memory and the saved snapshot', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue(undefined);
    useConfigStore.setState({
      secretsLoaded: true,
      accountSecrets: { removed: { cookie: 'secret' }, retained: { apiKey: 'remaining' } },
    });
    useConfigStore
      .getState()
      .updateAccountsList([
        { id: 'retained', name: 'Remaining', isDownloader: true, isUploader: true },
      ]);
    await useConfigStore.getState().saveSecrets();

    expect(useConfigStore.getState().accountSecrets).toEqual({ retained: { apiKey: 'remaining' } });
    const calls = vi
      .mocked(tauriCore.invoke)
      .mock.calls.filter(([command]) => command === 'save_profile_secrets');
    expect(calls).not.toHaveLength(0);
    expect(calls.at(-1)?.[1]).toMatchObject({
      data: { accountSecrets: { retained: { apiKey: 'remaining' } } },
    });
  });

  it('serializes overlapping secret saves so the latest credentials win', async () => {
    let finishFirst: (() => void) | undefined;
    const saveCalls: Array<Record<string, unknown>> = [];
    vi.mocked(tauriCore.invoke).mockImplementation((command, args) => {
      if (command !== 'save_profile_secrets') return Promise.resolve(null);
      saveCalls.push(args as Record<string, unknown>);
      if (saveCalls.length === 1) {
        return new Promise((resolve) => {
          finishFirst = () => resolve(null);
        });
      }
      return Promise.resolve(null);
    });
    useConfigStore.setState({ secretsLoaded: true });
    useConfigStore.getState().updateCategory('spoofing', { cookie: 'before' });
    await vi.waitFor(() => expect(saveCalls).toHaveLength(1));
    useConfigStore.getState().updateCategory('spoofing', { cookie: 'after' });
    expect(saveCalls).toHaveLength(1);
    finishFirst?.();
    await useConfigStore.getState().saveSecrets();
    expect(saveCalls.length).toBeGreaterThanOrEqual(2);
    expect((saveCalls.at(-1)?.data as { cookie: string }).cookie).toBe('after');
  });
  it('does not resurrect deleted credentials when a late secret load completes', async () => {
    let resolveLoad: ((value: unknown) => void) | undefined;
    vi.mocked(tauriCore.invoke).mockImplementation((command) => {
      if (command === 'load_profile_secrets') {
        return new Promise((resolve) => {
          resolveLoad = resolve;
        });
      }
      return Promise.resolve(null);
    });

    useConfigStore
      .getState()
      .updateAccountsList([
        { id: 'removed', name: 'Account', isDownloader: true, isUploader: false },
      ]);
    const loading = useConfigStore.getState().loadSecrets();
    await vi.waitFor(() => expect(resolveLoad).toBeDefined());
    useConfigStore.getState().updateAccountsList([]);
    resolveLoad?.({ accountSecrets: { removed: { cookie: 'old-cookie' } } });
    await loading;

    expect(useConfigStore.getState().accountSecrets).toEqual({});
    const saves = vi
      .mocked(tauriCore.invoke)
      .mock.calls.filter(([command]) => command === 'save_profile_secrets');
    expect(saves.at(-1)?.[1]).toMatchObject({ data: { accountSecrets: {} } });
  });
});
