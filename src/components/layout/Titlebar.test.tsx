import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Titlebar from './Titlebar';

// Mock contexts and stores
vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../contexts/ConfigContext', () => ({
  useConfig: () => ({
    config: {
      general: { hideToTrayOnClose: false },
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

// Mock Tauri utils
vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

describe('Titlebar Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders window controls cleanly', async () => {
    const { container } = render(<Titlebar />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
