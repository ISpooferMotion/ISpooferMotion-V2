import { invoke } from '@tauri-apps/api/core';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as ConfigContext from '../../contexts/ConfigContext';
import * as LanguageContext from '../../contexts/LanguageContext';
import * as ConfigStore from '../../stores/configStore';
import ActivityView from './ActivityView';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('../../contexts/ConfigContext', () => ({
  useConfig: vi.fn(),
}));

vi.mock('../../stores/spooferStore', () => ({
  useSpooferStore: vi.fn(),
}));

vi.mock('../../stores/configStore', () => ({
  useConfigStore: vi.fn(),
}));

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('ActivityView', () => {
  const mockT = vi.fn((key) => key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({ t: mockT } as any);
    vi.mocked(ConfigContext.useConfig).mockReturnValue({
      config: { ui: { transparency: true } },
    } as any);
    vi.mocked(ConfigStore.useConfigStore).mockReturnValue({} as any);
  });

  it('renders history correctly', async () => {
    vi.mocked(invoke).mockResolvedValue([
      {
        id: '1',
        status: 'successful',
        startTime: '12:00:00',
        endTime: '12:01:00',
        durationMs: 60000,
        account: { id: '1', name: 'TestUser', avatarUrl: '' },
        assetResults: [{ id: '123', name: 'TestFile.rbxlx', success: true }],
        config: { assets: '[]', spoofSounds: false, downloadOnly: false },
        logFilePath: '',
      },
    ]);

    render(<ActivityView />);

    expect(await screen.findByText('activity.spoofedTo')).toBeInTheDocument();
  });
});
