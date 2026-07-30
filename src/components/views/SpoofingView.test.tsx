import { render, screen } from '@testing-library/react';
import SpoofingView from './SpoofingView';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as LanguageContext from '../../contexts/LanguageContext';
import * as ConfigContext from '../../contexts/ConfigContext';
import * as StudioConnectionContext from '../../contexts/StudioConnectionContext';

// Contexts
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: vi.fn() }));
vi.mock('../../contexts/ConfigContext', () => ({ useConfig: vi.fn() }));
vi.mock('../../contexts/StudioConnectionContext', () => ({
  useStudioConnectionState: vi.fn(),
  useStudioConnectionDispatch: vi.fn(),
}));

// Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn().mockResolvedValue(''),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/plugin-notification', () => ({}));

// Store
vi.mock('../../stores/spooferStore', () => ({
  useSpooferStore: vi.fn((selector: any) =>
    selector({
      rootInstances: [],
      setRootInstances: vi.fn(),
      loadedFileName: null,
      setLoadedFileName: vi.fn(),
      loadedFilePath: null,
      setLoadedFilePath: vi.fn(),
      parsingFileName: null,
      setParsingFileName: vi.fn(),
      selectedAssetIds: new Set<string>(),
      setSelectedAssetIds: vi.fn(),
      spoofingLogs: [],
      setSpoofingLogs: vi.fn(),
      isSpoofing: false,
      setIsSpoofing: vi.fn(),
      spoofProgress: 0,
      setSpoofProgress: vi.fn(),
      spoofStatusText: '',
      setSpoofStatusText: vi.fn(),
      spoofCurrentCount: 0,
      setSpoofCurrentCount: vi.fn(),
      spoofTotalCount: 0,
      setSpoofTotalCount: vi.fn(),
      spoofStartTime: null,
      setSpoofStartTime: vi.fn(),
      lastReplacements: {},
      setLastReplacements: vi.fn(),
      isReplacing: false,
      setIsReplacing: vi.fn(),
      replaceError: false,
      setReplaceError: vi.fn(),
      spoofCompletionVersion: 0,
      incrementSpoofCompletionVersion: vi.fn(),
      activeSpooferJobId: null,
      setActiveSpooferJobId: vi.fn(),
      isJobPaused: false,
      setIsJobPaused: vi.fn(),
      lastAssetResults: [],
      setLastAssetResults: vi.fn(),
      isScanningStudio: false,
      setIsScanningStudio: vi.fn(),
      showAdvanced: false,
      setShowAdvanced: vi.fn(),
      keyframeWarningCount: 0,
      setKeyframeWarningCount: vi.fn(),
      assetMetadataMap: {},
      setAssetMetadataMap: vi.fn(),
    }),
  ),
  applyReplacements: vi.fn(),
}));

