import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as ConfigContext from '../../contexts/ConfigContext';
import * as LanguageContext from '../../contexts/LanguageContext';
import * as StudioConnectionContext from '../../contexts/StudioConnectionContext';
import AssetExplorer from './AssetExplorer';

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
