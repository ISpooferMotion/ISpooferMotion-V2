import { z } from 'zod';
import { create } from 'zustand';

import { isTauriRuntime } from '../utils/tauriRuntime';

export const AppConfigSchema = z.object({
  general: z.object({
    desktopNotifications: z.boolean().default(true),
    hideToTrayOnClose: z.boolean().default(false),
    telemetryEnabled: z.boolean().default(true),
  }),
  advanced: z.object({
    autoCookieStudio: z.boolean().default(true),
    autoCookieBrowser: z.boolean().default(false),
    skipOwned: z.boolean().default(false),
    enablePluginSpoofing: z.boolean().default(false),
    memoryInjectionEnabled: z.boolean().default(false),
    clipboardMonitoring: z.boolean().default(false),
    forcePlaceIds: z.string().default(''),
    excludedUserIds: z.string().default(''),
    excludedGroupIds: z.string().default(''),
    concurrentSpoofing: z.boolean().default(true),
    concurrentDownloading: z.boolean().default(true),

    maxConcurrency: z.number().min(1).max(100).catch(100).default(100),
    maxDownloadConcurrency: z.number().min(1).max(100).catch(10).default(10),
    discoveryConcurrency: z.number().min(1).max(50).catch(30).default(30),
    operationPollIntervalMs: z.number().min(100).max(2000).catch(250).default(250),
    batchSize: z.number().min(10).max(500).catch(250).default(250),
    enableArchiveRecovery: z.boolean().default(false),
    proxyUrl: z.string().default(''),
  }),
  debug: z.object({
    debugMode: z.boolean().default(false),
    enableCache: z.boolean().default(true),
  }),
  spoofing: z.object({
    selectedUser: z.string().default('none'),
    selectedGroup: z.string().default('none'),
    animation: z.boolean().default(true),
    audio: z.boolean().default(true),
    images: z.boolean().default(true),
    meshes: z.boolean().default(true),
    videos: z.boolean().default(true),
    scriptRefs: z.boolean().default(true),
    cookie: z.string().default(''),
    apiKey: z.string().default(''),
    groupApiKey: z.string().default(''),
    enableSpoofing: z.boolean().default(false),
    uploadTypes: z.array(z.string()).default(['animation', 'audio', 'image', 'mesh', 'script_ref']),
    downloadOnly: z.boolean().default(false),
    downloadPath: z.string().default(''),
    extraAssetIds: z.string().default(''),
    preserveMetadata: z.boolean().default(true),
  }),
  permissions: z.object({
    enabled: z.boolean().default(false),

    subjectType: z.enum(['experience', 'user', 'group']).default('experience'),

    subjectIds: z.string().default(''),

    action: z.literal('Use').default('Use'),
  }),
  ui: z.object({
    activeTab: z.string().default('spoofing'),
    assetExplorerOpen: z.boolean().default(false),
    homeUpdateSections: z.array(z.string()).default(['changelog']),
    settingsSections: z.array(z.string()).default(['account', 'general', 'quickSettings', 'debug']),
    configSections: z
      .array(z.string())
      .default(['credentials', 'assetProcessing', 'routing', 'exclusions']),
    spoofingSections: z.array(z.string()).default(['targets', 'execution']),
    tutorialCompleted: z.boolean().default(false),
  }),
  accounts: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        avatarUrl: z.string().optional(),
        isDownloader: z.boolean().default(false),
        isUploader: z.boolean().default(false),
        cookieValidated: z.boolean().optional(),
        apiKeyValidated: z.boolean().optional(),
      }),
    )
    .default([]),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const DEFAULT_APP_CONFIG: AppConfig = {
  general: {
    desktopNotifications: true,
    hideToTrayOnClose: false,
    telemetryEnabled: true,
  },
  advanced: {
    autoCookieStudio: true,
    autoCookieBrowser: false,
    skipOwned: false,
    enablePluginSpoofing: false,
    memoryInjectionEnabled: false,
    clipboardMonitoring: false,
    forcePlaceIds: '',
    excludedUserIds: '',
    excludedGroupIds: '',
    concurrentSpoofing: true,
    concurrentDownloading: true,
    maxConcurrency: 100,
    maxDownloadConcurrency: 10,
    discoveryConcurrency: 30,
    operationPollIntervalMs: 250,
    batchSize: 250,
    enableArchiveRecovery: false,
    proxyUrl: '',
  },
  debug: {
    debugMode: false,
    enableCache: true,
  },
  spoofing: {
    selectedUser: 'none',
    selectedGroup: 'none',
    animation: true,
    audio: true,
    images: true,
    meshes: true,
    videos: true,
    scriptRefs: true,
    cookie: '',
    apiKey: '',
    groupApiKey: '',
    enableSpoofing: false,
    uploadTypes: ['animation', 'audio', 'image', 'mesh', 'script_ref'],
    downloadOnly: false,
    downloadPath: '',
    extraAssetIds: '',
    preserveMetadata: true,
  },
  permissions: {
    enabled: false,
    subjectType: 'experience' as const,
    subjectIds: '',
    action: 'Use' as const,
  },
  ui: {
    activeTab: 'spoofing',
    assetExplorerOpen: false,
    homeUpdateSections: ['changelog'],
    settingsSections: ['account', 'general', 'quickSettings', 'debug'],
    configSections: ['credentials', 'assetProcessing', 'routing', 'exclusions'],
    spoofingSections: ['targets', 'execution'],
    tutorialCompleted: false,
  },
  accounts: [],
};

