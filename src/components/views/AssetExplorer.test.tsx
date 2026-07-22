import { render } from '@testing-library/react';
import AssetExplorer from './AssetExplorer';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as LanguageContext from '../../contexts/LanguageContext';
import * as ConfigContext from '../../contexts/ConfigContext';
import * as StudioConnectionContext from '../../contexts/StudioConnectionContext';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('../../contexts/ConfigContext', () => ({
  useConfig: vi.fn(),
}));

vi.mock('../../contexts/StudioConnectionContext', () => ({
  useStudioConnectionState: vi.fn(),
  useStudioConnectionDispatch: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  })),
}));

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('./asset-explorer/ExplorerToolbar', () => ({
  ExplorerToolbar: () => <div data-testid="explorer-toolbar">Toolbar</div>,
}));

vi.mock('./asset-explorer/ExplorerTree', () => ({
  ExplorerTreeNode: () => <div data-testid="explorer-tree">Tree</div>,
}));

describe('AssetExplorer', () => {
  const mockT = vi.fn((key) => key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({ t: mockT } as any);
    vi.mocked(ConfigContext.useConfig).mockReturnValue({
      config: {
        ui: { transparency: true },
        advanced: { skipOwned: false, excludedUserIds: '', excludedGroupIds: '' },
        spoofing: { cookie: '', selectedUser: '0', selectedGroup: '0' },
      },
    } as any);
    const mockStudioState = vi.fn().mockReturnValue({
      studioConnected: true,
      scanStatus: 'idle',
      logs: [],
      loading: false,
      clientVersion: '1.0',
    });
    vi.mocked(StudioConnectionContext.useStudioConnectionState).mockImplementation(mockStudioState);
  });

  it('renders components correctly', () => {
    render(<AssetExplorer isOpen={true} setIsOpen={() => {}} />);

    // Assert that the component mounted without throwing
    expect(document.querySelector('button')).toBeInTheDocument();
  });
});
