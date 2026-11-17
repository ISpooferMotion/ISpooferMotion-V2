import { invoke } from '@tauri-apps/api/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Titlebar from './Titlebar';

const { options, minimize, hide } = vi.hoisted(() => ({
  options: { hideToTrayOnClose: false },
  minimize: vi.fn().mockResolvedValue(undefined),
  hide: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isAlwaysOnTop: vi.fn().mockResolvedValue(false),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    minimize,
    hide,
  }),
}));

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../contexts/ConfigContext', () => ({
  useConfig: () => ({
    config: {
      general: options,
      debug: { debugMode: false },
      ui: { activeTab: 'spoofing' },
      spoofing: { downloadOnly: false },
    },
    updateConfig: vi.fn(),
  }),
}));

vi.mock('../../stores/spooferStore', () => ({
  useSpooferStore: vi.fn((selector) => {
    const store = {
      showAdvanced: false,
      setShowAdvanced: vi.fn(),
      loadedFileName: null,
      searchQuery: '',
      setSearchQuery: vi.fn(),
      activeAssetFilters: [],
      setActiveAssetFilters: vi.fn(),
    };
    return selector(store);
  }),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

describe('Titlebar Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    options.hideToTrayOnClose = false;
  });

  it('renders window controls cleanly', async () => {
    const { container } = render(<Titlebar />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('minimizes rather than hiding the last window when system tray is unavailable', async () => {
    options.hideToTrayOnClose = true;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_runtime_info') return { trayAvailable: false };
      return null;
    });
    render(<Titlebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    await waitFor(() => expect(minimize).toHaveBeenCalledOnce());
    expect(hide).not.toHaveBeenCalled();
  });

  it('hides to tray when tray initialization succeeded', async () => {
    options.hideToTrayOnClose = true;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_runtime_info') return { trayAvailable: true };
      return null;
    });
    render(<Titlebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    await waitFor(() => expect(hide).toHaveBeenCalledOnce());
    expect(minimize).not.toHaveBeenCalled();
  });
});
