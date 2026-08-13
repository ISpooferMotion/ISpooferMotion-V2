import { render, screen } from '@testing-library/react';
import SettingsView from './SettingsView';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as LanguageContext from '../../contexts/LanguageContext';

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

// Mock ResizeObserver and IntersectionObserver for Lenis/Scrollspy
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
