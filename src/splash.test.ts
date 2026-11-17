import { fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runSplashFlow } from './splash';

const { checkUpdate, relaunchApp, callBackend } = vi.hoisted(() => ({
  checkUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  callBackend: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkUpdate }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: relaunchApp }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: callBackend }));

const setSplashElements = () => {
  document.body.innerHTML = `
    <span id="status-text"></span>
    <div id="spinner"></div>
    <div id="update-actions" class="hidden"></div>
    <button id="btn-skip">Skip</button>
    <button id="btn-download">Download</button>
  `;
};

describe('splash startup recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSplashElements();
    callBackend.mockImplementation((cmd: string) => Promise.resolve(cmd === 'close_splashscreen'));
  });

  it('opens the app when the update check fails', async () => {
    checkUpdate.mockRejectedValue(new Error('Network unavailable'));
    await runSplashFlow();

    expect(callBackend).toHaveBeenCalledWith('sync_roblox_plugin');
    expect(callBackend).toHaveBeenCalledWith('close_splashscreen');
  });

  it('opens the current version after an update download fails', async () => {
    checkUpdate.mockResolvedValue({
      available: true,
      version: '3.0',
      downloadAndInstall: vi.fn().mockRejectedValue(new Error('Disk full')),
    });

    const startup = runSplashFlow();
    await waitFor(() => {
      expect(document.getElementById('btn-download')?.onclick).toBeTypeOf('function');
    });
    fireEvent.click(document.getElementById('btn-download')!);
    await startup;

    expect(callBackend).toHaveBeenCalledWith('close_splashscreen');
    expect(relaunchApp).not.toHaveBeenCalled();
  });

  it('keeps a visible error if the main window cannot open', async () => {
    checkUpdate.mockResolvedValue(null);
    callBackend.mockImplementation((cmd: string) => Promise.resolve(cmd !== 'close_splashscreen'));

    await runSplashFlow();

    expect(document.getElementById('status-text')).toHaveTextContent('Unable to open');
  });

  it('does not open the old version after a successful relaunch request', async () => {
    checkUpdate.mockResolvedValue({
      available: true,
      version: '3.0',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    });
    relaunchApp.mockResolvedValue(undefined);

    const startup = runSplashFlow();
    await waitFor(() => {
      expect(document.getElementById('btn-download')?.onclick).toBeTypeOf('function');
    });
    fireEvent.click(document.getElementById('btn-download')!);
    await startup;

    expect(relaunchApp).toHaveBeenCalledTimes(1);
    expect(callBackend).not.toHaveBeenCalledWith('close_splashscreen');
  });
});