// Utilities
vi.mock('../../utils/debugLogger', () => ({ addDebugLog: vi.fn() }));
vi.mock('../../utils/spoofingLogs', () => ({ appendSpoofingLog: vi.fn() }));
vi.mock('../../utils/studioBridge', () => ({
  queueStudioReplacements: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../utils/studioScan', () => ({ triggerStudioScan: vi.fn().mockResolvedValue(null) }));
vi.mock('../../utils/tauriRuntime', () => ({ isTauriRuntime: vi.fn().mockReturnValue(true) }));
vi.mock('../../utils/apiClient', () => ({
  getStudioPlaceIdFallback: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../utils/robloxProfiles', () => ({
  loadCachedGroups: vi.fn().mockResolvedValue([]),
  loadCachedUsers: vi.fn().mockResolvedValue([]),
  logIsm: vi.fn(),
  normalizeId: vi.fn((id: string) => id),
  saveCachedGroups: vi.fn(),
  validateCookieProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../utils/jobTypes', () => ({
  takeSpoofRetry: vi.fn().mockReturnValue(null),
}));
vi.mock('../../utils/pluginBridge', () => ({}));

vi.mock('./spoofing/SpoofingControls', () => ({
  SpoofingControls: () => <div data-testid="spoofing-controls">SpoofingControls</div>,
}));
vi.mock('./spoofing/SpoofingCustomAssets', () => ({
  SpoofingCustomAssets: () => <div data-testid="spoofing-custom-assets">SpoofingCustomAssets</div>,
}));
vi.mock('./spoofing/ExecutionLogs', () => ({
  default: () => <div data-testid="execution-logs">ExecutionLogs</div>,
}));
vi.mock('./spoofing/SpoofingHeader', () => ({
  SpoofProgressText: () => <span data-testid="spoof-progress-text" />,
  SpoofProgressOverlay: () => <div data-testid="spoof-progress-overlay" />,
}));
vi.mock('./spoofing/ProfileDropdowns', () => ({
  AccountSwitcher: () => <div data-testid="account-switcher">AccountSwitcher</div>,
  AvatarDropdown: () => <div data-testid="avatar-dropdown">AvatarDropdown</div>,
  GroupDropdown: () => <div data-testid="group-dropdown">GroupDropdown</div>,
  parseAudioQuota: vi.fn().mockReturnValue(null),
}));
vi.mock('./config/CredentialsSection', () => ({
  default: () => <div data-testid="credentials-section">CredentialsSection</div>,
}));
vi.mock('./config/UploadSection', () => ({
  default: () => <div data-testid="upload-section">UploadSection</div>,
}));
vi.mock('./config/RoutingSection', () => ({
  default: () => <div data-testid="routing-section">RoutingSection</div>,
}));
vi.mock('./config/ExclusionsSection', () => ({
  default: () => <div data-testid="exclusions-section">ExclusionsSection</div>,
}));
vi.mock('./settings/AdvancedSection', () => ({
  default: () => <div data-testid="advanced-section">AdvancedSection</div>,
}));
vi.mock('../modals/ResultsModal', () => ({
  default: () => null,
}));

// Framer Motion (no animation in tests)
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, prop) => {
        const El = ({ children, ...rest }: any) => {
          const {
            variants: _v,
            initial: _i,
            animate: _a,
            exit: _e,
            layout: _l,
            ...domProps
          } = rest;
          return <div {...domProps}>{children}</div>;
        };
        El.displayName = String(prop);
        return El;
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Globals
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mockConfig = {
  ui: { transparency: true },
  spoofing: {
    selectedUser: 'none',
    selectedGroup: 'none',
    cookie: '',
    apiKey: '',
    audio: false,
    extraAssetIds: [],
    uploadTypes: [],
  },
  advanced: {
    clipboardMonitoring: false,
    forcePlaceIds: '',
    spoofSounds: false,
  },
};

describe('SpoofingView', () => {
  const mockT = vi.fn((key: string) => key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({
      t: mockT,
      lang: 'en',
      setLang: vi.fn(),
    } as any);
    vi.mocked(ConfigContext.useConfig).mockReturnValue({
      config: mockConfig,
      updateConfig: vi.fn(),
      updateCategory: vi.fn(),
    } as any);
    vi.mocked(StudioConnectionContext.useStudioConnectionState).mockReturnValue({
      studioConnected: false,
      scanStatus: 'idle',
      logs: [],
      loading: false,
      clientVersion: '1.0',
    } as any);
  });

  it('renders without crashing', () => {
    render(<SpoofingView />);
    // The view's outer wrapper must be present
    expect(document.querySelector('.w-full.h-full')).toBeInTheDocument();
  });

  it('renders credentials section', () => {
    render(<SpoofingView />);
    expect(screen.getByTestId('credentials-section')).toBeInTheDocument();
  });

  it('renders avatar and group dropdowns', () => {
    render(<SpoofingView />);
    expect(screen.getByTestId('avatar-dropdown')).toBeInTheDocument();
    expect(screen.getByTestId('group-dropdown')).toBeInTheDocument();
  });

  it('renders custom assets panel', () => {
    render(<SpoofingView />);
    expect(screen.getByTestId('spoofing-custom-assets')).toBeInTheDocument();
  });

  it('renders execution logs', () => {
    render(<SpoofingView />);
    expect(screen.getByTestId('execution-logs')).toBeInTheDocument();
  });

  it('renders spoofing controls', () => {
    render(<SpoofingView />);
    expect(screen.getByTestId('spoofing-controls')).toBeInTheDocument();
  });
});