const mergeKnownKeys = <T extends Record<string, unknown>>(
  defaults: T,
  saved: Partial<T> | undefined,
): T => {
  const next = { ...defaults };
  Object.keys(defaults).forEach((key) => {
    if (saved && Object.prototype.hasOwnProperty.call(saved, key)) {
      next[key as keyof T] = saved[key as keyof T] as T[keyof T];
    }
  });
  return next;
};

const mergeSections = (savedSections: unknown, defaultSections: string[]) => {
  if (!Array.isArray(savedSections)) return defaultSections;
  const next = savedSections.filter((section: string) => defaultSections.includes(section));
  return next.length > 0 ? next : defaultSections;
};

interface ConfigState {
  config: AppConfig;
  accountSecrets: Record<string, { cookie?: string; apiKey?: string }>;

  secretsLoaded: boolean;
  updateConfig: <C extends keyof AppConfig, K extends keyof AppConfig[C]>(
    c: C,
    k: K,
    v: AppConfig[C][K],
  ) => void;
  updateCategory: <C extends keyof AppConfig>(c: C, vals: Partial<AppConfig[C]>) => void;
  resetConfig: () => void;
  loadSecrets: () => Promise<void>;
  saveSecrets: () => Promise<void>;
  updateAccountSecret: (accountId: string, cookie?: string, apiKey?: string) => Promise<void>;
  updateAccountsList: (accounts: AppConfig['accounts']) => void;
}

