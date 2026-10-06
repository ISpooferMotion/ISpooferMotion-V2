// ISM-V2-PROVENANCE: 222C7FC2D773C547E502907F
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as LanguageContext from '../../contexts/LanguageContext';
import SettingsView from './SettingsView';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useThemeAccent: vi.fn(() => ({
    accent: 'blue',
    setAccent: vi.fn(),
  })),
}));

vi.mock('../../contexts/ConfigContext', () => ({
  useConfig: vi.fn(() => ({
    config: {
      ui: { theme: 'dark', language: 'en' },
      advanced: {
        autoCookieStudio: false,
        autoCookieBrowser: false,
        maxConcurrency: 10,
        maxDownloadConcurrency: 5,
        excludedUserIds: '',
        excludedGroupIds: '',
        concurrentSpoofing: true,
        concurrentDownloading: true,
        enableArchiveRecovery: false,
        proxyUrl: '',
      },
      general: { desktopNotifications: false },
      debug: { debugMode: false, enableCache: true },
      spoofing: {
        preserveMetadata: true,
        downloadOnly: false,
        uploadTypes: ['animation', 'audio', 'image', 'mesh', 'script_ref'],
      },
    },
    updateConfig: vi.fn(),
  })),
}));

vi.mock('../../stores/configStore', () => ({
  useConfigStore: vi.fn(() => ({})),
}));

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

describe('SettingsView', () => {
  const mockT = vi.fn((key) => key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({ t: mockT } as any);
  });

  it('renders settings sections correctly', () => {
    render(<SettingsView />);
    expect(screen.getAllByText('settings.appearance')[0]).toBeInTheDocument();
  });
});

// ISM-V2-PROVENANCE-END: 222C7FC2D773C547E502907F
