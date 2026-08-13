import { type Variants } from 'framer-motion';

const pageVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { staggerChildren: 0.05, duration: 0.3 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readText as readClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { motion } from 'framer-motion';
import { ArrowDownUp, Settings2, ShieldAlert, SlidersHorizontal, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import { useConfigStore } from '../../stores/configStore';
import { useSpooferStore } from '../../stores/spooferStore';
import { cn } from '../../utils/cn';
import { addDebugLog } from '../../utils/debugLogger';
import { type PendingSpoofRetry, takeSpoofRetry } from '../../utils/jobTypes';
import { type PluginAsset } from '../../utils/pluginBridge';
import { getStudioPlaceIdFallback } from '../../utils/apiClient';
import type { RbxInstance } from '../../utils/robloxPlaceParser/types';
import { SpoofingControls } from './spoofing/SpoofingControls';
import { SpoofingCustomAssets } from './spoofing/SpoofingCustomAssets';
import {
  loadCachedGroups,
  loadCachedUsers,
  logIsm,
  normalizeId,
  type RobloxGroup,
  type RobloxUserInfo,
  saveCachedGroups,
  validateCookieProfile,
} from '../../utils/robloxProfiles';
import { appendSpoofingLog } from '../../utils/spoofingLogs';
import { queueStudioReplacements } from '../../utils/studioBridge';
import { triggerStudioScan } from '../../utils/studioScan';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import PasteIdsModal from '../modals/PasteIdsModal';
import ResultsModal from '../modals/ResultsModal';
import ScanOptionsModal from '../modals/ScanOptionsModal';
import type { ScanOptions } from '../../utils/studioScan';

import CredentialsSection from './config/CredentialsSection';
import ExclusionsSection from './config/ExclusionsSection';
import RoutingSection from './config/RoutingSection';
import UploadSection from './config/UploadSection';
import AdvancedSection from './settings/AdvancedSection';
import ExecutionLogs from './spoofing/ExecutionLogs';
import {
  type AudioQuotaDisplay,
  AccountSwitcher,
  AvatarDropdown,
  GroupDropdown,
  parseAudioQuota,
} from './spoofing/ProfileDropdowns';
import { SpoofProgressText, SpoofProgressOverlay } from './spoofing/SpoofingHeader';

type SpooferRunContext = {
  selectedUserId?: string;
  selectedGroupId?: string;
  cookie?: string;
  apiKey?: string;
  spoofSounds?: boolean;
  uploadTypes?: string[];
  account?: { id: string; name: string; avatarUrl: string };
  group?: { id: string; name: string; iconUrl: string } | null;
  placeName?: string;
  assetTypes?: Record<string, string>;
};

type ApiKeyOwnerDetectResult = {
  ok: boolean;
  ownerUserId?: string | null;
  message?: string;
};

/**
 * The primary workspace view where the actual spoofing execution is orchestrated.
 *
 * This component acts as the main controller for the spoofing lifecycle. It validates the
 * selected Roblox profile/cookie, performs sanity checks on the Open Cloud API key, enforces
 * rate limit quotas for audio uploads, and bridges the UI state down to the Rust core engine.
 */
export default function SpoofingView() {
  const { t } = useLanguage();
  const { studioPlaceId } = useStudioConnectionState();
  const { config, updateConfig, updateCategory } = useConfig();

  const {
    rootInstances,
    loadedFileName,
    selectedAssetIds,
    setSelectedAssetIds,
    spoofingLogs: logs,
    setSpoofingLogs: setLogs,
    isSpoofing,
    spoofCompletionVersion,
    lastReplacements,
    lastAssetResults,
    setIsSpoofing,
    setSpoofProgress,
    setReplaceError,
    failedReplacements,
    setFailedReplacements,
    isReplacing,
    replaceError,
    setIsReplacing,
    activeSpooferJobId,
    isJobPaused,
    setIsJobPaused,
    showAdvanced,
    setShowAdvanced,
    isScanningStudio,
    setIsScanningStudio,
  } = useSpooferStore(
    useShallow((s) => ({
      rootInstances: s.rootInstances,
      loadedFileName: s.loadedFileName,
      selectedAssetIds: s.selectedAssetIds,
      setSelectedAssetIds: s.setSelectedAssetIds,
      spoofingLogs: s.spoofingLogs,
      setSpoofingLogs: s.setSpoofingLogs,
      isSpoofing: s.isSpoofing,
      spoofCompletionVersion: s.spoofCompletionVersion,
      lastReplacements: s.lastReplacements,
      lastAssetResults: s.lastAssetResults,
      setIsSpoofing: s.setIsSpoofing,
      setSpoofProgress: s.setSpoofProgress,
      setActiveSpooferJobId: s.setActiveSpooferJobId,
      setReplaceError: s.setReplaceError,
      failedReplacements: s.failedReplacements,
      setFailedReplacements: s.setFailedReplacements,
      isReplacing: s.isReplacing,
      replaceError: s.replaceError,
      setIsReplacing: s.setIsReplacing,
      activeSpooferJobId: s.activeSpooferJobId,
      isJobPaused: s.isJobPaused,
      setIsJobPaused: s.setIsJobPaused,
      showAdvanced: s.showAdvanced,
      setShowAdvanced: s.setShowAdvanced,
      isScanningStudio: s.isScanningStudio,
      setIsScanningStudio: s.setIsScanningStudio,
    })),
  );
  const [users, setUsers] = useState<RobloxUserInfo[]>(loadCachedUsers);
  const [groups, setGroups] = useState<RobloxGroup[]>(() =>
    loadCachedGroups(config.spoofing.selectedUser),
  );
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [pasteIdsOpen, setPasteIdsOpen] = useState(false);
  const [scanOptionsOpen, setScanOptionsOpen] = useState(false);
  const [advancedTab, setAdvancedTab] = useState('upload');
  const [audioQuota, setAudioQuota] = useState<AudioQuotaDisplay>({
    status: 'idle',
  });
  const [pendingQuotaRun, setPendingQuotaRun] = useState<{
    assetIds: string[];
    audioCount: number;
    remaining: number;
    runContext?: SpooferRunContext;
  } | null>(null);

  const handleRunSpooferRef = useRef<
    (
      overrideAssetIds?: string[],
      skipQuotaWarning?: boolean,
      runContext?: SpooferRunContext,
    ) => Promise<void>
  >(async () => {});
  const failedAssetResults = lastAssetResults.filter((result) => result.success === false);
  const failedAssetIds = Array.from(
    new Set(
      failedAssetResults
        .map((result) => String(result.id || '').replace(/\D/g, ''))
        .filter((id) => id.length > 0),
    ),
  );

  // Results modal removed entirely since Explorer view shows the same data live.

  useEffect(() => {
    const cookie = config.spoofing.cookie.trim();
    if (!cookie || config.spoofing.selectedUser === 'none') {
      setAudioQuota({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setAudioQuota({ status: 'loading' });
    invoke<unknown>('fetch_audio_quota', { cookie, autoDetect: false })
      .then((payload) => {
        if (cancelled) return;
        setAudioQuota(parseAudioQuota(payload) || { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setAudioQuota({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [spoofCompletionVersion, config.spoofing.cookie, config.spoofing.selectedUser]);

  useEffect(() => {
    const refreshUsers = () => setUsers(loadCachedUsers());
    window.addEventListener('storage', refreshUsers);
    window.addEventListener('focus', refreshUsers);
    return () => {
      window.removeEventListener('storage', refreshUsers);
      window.removeEventListener('focus', refreshUsers);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || !config.advanced.clipboardMonitoring) return;

    let lastClipboardText = '';

    const pollClipboard = async () => {
      try {
        const text = await readClipboardText();
        if (text && text !== lastClipboardText) {
          lastClipboardText = text;

          // Watch clipboard for Roblox asset URLs.
          // Auto-queue new clipboard URLs.
          const robloxUrlRegex =
            /(?:roblox\.com\/(?:library|catalog)\/|create\.roblox\.com\/store\/asset\/)(\d+)/i;
          const match = text.match(robloxUrlRegex);

          if (match && match[1]) {
            const assetId = match[1];

            const currentTargets = config.spoofing.extraAssetIds
              .split(/[\s,\n]+/)
              .map((t) => t.trim())
              .filter(Boolean);
            if (!currentTargets.includes(assetId)) {
              currentTargets.push(assetId);
              updateConfig('spoofing', 'extraAssetIds', currentTargets.join('\n'));

              import('@tauri-apps/plugin-notification')
                .then(({ sendNotification }) => {
                  sendNotification({
                    title: 'ISpooferMotion',
                    body: `Auto-queued copied asset ID: ${assetId}`,
                  });
                })
                .catch((e) => {
                  console.warn('Failed to send notification for clipboard asset', e);
                });

              (window as any).clipboardSpoofAssetId = assetId;
              window.setTimeout(() => {
                document.dispatchEvent(
                  new CustomEvent('trigger-clipboard-spoof', {
                    detail: { assetId },
                  }),
                );
              }, 0);
            }
          }
        }
      } catch (e) {
        addDebugLog('error', ['Clipboard monitoring iteration failed', e]);
      }
    };

    const intervalId = setInterval(() => void pollClipboard(), 1500);
    return () => clearInterval(intervalId);
  }, [config.advanced.clipboardMonitoring, config.spoofing.extraAssetIds, updateConfig]);

  useEffect(() => {
    const userId = config.spoofing.selectedUser;
    const cachedGroups = loadCachedGroups(userId);
    setGroups(cachedGroups);

    if (!config.spoofing.cookie || !userId || userId === 'none') {
      setLoadingGroups(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setLoadingGroups(true);
        const rawGroups = await invoke<RobloxGroup[]>('get_manageable_groups', {
          cookie: config.spoofing.cookie,
        });
        const groupIds = rawGroups.map((g) => String(g.id));
        const iconMap = await invoke<Record<string, string>>('get_group_icons_batch', {
          groupIds,
        }).catch(() => ({}) as Record<string, string>);

        const withIcons = rawGroups.map((group) => ({
          ...group,
          iconUrl: iconMap[String(group.id)] || undefined,
        }));
        if (!cancelled) {
          setGroups(withIcons);
          saveCachedGroups(userId, withIcons);
          const selectedGroupExists = withIcons.some(
            (group) => normalizeId(group.id) === normalizeId(config.spoofing.selectedGroup),
          );
          if (config.spoofing.selectedGroup !== 'none' && !selectedGroupExists) {
            updateConfig('spoofing', 'selectedGroup', 'none');
          }
        }
      } catch (e) {
        addDebugLog('warn', ['Failed to load manageable groups', e]);
        if (!cancelled) setGroups(cachedGroups);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [config.spoofing.cookie, config.spoofing.selectedUser, updateConfig]);

  const handleSelectedUserChange = async (userId: string) => {
    if (!userId || userId === 'none') {
      updateCategory('spoofing', {
        selectedUser: 'none',
        selectedGroup: 'none',
        cookie: '',
      });
      setGroups([]);
      return;
    }

    let profileCookie = '';
    try {
      const secrets = await invoke<Record<string, Record<string, unknown>>>('load_profile_secrets');
      const storedProfileCookie = secrets?.profileCookies?.[userId];
      const candidate =
        typeof storedProfileCookie === 'string' && storedProfileCookie
          ? storedProfileCookie
          : secrets?.cookie;
      if (typeof candidate === 'string' && candidate) {
        const result = await validateCookieProfile(candidate);
        if (normalizeId(result.user.id) === normalizeId(userId)) {
          profileCookie = result.cookie;
        }
      }
    } catch (e) {
      addDebugLog('error', ['Failed to load profile secrets', e]);
      logIsm('warn', 'The saved cookie for this Roblox profile could not be restored.', true);
    }

    updateCategory('spoofing', {
      selectedUser: userId,
      selectedGroup: 'none',
      cookie: profileCookie,
    });
    setGroups(loadCachedGroups(userId));
  };

  const buildRetryRunContext = async (retry: PendingSpoofRetry): Promise<SpooferRunContext> => {
    const selectedUserId = retry.selectedUserId || config.spoofing.selectedUser;
    let cookie = config.spoofing.cookie.trim();
    let apiKey = config.spoofing.apiKey.trim();

    try {
      const secrets =
        await invoke<Record<string, Record<string, unknown> | unknown>>('load_profile_secrets');
      if (typeof secrets?.apiKey === 'string') {
        apiKey = secrets.apiKey;
      }

      const profileCookies = secrets?.profileCookies;
      const storedProfileCookie =
        profileCookies &&
        typeof profileCookies === 'object' &&
        !Array.isArray(profileCookies) &&
        selectedUserId
          ? (profileCookies as Record<string, unknown>)[selectedUserId]
          : undefined;
      const candidate =
        typeof storedProfileCookie === 'string' && storedProfileCookie
          ? storedProfileCookie
          : typeof secrets?.cookie === 'string'
            ? secrets.cookie
            : cookie;

      if (candidate) {
        const result = await validateCookieProfile(candidate);
        if (
          !selectedUserId ||
          selectedUserId === 'none' ||
          normalizeId(result.user.id) === normalizeId(selectedUserId)
        ) {
          cookie = result.cookie;
        }
      }
    } catch (e) {
      addDebugLog('error', ['Failed to validate cookie profile during retry load', e]);
      logIsm('warn', 'The saved cookie for this retry could not be restored.', true);
    }

    return {
      selectedUserId,
      selectedGroupId: retry.selectedGroupId ?? config.spoofing.selectedGroup,
      cookie,
      apiKey,
      spoofSounds: retry.spoofSounds ?? config.spoofing.audio,
      uploadTypes: retry.uploadTypes ?? config.spoofing.uploadTypes,
      account: retry.account,
      group: retry.group,
      assetTypes: retry.assetTypes,
    };
  };

  const handleScanStudio = async (options?: ScanOptions) => {
    setIsScanningStudio(true);
    try {
      setLogs((prev) => appendSpoofingLog(prev, '[INFO] Scanning Roblox Studio for assets...\n'));
      await triggerStudioScan(options);
      const { invoke } = await import('@tauri-apps/api/core');
      const snapshots = await invoke<{
        anims: { assets: PluginAsset[] };
        sounds: { assets: PluginAsset[] };
        images: { assets: PluginAsset[] };
        meshes: { assets: PluginAsset[] };
        scriptRefs: { assets: PluginAsset[] };
      }>('get_studio_asset_snapshots');

      let totalAssets = 0;
      if (snapshots) {
        totalAssets += snapshots.anims?.assets?.length || 0;
        totalAssets += snapshots.sounds?.assets?.length || 0;
        totalAssets += snapshots.images?.assets?.length || 0;
        totalAssets += snapshots.meshes?.assets?.length || 0;
        totalAssets += snapshots.scriptRefs?.assets?.length || 0;
      }

      if (totalAssets === 0) {
        setLogs((prev) =>
          appendSpoofingLog(
            prev,
            '[INFO] Studio scan finished. No spoofable assets found in this place.\n',
          ),
        );
        logIsm('info', 'Studio scan finished. No assets found.', true);
      } else {
        setLogs((prev) =>
          appendSpoofingLog(prev, `[SUCCESS] Studio Scan Complete! Found ${totalAssets} assets.\n`),
        );
        logIsm('info', `Studio scan completed. Found ${totalAssets} assets.`, true);
      }
    } catch (error) {
      logIsm('error', `Studio scan failed: ${String(error)}`, true);
      setLogs((prev) => appendSpoofingLog(prev, `[ERROR] Studio scan failed: ${String(error)}\n`));
    } finally {
      setTimeout(() => setIsScanningStudio(false), 600);
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await listen<{ failedPatches: string[] }>('patch-results', (event) => {
        if (event.payload?.failedPatches?.length > 0) {
          setFailedReplacements(new Set(event.payload.failedPatches));
          setLogs((prev) =>
            appendSpoofingLog(
              prev,
              `[WARN] ${event.payload.failedPatches.length} studio replacement(s) failed to apply.\n`,
            ),
          );
        } else {
          setFailedReplacements(new Set());
        }
      });
    };

    void setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleRetryReplacement = async () => {
    if (Object.keys(lastReplacements).length === 0) return;

    setIsReplacing(true);
    setReplaceError(false);
    try {
      await queueStudioReplacements(lastReplacements);
      setLogs((prev) => appendSpoofingLog(prev, '[SUCCESS] Queued replacements for Studio.\n'));
    } catch (error) {
      setLogs((prev) =>
        appendSpoofingLog(prev, `[WARN] Studio replacement queueing failed: ${String(error)}\n`),
      );
      setReplaceError(true);
    } finally {
      setIsReplacing(false);
    }
  };

  const validateApiKeyForRun = async (apiKey: string, selectedUser: string): Promise<boolean> => {
    if (apiKey.length < 20) {
      logIsm(
        'warn',
        'Add an Open Cloud API key with Assets read/write access before spoofing.',
        true,
      );
      setLogs((prev) =>
        appendSpoofingLog(
          prev,
          '[WARN] Open Cloud API key missing. Create a key with Assets read/write permissions for the selected user or group.\n',
        ),
      );
      return false;
    }

    try {
      const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
        key: apiKey,
      });
      const message = result.message || 'No validation details returned.';
      if (!result.ok && /invalid|unauthorized/i.test(message)) {
        logIsm('warn', message, true);
        setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${message}\n`));
        return false;
      }

      if (result.ok) {
        if (
          result.ownerUserId &&
          selectedUser !== 'none' &&
          normalizeId(result.ownerUserId) !== normalizeId(selectedUser)
        ) {
          // Warn if the API key belongs to a different user.
          setLogs((prev) =>
            appendSpoofingLog(
              prev,
              `[WARN] Open Cloud API key appears to belong to user ${result.ownerUserId}, while the selected profile is ${selectedUser}. Group uploads can still work if the key has creator access.\n`,
            ),
          );
        }
      } else {
        setLogs((prev) =>
          appendSpoofingLog(
            prev,
            `[WARN] Could not fully verify the Open Cloud API key (${message}). Continuing; Roblox will reject uploads if the key lacks Assets read/write permissions.\n`,
          ),
        );
      }
      return true;
    } catch (error) {
      setLogs((prev) =>
        appendSpoofingLog(
          prev,
          `[WARN] Open Cloud API key preflight failed (${String(error)}). Continuing; Roblox will reject uploads if the key is invalid.\n`,
        ),
      );
      return true;
    }
  };

  const handleRunSpoofer = async (
    overrideAssetIds?: string[],
    skipQuotaWarning = false,
    runContext?: SpooferRunContext,
  ) => {
    const cookie = (runContext?.cookie ?? config.spoofing.cookie).trim();
    const apiKey = (runContext?.apiKey ?? config.spoofing.apiKey).trim();

    const selectedUser = runContext?.selectedUserId ?? config.spoofing.selectedUser;
    const selectedGroup = runContext?.selectedGroupId ?? config.spoofing.selectedGroup;
    const spoofSounds = runContext?.spoofSounds ?? config.spoofing.audio;
    const uploadTypes = runContext?.uploadTypes ?? config.spoofing.uploadTypes;
    // Emit a persistent log line at every early-return so users can see WHY
    // clicking "Run Spoofer" appeared to do nothing. A toast alone
    // disappears in a few seconds and leaves the logs panel empty, which
    // reads as "nothing happened".
    if (cookie.length < 50) {
      const msg =
        'Cannot start spoofer: no valid Roblox cookie. Open Accounts and paste a fresh .ROBLOSECURITY value, then try again.';
      logIsm('warn', msg, true);
      setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${msg}\n`));
      return;
    }

    try {
      await validateCookieProfile(cookie);
    } catch (e) {
      addDebugLog('warn', ['Pre-spoofing cookie validation failed', e]);
      const msg =
        'Cannot start spoofer: the current Roblox cookie is invalid or expired. Refresh the cookie in Accounts.';
      logIsm('warn', msg, true);
      setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${msg}\n`));
      return;
    }

    const getAssetId = (asset: { assetId?: string; id?: string }) => {
      if ('assetId' in asset) return asset.assetId;
      return asset.id ?? '';
    };

    const extraIdsParsed = config.spoofing.extraAssetIds
      .split(/[\s,]+/)
      .map((id) => id.replace(/\D/g, ''))
      .filter((id) => id.length > 0);

    const extraIdsSet = new Set(extraIdsParsed);
    const assetInfoMap = new Map<string, { type: string; name: string; rawValue?: string }>();

    // Recursively extract asset details from the parsed rbxl tree.
    const gatherAllInfo = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          const id = getAssetId(asset);
          if (id && asset.type) {
            assetInfoMap.set(id, {
              type: asset.type,
              name: asset.instanceName || asset.path || node.name || `Asset ${id}`,
              rawValue: asset.rawValue,
            });
          }
        }
        if (node.children) gatherAllInfo(node.children);
      }
    };
    gatherAllInfo(rootInstances);

    // Populate store with asset metadata for other components to display.
    useSpooferStore.getState().setAssetMetadataMap(Object.fromEntries(assetInfoMap));

    const shouldIncludeId = (id: string) => {
      const isMockKFS = id.startsWith('RAW_KFS_');
      if (!isMockKFS) {
        const numId = parseInt(id, 10);
        if (isNaN(numId) || numId < 10000) return false;
      }
      const type = assetInfoMap.get(id)?.type;
      if (type === 'plugin') return false;
      return true;
    };

    const finalAssetIds = new Set<string>();
    if (overrideAssetIds) {
      overrideAssetIds.forEach((id) => {
        if (shouldIncludeId(id)) finalAssetIds.add(id);
      });
    } else {
      extraIdsSet.forEach((id) => {
        if (shouldIncludeId(id)) finalAssetIds.add(id);
      });
      selectedAssetIds.forEach((id) => {
        if (shouldIncludeId(id)) finalAssetIds.add(id);
      });
    }

    if (finalAssetIds.size === 0) {
      const msg =
        'Cannot start spoofer: no valid asset IDs found. Paste some IDs into "Additional IDs to Spoof", load a place file, or scan Studio first.';
      logIsm('warn', msg, true);
      setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${msg}\n`));
      return;
    }

    const audioAssetIds = new Set<string>();
    const gatherAudioIds = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          if (asset.type === 'audio') {
            const id = getAssetId(asset);
            if (id) audioAssetIds.add(id);
          }
        }
        if (node.children) gatherAudioIds(node.children);
      }
    };
    gatherAudioIds(rootInstances);
    const selectedAudioCount = Array.from(finalAssetIds).filter((id) =>
      audioAssetIds.has(id),
    ).length;
    if (
      !skipQuotaWarning &&
      audioQuota.status === 'ready' &&
      selectedAudioCount > audioQuota.remaining
    ) {
      setPendingQuotaRun({
        assetIds: Array.from(finalAssetIds),
        audioCount: selectedAudioCount,
        remaining: audioQuota.remaining,
        runContext,
      });
      return;
    }

    const store = useConfigStore.getState();
    const downloaderName =
      store.config.accounts.find((a) => {
        const secrets = store.accountSecrets[a.id];
        return secrets?.cookie === cookie;
      })?.name || t('accounts.anonymousDownloader');

    const uploaderName =
      store.config.accounts.find((a) => {
        const secrets = store.accountSecrets[a.id];
        return secrets?.apiKey === apiKey;
      })?.name || t('accounts.anonymousUploader');

    setLogs([
      `[INFO] Job initialized. Downloader: ${downloaderName} | Uploader: ${uploaderName}\n`,
    ]);
    const apiKeyReady = await validateApiKeyForRun(apiKey, selectedUser);
    if (!apiKeyReady) return;

    // Filter out assets that have already been spoofed unless forced via runContext override
    const activeReplacements = useSpooferStore.getState().lastReplacements;
    const idsToSpoof = Array.from(finalAssetIds).filter((id) => {
      if (runContext?.assetTypes?.[id]) return true; // Explicit retry
      return !activeReplacements[id];
    });

    if (idsToSpoof.length === 0) {
      logIsm('info', 'All selected assets have already been spoofed.', true);
      return;
    }

    const finalAssetsPayload = idsToSpoof.map((id) => {
      const info = assetInfoMap.get(id);
      const overrideType = runContext?.assetTypes?.[id];
      const normalizedOverrideType =
        overrideType &&
        ['animation', 'audio', 'mesh', 'image', 'script_ref', 'raw_keyframe_sequence'].includes(
          overrideType,
        )
          ? overrideType
          : undefined;
      const type = normalizedOverrideType
        ? normalizedOverrideType
        : info?.type === 'plugin'
          ? 'animation'
          : info?.type || 'animation';
      const name = info?.name || `Asset ${id}`;
      return { id, type, name, rawValue: info?.rawValue };
    });

    setIsSpoofing(true);
    setSpoofProgress(0);

    try {
      const currentUser = users.find((user) => String(user.id) === String(selectedUser));
      const currentGroup = groups.find((group) => String(group.id) === String(selectedGroup));
      const accountPayload = runContext?.account || {
        id: String(currentUser?.id || selectedUser),
        name: currentUser?.displayName || currentUser?.name || 'Unknown',
        avatarUrl: currentUser?.avatarUrl || '',
      };
      const groupPayload =
        selectedGroup !== 'none'
          ? runContext?.group ||
            (currentGroup
              ? {
                  id: String(currentGroup.id),
                  name: currentGroup.name,
                  iconUrl: currentGroup.iconUrl || '',
                }
              : {
                  id: String(selectedGroup),
                  name: 'Group upload',
                  iconUrl: '',
                })
          : null;
      const studioPlaceIdFallback = studioPlaceId || (await getStudioPlaceIdFallback());

      const allAccounts = config.accounts || [];
      const accountSecrets = useConfigStore.getState().accountSecrets;
      const fallbackCookies = allAccounts
        .filter((a) => a.isDownloader && a.id !== selectedUser)
        .map((a) => accountSecrets[a.id]?.cookie)
        .filter(Boolean) as string[];

      // Per-asset forced place IDs: partition the asset payload by each asset's
      // pinned place id (if any) and submit one job per group. The backend
      // accepts a single forcePlaceIds string per job, so per-asset scoping is
      // achieved by splitting into multiple jobs.
      const assetForcePlaceIds = useSpooferStore.getState().assetForcePlaceIds;
      const fallbackPlaceIds = studioPlaceIdFallback;
      const groupsByPlaceId = new Map<string, typeof finalAssetsPayload>();
      for (const asset of finalAssetsPayload) {
        const pinned = assetForcePlaceIds[asset.id];
        const key = pinned && pinned.trim() ? pinned.trim() : fallbackPlaceIds;
        const bucket = groupsByPlaceId.get(key);
        if (bucket) bucket.push(asset);
        else groupsByPlaceId.set(key, [asset]);
      }

      const baseData = {
        cookie,
        fallbackCookies: fallbackCookies.length > 0 ? fallbackCookies : null,
        apiKey,
        groupId: selectedGroup !== 'none' ? selectedGroup : null,
        spoofSounds,
        uploadTypes: config.spoofing.downloadOnly ? ['download'] : uploadTypes,
        downloadPath: config.spoofing.downloadPath,
        placeName: runContext?.placeName || loadedFileName,
        concurrent: config.advanced.concurrentSpoofing,
        concurrentDownloading: config.advanced.concurrentDownloading,
        maxConcurrency: config.advanced.maxConcurrency,
        maxDownloadConcurrency: config.advanced.maxDownloadConcurrency,
        skipOwned: config.advanced.skipOwned,
        excludedUserIds: config.advanced.excludedUserIds,
        excludedGroupIds: config.advanced.excludedGroupIds,
        skipExistingReplacements: true,
        existingReplacements: lastReplacements,
        account: accountPayload,
        group: groupPayload,
        preserveMetadata: config.spoofing.preserveMetadata,
        enableArchiveRecovery: config.advanced.enableArchiveRecovery,
        proxyUrl: config.advanced.proxyUrl,
      };

      // Submit groups sequentially to avoid overloading the backend. If only
      // the unpinned group exists this is a single invoke, as before.
      const groupEntries = Array.from(groupsByPlaceId.entries());
      for (const [placeIds, groupAssets] of groupEntries) {
        await invoke('run_spoofer_action', {
          data: {
            ...baseData,
            assets: JSON.stringify(groupAssets),
            forcePlaceIds: placeIds,
          },
        });
      }
    } catch (err) {
      logIsm('error', 'Failed to start spoofer: ' + err, true);
      setIsSpoofing(false);
    }
  };

  handleRunSpooferRef.current = handleRunSpoofer;

  // Bridge for the explorer-first action bar / toolbar, which dispatch window
  // CustomEvents instead of calling these handlers directly (the explorer is
  // the visible main view; SpoofingView runs hidden as the logic host).
  useEffect(() => {
    const onOpenScan = () => setScanOptionsOpen(true);
    const onRun = () => void handleRunSpooferRef.current();
    const onOpenPaste = () => setPasteIdsOpen(true);
    const onStartScan = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      void handleScanStudio(detail);
    };
    const onDiscoverPlaceIds = async (e?: Event) => {
      const store = useSpooferStore.getState();
      const cookie = config.spoofing.cookie;
      const detail = (e as CustomEvent)?.detail;
      const timeoutSecs = detail?.timeoutSecs ?? store.discoveryTimeoutSecs ?? 60;

      if (!cookie || cookie.length < 50) {
        logIsm('warn', 'Select a user account with a valid cookie to discover place IDs.', false);
        return;
      }

      // Target assets: selected assets, or all scanned assets if none explicitly selected
      const selectedSet = store.selectedAssetIds;
      const targetAssetIds: string[] = [];
      if (selectedSet.size > 0) {
        targetAssetIds.push(...Array.from(selectedSet));
      } else {
        const collectIds = (nodes: typeof store.rootInstances) => {
          for (const node of nodes) {
            for (const asset of node.assets) {
              const id = asset.assetId || (asset as any).id;
              if (id) targetAssetIds.push(id);
            }
            collectIds(node.children);
          }
        };
        collectIds(store.rootInstances);
      }

      if (targetAssetIds.length === 0) {
        logIsm('warn', 'No assets found in explorer to discover place IDs for.', false);
        return;
      }

      store.setIsDiscoveringPlaceIds(true);
      logIsm(
        'info',
        `Discovering place IDs in parallel for ${targetAssetIds.length} asset(s) (${timeoutSecs}s limit/asset)...`,
        false,
      );

      let discoveredCount = 0;
      const CONCURRENCY_LIMIT = 10;

      const discoverSingleAsset = async (assetId: string) => {
        store.setAssetStatus(assetId, {
          stage: 'discovering_graph',
          message: 'Discovering Place ID...',
        });

        try {
          const existingPinned = store.assetForcePlaceIds[assetId] || null;
          const discoveryPromise = invoke<string | null>('discover_asset_place_id', {
            assetId,
            cookie,
            forcedPlaceId: existingPinned,
          });

          const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), timeoutSecs * 1000),
          );

          const discoveredPid = await Promise.race([discoveryPromise, timeoutPromise]);

          if (discoveredPid) {
            discoveredCount++;
            store.setAssetForcePlaceIds((prev) => ({
              ...prev,
              [assetId]: discoveredPid,
            }));
            store.setAssetStatus(assetId, {
              stage: 'done',
              message: `Discovered Place ID: ${discoveredPid}`,
            });
          } else {
            store.setAssetStatus(assetId, {
              stage: 'error',
              message: 'Discovery failed — no working Place ID found',
            });
          }
        } catch {
          store.setAssetStatus(assetId, {
            stage: 'error',
            message: 'Discovery failed — place lookup error',
          });
        }
      };

      try {
        const queue = [...targetAssetIds];
        const workers = Array.from(
          { length: Math.min(CONCURRENCY_LIMIT, queue.length) },
          async () => {
            while (queue.length > 0) {
              const nextAssetId = queue.shift();
              if (nextAssetId) {
                await discoverSingleAsset(nextAssetId);
              }
            }
          },
        );
        await Promise.all(workers);

        if (discoveredCount > 0) {
          logIsm(
            'success',
            `Discovered and assigned working place IDs for ${discoveredCount} asset(s).`,
            false,
          );
        } else {
          logIsm(
            'warn',
            'No working place IDs could be discovered for the selected asset(s).',
            false,
          );
        }
      } catch (err) {
        logIsm('error', `Place ID discovery failed: ${String(err)}`, false);
      } finally {
        store.setIsDiscoveringPlaceIds(false);
      }
    };
    document.addEventListener('ism-open-scan-options', onOpenScan);
    document.addEventListener('ism-run-spoofer', onRun);
    document.addEventListener('ism-open-paste-ids', onOpenPaste);
    document.addEventListener('ism-start-scan', onStartScan);
    document.addEventListener('ism-discover-place-ids', onDiscoverPlaceIds);
    return () => {
      document.removeEventListener('ism-open-scan-options', onOpenScan);
      document.removeEventListener('ism-run-spoofer', onRun);
      document.removeEventListener('ism-open-paste-ids', onOpenPaste);
      document.removeEventListener('ism-start-scan', onStartScan);
      document.removeEventListener('ism-discover-place-ids', onDiscoverPlaceIds);
    };
  }, []);

  const handleRetryFailedAssets = async () => {
    if (failedAssetIds.length === 0 && failedReplacements.size === 0) return;

    if (failedReplacements.size > 0) {
      void handleRetryReplacement();
    }

    if (failedAssetIds.length > 0) {
      const assetTypes = failedAssetResults.reduce<Record<string, string>>((acc, result) => {
        const id = String(result.id || '').replace(/\D/g, '');
        const type = String(result.type || result.assetType || '');
        if (id && type) acc[id] = type;
        return acc;
      }, {});

      setSelectedAssetIds(new Set(failedAssetIds));
      setLogs((prev) =>
        appendSpoofingLog(prev, `[INFO] Retrying ${failedAssetIds.length} failed asset(s)...\n`),
      );
      await handleRunSpooferRef.current(failedAssetIds, false, { assetTypes });
    }
  };

  useEffect(() => {
    const handleClipboardSpoof = (event: Event) => {
      const assetId =
        event instanceof CustomEvent && typeof event.detail?.assetId === 'string'
          ? event.detail.assetId
          : null;
      if (!assetId) return;
      void handleRunSpooferRef.current([assetId], true);
    };
    document.addEventListener('trigger-clipboard-spoof', handleClipboardSpoof);
    return () => document.removeEventListener('trigger-clipboard-spoof', handleClipboardSpoof);
  }, []);

  useEffect(() => {
    const retry = takeSpoofRetry();
    if (!retry) return;

    let cancelled = false;
    let timeout: number | undefined;
    const run = async () => {
      const retryContext = await buildRetryRunContext(retry);
      if (cancelled) return;

      const spoofingUpdates: Partial<typeof config.spoofing> = {
        selectedUser: retryContext.selectedUserId || 'none',
        selectedGroup: retryContext.selectedGroupId || 'none',
        audio: retryContext.spoofSounds ?? config.spoofing.audio,
        cookie: retryContext.cookie || config.spoofing.cookie,
      };
      if (retryContext.uploadTypes) {
        spoofingUpdates.uploadTypes = retryContext.uploadTypes;
      }
      updateCategory('spoofing', spoofingUpdates);
      setSelectedAssetIds(new Set(retry.assetIds));
      setLogs([`Retrying ${retry.assetIds.length} failed asset(s)...`]);

      timeout = window.setTimeout(() => {
        void handleRunSpooferRef.current(retry.assetIds, false, retryContext);
      }, 0);
    };

    void run();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, []);

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full h-full"
    >
      <div className="w-full h-full p-4 flex flex-col overflow-hidden">
        <div className="w-full flex-1 min-h-0 flex flex-col gap-4 relative px-2 pt-2">
          <Dialog open={showAdvanced} onOpenChange={setShowAdvanced}>
            <DialogContent className="w-[95vw]! max-w-[95vw]! sm:max-w-225! max-h-[90vh]! p-0! overflow-hidden">
              <div className="flex h-full min-h-[75vh]">
                {/* Sidebar Nav */}
                <div className="w-56 shrink-0 flex flex-col gap-1 p-4 border-r border-border-subtle bg-bg-base">
                  <div className="flex items-center gap-2 px-2 pb-3 mb-2 border-b border-border-subtle">
                    <Settings2 size={16} className="text-primary" />
                    <span className="text-sm font-bold text-text-primary">
                      {t('settings.advanced')}
                    </span>
                  </div>
                  {[
                    {
                      id: 'upload',
                      label: t('config.assetProcessing'),
                      icon: <ArrowDownUp size={15} />,
                    },
                    {
                      id: 'routing',
                      label: t('config.routingLimits'),
                      icon: <SlidersHorizontal size={15} />,
                    },
                    {
                      id: 'exclusions',
                      label: t('config.exclusions'),
                      icon: <ShieldAlert size={15} />,
                    },
                    {
                      id: 'features',
                      label: t('settings.advanced'),
                      icon: <Settings2 size={15} />,
                    },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setAdvancedTab(tab.id)}
                      className={cn(
                        'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 text-left',
                        advancedTab === tab.id
                          ? 'bg-primary/10 text-primary'
                          : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary',
                      )}
                    >
                      <span
                        className={cn(advancedTab === tab.id ? 'text-primary' : 'text-text-muted')}
                      >
                        {tab.icon}
                      </span>
                      {tab.label}
                    </button>
                  ))}
                  <div className="mt-auto pt-4 border-t border-border-subtle">
                    <Button
                      variant="default"
                      className="w-full"
                      onClick={() => setShowAdvanced(false)}
                    >
                      {t('common.done')}
                    </Button>
                  </div>
                </div>

                {/* Content Pane */}
                <div className="flex-1 overflow-y-auto p-6">
                  {advancedTab === 'upload' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-4">
                        <ArrowDownUp size={18} className="text-primary" />
                        <h3 className="text-base font-semibold text-text-primary">
                          {t('config.assetProcessing')}
                        </h3>
                      </div>
                      <UploadSection />
                    </div>
                  )}
                  {advancedTab === 'routing' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-4">
                        <SlidersHorizontal size={18} className="text-primary" />
                        <h3 className="text-base font-semibold text-text-primary">
                          {t('config.routingLimits')}
                        </h3>
                      </div>
                      <RoutingSection />
                    </div>
                  )}
                  {advancedTab === 'exclusions' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-4">
                        <ShieldAlert size={18} className="text-primary" />
                        <h3 className="text-base font-semibold text-text-primary">
                          {t('config.exclusions')}
                        </h3>
                      </div>
                      <ExclusionsSection />
                    </div>
                  )}
                  {advancedTab === 'features' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-4">
                        <Settings2 size={18} className="text-primary" />
                        <h3 className="text-base font-semibold text-text-primary">
                          {t('settings.advanced')}
                        </h3>
                      </div>
                      <AdvancedSection />
                    </div>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Top Configuration Bento */}
          <motion.div
            variants={itemVariants}
            className="w-full grid grid-cols-1 lg:grid-cols-12 gap-3 shrink-0"
          >
            {/* Left Column: Identity & Credentials */}
            <div className="col-span-1 lg:col-span-7 flex flex-col gap-2 p-3 bg-bg-surface border border-border-subtle rounded-lg shadow-sm">
              <div className="flex items-center gap-2 mb-0.5">
                <ArrowDownUp size={14} className="text-primary" />
                <span className="text-xs font-bold uppercase tracking-widest text-text-muted">
                  {t('spoof.targetContext')} {t('common.and')} {t('config.credentials')}
                </span>
              </div>

              {/* Account switcher — mirrors the Select action from the Accounts tab */}
              <AccountSwitcher accounts={config.accounts} />

              {/* Target Context */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <AvatarDropdown
                    users={users}
                    value={config.spoofing.selectedUser}
                    onChange={handleSelectedUserChange}
                    loading={false}
                    audioQuota={audioQuota}
                    showAudioQuota={true}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <GroupDropdown
                    groups={groups}
                    value={config.spoofing.selectedGroup}
                    onChange={(value) => updateConfig('spoofing', 'selectedGroup', value)}
                    loading={loadingGroups}
                  />
                </div>
              </div>

              {/* Credentials */}
              <div className="flex flex-col gap-2 mt-1">
                <CredentialsSection />
              </div>
            </div>

            {/* Right Column: Options & Custom Assets */}
            <div className="col-span-1 lg:col-span-5 flex flex-col gap-3">
              {/* Job Options */}
              <div className="flex flex-col gap-2 p-3 bg-bg-surface border border-border-subtle rounded-lg shadow-sm">
                <div className="flex items-center gap-2 mb-0.5">
                  <Wand2 size={14} className="text-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
                    {t('spoof.options')}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-text-primary">
                      {t('settings.forcePlaceIds')}
                    </Label>
                    {config.advanced.forcePlaceIds && (
                      <button
                        onClick={() => updateConfig('advanced', 'forcePlaceIds', '')}
                        className="text-[11px] text-text-muted hover:text-primary transition-colors underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={config.advanced.forcePlaceIds}
                    onChange={(e) => updateConfig('advanced', 'forcePlaceIds', e.target.value)}
                    placeholder={t('settings.forcePlaceIdsPlaceholder')}
                    className="w-full h-9 bg-bg-elevated text-text-primary text-[13px] rounded-md border border-border-strong px-3 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-text-muted"
                  />
                </div>

                <div className="pt-2 flex flex-col gap-3">
                  <div className="flex flex-row items-center justify-between rounded-lg border border-border-subtle bg-bg-base p-3">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('settings.downloadOnly')}</Label>
                      <div className="text-sm text-text-secondary">
                        {t('settings.downloadOnlyDesc')}
                      </div>
                    </div>
                    <Switch
                      checked={config.spoofing.downloadOnly}
                      onCheckedChange={(checked) =>
                        updateConfig('spoofing', 'downloadOnly', checked)
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Custom Assets Input */}
              <SpoofingCustomAssets />
            </div>
          </motion.div>

          {/* Middle Console - Logs */}
          <motion.div variants={itemVariants} className="flex-1 min-h-0 flex flex-col gap-4 mt-3">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <ExecutionLogs
                logs={logs}
                setLogs={setLogs}
                lastReplacements={lastReplacements}
                setResultsModalOpen={setResultsModalOpen}
                onOpenPasteIds={() => setPasteIdsOpen(true)}
              />
            </div>
          </motion.div>

          {/* Bottom Action Bar */}
          <SpoofingControls
            failedAssetIds={failedAssetIds}
            failedReplacements={failedReplacements}
            activeSpooferJobId={activeSpooferJobId}
            isSpoofing={isSpoofing}
            isReplacing={isReplacing}
            isScanningStudio={isScanningStudio}
            isJobPaused={isJobPaused}
            replaceError={replaceError}
            itemVariants={itemVariants}
            handleRetryFailedAssets={handleRetryFailedAssets}

            handleScanStudio={() => setScanOptionsOpen(true)}
            setIsJobPaused={setIsJobPaused}
            handleRetryReplacement={handleRetryReplacement}
            handleRunSpoofer={handleRunSpoofer}
            SpoofProgressText={SpoofProgressText}
            SpoofProgressOverlay={SpoofProgressOverlay}
          />
        </div>
      </div>
      <ResultsModal
        isOpen={resultsModalOpen}
        onClose={() => setResultsModalOpen(false)}
        onRetryFailed={() => void handleRetryFailedAssets()}
      />
      <PasteIdsModal open={pasteIdsOpen} onOpenChange={setPasteIdsOpen} />
      <ScanOptionsModal
        open={scanOptionsOpen}
        onOpenChange={setScanOptionsOpen}
        onScanStart={(opts) => handleScanStudio(opts)}
      />

      <Dialog
        open={Boolean(pendingQuotaRun)}
        onOpenChange={(open) => !open && setPendingQuotaRun(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('misc.audioQuotaExceeded')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="text-sm text-text-secondary">
              {t('spoof.audioQuotaWarning')
                .replace('{audioCount}', (pendingQuotaRun?.audioCount ?? 0).toString())
                .replace('{remaining}', (pendingQuotaRun?.remaining ?? 0).toString())}
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setPendingQuotaRun(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="default"
              onClick={() => {
                const assetIds = pendingQuotaRun?.assetIds;
                const runContext = pendingQuotaRun?.runContext;
                setPendingQuotaRun(null);
                if (assetIds) void handleRunSpooferRef.current(assetIds, true, runContext);
              }}
            >
              {t('spoof.continueAnyway')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