export const useConfigStore = create<ConfigState>((set, get) => {
  let saved: string | null = null;
  try {
    saved =
      typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
        ? localStorage.getItem('ISpooferMotion_Config')
        : null;
  } catch (error) {
    console.warn('Configuration storage is unavailable; using in-memory defaults.', error);
  }
  let initConfig = DEFAULT_APP_CONFIG;
  if (saved) {
    try {
      const p = JSON.parse(saved);
      const candidate = {
        general: mergeKnownKeys(DEFAULT_APP_CONFIG.general, p.general),
        advanced: mergeKnownKeys(DEFAULT_APP_CONFIG.advanced, p.advanced),
        debug: mergeKnownKeys(DEFAULT_APP_CONFIG.debug, p.debug),
        spoofing: mergeKnownKeys(DEFAULT_APP_CONFIG.spoofing, p.spoofing),
        permissions: mergeKnownKeys(DEFAULT_APP_CONFIG.permissions, p.permissions),
        ui: {
          ...mergeKnownKeys(DEFAULT_APP_CONFIG.ui, p.ui),
          settingsSections: mergeSections(
            p.ui?.settingsSections,
            DEFAULT_APP_CONFIG.ui.settingsSections,
          ),
          configSections: mergeSections(p.ui?.configSections, DEFAULT_APP_CONFIG.ui.configSections),
          spoofingSections: mergeSections(
            p.ui?.spoofingSections,
            DEFAULT_APP_CONFIG.ui.spoofingSections,
          ),
        },
        accounts: Array.isArray(p.accounts) ? p.accounts : DEFAULT_APP_CONFIG.accounts,
      };
      const parsed = AppConfigSchema.safeParse(candidate);
      if (!parsed.success) {
        console.warn('Saved configuration failed validation; using defaults.', parsed.error);
        initConfig = DEFAULT_APP_CONFIG;
      } else {
        initConfig = parsed.data;
      }
      initConfig.spoofing.cookie = '';
      initConfig.spoofing.apiKey = '';
      initConfig.spoofing.groupApiKey = '';

      const clamp = (n: number, lo: number, hi: number) =>
        Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
      initConfig.advanced.maxConcurrency = clamp(initConfig.advanced.maxConcurrency, 1, 100);
      initConfig.advanced.maxDownloadConcurrency = clamp(
        initConfig.advanced.maxDownloadConcurrency,
        1,
        100,
      );
    } catch (e) {
      console.warn('Failed to parse saved config from localStorage', e);
    }
  }

  const saveToStorage = (c: AppConfig) => {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      try {
        localStorage.setItem(
          'ISpooferMotion_Config',
          JSON.stringify({
            ...c,
            spoofing: { ...c.spoofing, cookie: '', apiKey: '', groupApiKey: '' },
          }),
        );
      } catch (error) {
        console.warn('Failed to persist configuration; continuing with in-memory state.', error);
      }
    }
  };

  return {
    config: initConfig,
    accountSecrets: {},
    secretsLoaded: false,
    updateConfig: (cat, key, val) => {
      set((state) => {
        const n = {
          ...state.config,
          [cat]: { ...state.config[cat], [key]: val },
        };
        saveToStorage(n);
        return { config: n };
      });
      if (cat === 'spoofing' && (key === 'cookie' || key === 'apiKey' || key === 'groupApiKey')) {
        get().saveSecrets();
      }
    },
    updateAccountsList: (accounts) => {
      set((state) => {
        const n = { ...state.config, accounts };
        saveToStorage(n);
        return { config: n };
      });
    },
    updateCategory: (cat, vals) => {
      set((state) => {
        const n = { ...state.config, [cat]: { ...state.config[cat], ...vals } };
        saveToStorage(n);
        return { config: n };
      });
      if (cat === 'spoofing' && ('cookie' in vals || 'apiKey' in vals || 'groupApiKey' in vals)) {
        get().saveSecrets();
      }
    },
    resetConfig: () =>
      set(() => {
        saveToStorage(DEFAULT_APP_CONFIG);
        return { config: DEFAULT_APP_CONFIG };
      }),
    loadSecrets: async () => {
      if (!isTauriRuntime()) {
        set({ secretsLoaded: true });
        return;
      }
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        interface ProfileSecrets {
          cookie?: string;
          apiKey?: string;
          groupApiKey?: string;
          profileCookies?: Record<string, string>;
          accountSecrets?: Record<
            string,
            { cookie?: string; apiKey?: string; groupApiKey?: string }
          >;
        }
        const s: ProfileSecrets = await invoke('load_profile_secrets');
        set((state) => {
          const selectedUser = state.config.spoofing.selectedUser;
          const profileCookie =
            selectedUser !== 'none' && typeof s.profileCookies?.[selectedUser] === 'string'
              ? s.profileCookies[selectedUser]
              : '';
          return {
            accountSecrets: s.accountSecrets || {},
            secretsLoaded: true,
            config: {
              ...state.config,
              spoofing: {
                ...state.config.spoofing,
                cookie:
                  profileCookie ||
                  (typeof s.cookie === 'string' ? s.cookie : state.config.spoofing.cookie),
                apiKey: typeof s.apiKey === 'string' ? s.apiKey : state.config.spoofing.apiKey,
                groupApiKey:
                  typeof s.groupApiKey === 'string'
                    ? s.groupApiKey
                    : state.config.spoofing.groupApiKey,
              },
            },
          };
        });
      } catch (e) {
        console.warn('Failed to load profile secrets from backend', e);

        set({ secretsLoaded: true });
      }
    },
    saveSecrets: async () => {
      if (!isTauriRuntime()) return;

      if (!get().secretsLoaded) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const state = get();
        const c = state.config.spoofing;
        const profileCookies: Record<string, string> = {};
        if (c.selectedUser !== 'none' && c.cookie) {
          profileCookies[c.selectedUser] = c.cookie;
        }
        await invoke('save_profile_secrets', {
          data: {
            cookie: c.cookie,
            apiKey: c.apiKey,
            groupApiKey: c.groupApiKey,
            profileCookies,
            accountSecrets: state.accountSecrets,
          },
        });
      } catch (e) {
        console.error('Failed to save secrets:', e);
      }
    },
    updateAccountSecret: async (accountId: string, cookie?: string, apiKey?: string) => {
      set((state) => {
        const currentAccount = state.accountSecrets[accountId] ?? {};
        return {
          accountSecrets: {
            ...state.accountSecrets,
            [accountId]: {
              ...currentAccount,
              ...(cookie !== undefined ? { cookie } : {}),
              ...(apiKey !== undefined ? { apiKey } : {}),
            },
          },
        };
      });
      await get().saveSecrets();
    },
  };
});
