// ISM-V2-PROVENANCE: D1AB0713617483065AB724AF
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Titlebar from './Titlebar';

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

// ISM-V2-PROVENANCE-END: D1AB0713617483065AB724AF
