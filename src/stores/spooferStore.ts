import { create } from 'zustand';

import type { SpooferAssetResult } from '../types/tauriEvents';

export type AssetStage =
  | 'idle'
  | 'resolving_location'
  | 'discovering_usage'
  | 'discovering_graph'
  | 'downloading'
  | 'uploading'
  | 'done'
  | 'error'
  | 'skipped';
import { notifyError } from '../utils/notifyError';
import type { ParsedAssetRef, RbxInstance } from '../utils/robloxPlaceParser/types';
import { appendSpoofingLog } from '../utils/spoofingLogs';
import { queueStudioReplacements } from '../utils/studioBridge';
import { isTauriRuntime } from '../utils/tauriRuntime';
import { useConfigStore } from './configStore';

interface SpooferState {
  rootInstances: RbxInstance[];
  setRootInstances: (val: RbxInstance[] | ((prev: RbxInstance[]) => RbxInstance[])) => void;

  loadedFileName: string | null;
  setLoadedFileName: (val: string | null | ((prev: string | null) => string | null)) => void;

  loadedFilePath: string | null;
  setLoadedFilePath: (val: string | null) => void;

  parsingFileName: string | null;
  setParsingFileName: (name: string | null) => void;

  selectedAssetIds: Set<string>;
  setSelectedAssetIds: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;

  selectedAssetKeys: Set<string>;
  setSelectedAssetKeys: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;

  spoofingLogs: string[];
  setSpoofingLogs: (val: string[] | ((prev: string[]) => string[])) => void;

  isSpoofing: boolean;
  setIsSpoofing: (val: boolean) => void;

  spoofProgress: number;
  setSpoofProgress: (val: number) => void;

  spoofStatusText: string;
  setSpoofStatusText: (val: string) => void;

  spoofCurrentCount: number;
  setSpoofCurrentCount: (val: number | ((prev: number) => number)) => void;

  spoofTotalCount: number;
  setSpoofTotalCount: (val: number) => void;

  spoofStartTime: number | null;
  setSpoofStartTime: (val: number | null) => void;

  lastReplacements: Record<string, string>;
  setLastReplacements: (
    val: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;

  targetPathsMap: Record<string, string[]>;
  setTargetPathsMap: (
    val: Record<string, string[]> | ((prev: Record<string, string[]>) => Record<string, string[]>),
  ) => void;

  isReplacing: boolean;
  setIsReplacing: (val: boolean) => void;

  replaceError: boolean;
  setReplaceError: (val: boolean) => void;

  failedReplacements: Set<string>;
  setFailedReplacements: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;

  spoofCompletionVersion: number;
  incrementSpoofCompletionVersion: () => void;

  activeSpooferJobId: string | null;
  setActiveSpooferJobId: (id: string | null) => void;

  isJobPaused: boolean;
  setIsJobPaused: (val: boolean) => void;

  jobPauseStartTime: number | null;
  setJobPauseStartTime: (val: number | null) => void;

  lastAssetResults: SpooferAssetResult[];
  setLastAssetResults: (results: SpooferAssetResult[]) => void;

  showAdvanced: boolean;
  setShowAdvanced: (val: boolean | ((prev: boolean) => boolean)) => void;

  // True while a Studio scan is in progress. Lives in the store (not local
  // component state) so the explorer action bar can read it without prop
  // drilling from the (now hidden) SpoofingView logic host.
  isScanningStudio: boolean;
  setIsScanningStudio: (val: boolean) => void;

  lastScanTime: number | null;
  setLastScanTime: (val: number | null) => void;

  keyframeWarningCount: number;
  setKeyframeWarningCount: (val: number | ((prev: number) => number)) => void;

  assetMetadataMap: Record<string, { name: string; type: string }>;
  setAssetMetadataMap: (val: Record<string, { name: string; type: string }>) => void;

  // Per-asset forced place IDs. Maps an asset id to a place id that should be
  // used as the asset-delivery place hint when spoofing that asset. Absent key
  // means "use the global forcePlaceIds / studio fallback" for that asset.
  assetForcePlaceIds: Record<string, string>;
  setAssetForcePlaceIds: (
    val: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
  clearAssetForcePlaceIds: (ids: string[]) => void;

  // Per-asset status during spoofing
  assetStatuses: Record<string, { stage: AssetStage; message?: string }>;
  setAssetStatus: (assetId: string, status: { stage: AssetStage; message?: string }) => void;
  clearAssetStatuses: () => void;

  // Bottom-right toast for one-off notifications (job finished, etc).
  toast: { id: number; level: 'success' | 'error' | 'info'; message: string } | null;
  showToast: (level: 'success' | 'error' | 'info', message: string, ttlMs?: number) => void;
  dismissToast: () => void;

  // True while place ID discovery is running (pre-spoof step)
  isDiscoveringPlaceIds: boolean;
  setIsDiscoveringPlaceIds: (val: boolean) => void;

  searchQuery: string;
  setSearchQuery: (query: string) => void;

  activeAssetFilters: string[];
  setActiveAssetFilters: (filters: string[] | ((prev: string[]) => string[])) => void;

  isInspectorOpen: boolean;
  setIsInspectorOpen: (open: boolean | ((prev: boolean) => boolean)) => void;

  isPropertiesOpen: boolean;
  setIsPropertiesOpen: (open: boolean | ((prev: boolean) => boolean)) => void;

  activeInspectAsset: ParsedAssetRef | null;
  setActiveInspectAsset: (asset: ParsedAssetRef | null) => void;

  forceSpoof: boolean;
  setForceSpoof: (val: boolean) => void;

  // Ghost IDs state (IDs added manually without an instance in Studio)
  ghostAssetIds: Set<string>;
  addGhostAssets: (ids: string[]) => void;
  removeGhostAssets: (ids: string[]) => void;
  clearGhostAssets: () => void;

  discoveryTimeoutSecs: number;
  setDiscoveryTimeoutSecs: (val: number) => void;
}

const loadSavedReplacements = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem('ISpooferMotion_SavedReplacements');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const loadSavedPlaceIds = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem('ISpooferMotion_SavedPlaceIds');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

/**
 * Ephemeral state manager for the active spoofing job, asset explorer, and Studio integration.
 *
 * Kept strictly separate from the config store because none of this data needs to be
 * persisted to disk. It tracks live IPC events, progress bars, and temporary session data,
 * wiping itself clean on every app restart.
 */
export const useSpooferStore = create<SpooferState>((set) => ({
  rootInstances: [],
  setRootInstances: (val) =>
    set((state) => ({
      rootInstances: typeof val === 'function' ? val(state.rootInstances) : val,
    })),

  loadedFileName: null,
  setLoadedFileName: (val) =>
    set((state) => ({
      loadedFileName: typeof val === 'function' ? val(state.loadedFileName) : val,
    })),

  loadedFilePath: null,
  setLoadedFilePath: (val) => set({ loadedFilePath: val }),

  parsingFileName: null,
  setParsingFileName: (name) => set({ parsingFileName: name }),

  selectedAssetIds: new Set<string>(),
  setSelectedAssetIds: (val) =>
    set((state) => ({
      selectedAssetIds: typeof val === 'function' ? val(state.selectedAssetIds) : val,
    })),

  selectedAssetKeys: new Set<string>(),
  setSelectedAssetKeys: (val) =>
    set((state) => ({
      selectedAssetKeys: typeof val === 'function' ? val(state.selectedAssetKeys) : val,
    })),

  spoofingLogs: [],
  setSpoofingLogs: (val) =>
    set((state) => {
      const nextVal = typeof val === 'function' ? val(state.spoofingLogs) : val;
      if (nextVal.length > 500) {
        return { spoofingLogs: nextVal.slice(nextVal.length - 500) };
      }
      return { spoofingLogs: nextVal };
    }),

  isSpoofing: false,
  setIsSpoofing: (val) => set({ isSpoofing: val }),

  spoofProgress: 0,
  setSpoofProgress: (val) => set({ spoofProgress: val }),

  spoofStatusText: '',
  setSpoofStatusText: (val) => set({ spoofStatusText: val }),

  spoofCurrentCount: 0,
  setSpoofCurrentCount: (val) =>
    set((state) => ({
      spoofCurrentCount: typeof val === 'function' ? val(state.spoofCurrentCount) : val,
    })),

  spoofTotalCount: 0,
  setSpoofTotalCount: (val) => set({ spoofTotalCount: val }),

  spoofStartTime: null,
  setSpoofStartTime: (val) => set({ spoofStartTime: val }),

  lastReplacements: loadSavedReplacements(),
  setLastReplacements: (val) =>
    set((state) => {
      const next = typeof val === 'function' ? val(state.lastReplacements) : val;
      try {
        localStorage.setItem('ISpooferMotion_SavedReplacements', JSON.stringify(next));
      } catch {}
      return { lastReplacements: next };
    }),

  targetPathsMap: {},
  setTargetPathsMap: (val) =>
    set((state) => ({
      targetPathsMap: typeof val === 'function' ? val(state.targetPathsMap) : val,
    })),

  isReplacing: false,
  setIsReplacing: (val) => set({ isReplacing: val }),

  replaceError: false,
  setReplaceError: (val) => set({ replaceError: val }),

  failedReplacements: new Set(),
  setFailedReplacements: (val) =>
    set((state) => ({
      failedReplacements: typeof val === 'function' ? val(state.failedReplacements) : val,
    })),

  spoofCompletionVersion: 0,
  incrementSpoofCompletionVersion: () =>
    set((state) => ({
      spoofCompletionVersion: state.spoofCompletionVersion + 1,
    })),

  activeSpooferJobId: null,
  setActiveSpooferJobId: (id) => set({ activeSpooferJobId: id }),

  isJobPaused: false,
  setIsJobPaused: (val) => set({ isJobPaused: val }),

  jobPauseStartTime: null,
  setJobPauseStartTime: (val) => set({ jobPauseStartTime: val }),

  lastAssetResults: [],
  setLastAssetResults: (results) => set({ lastAssetResults: results }),

  showAdvanced: false,
  setShowAdvanced: (val) =>
    set((state) => ({
      showAdvanced: typeof val === 'function' ? val(state.showAdvanced) : val,
    })),

  isScanningStudio: false,
  setIsScanningStudio: (val) => set({ isScanningStudio: val }),

  lastScanTime: null,
  setLastScanTime: (val) => set({ lastScanTime: val }),

  keyframeWarningCount: 0,
  setKeyframeWarningCount: (val) =>
    set((state) => ({
      keyframeWarningCount: typeof val === 'function' ? val(state.keyframeWarningCount) : val,
    })),

  assetMetadataMap: {},
  setAssetMetadataMap: (val) => set({ assetMetadataMap: val }),

  assetForcePlaceIds: loadSavedPlaceIds(),
  setAssetForcePlaceIds: (val) =>
    set((state) => {
      const next = typeof val === 'function' ? val(state.assetForcePlaceIds) : val;
      try {
        localStorage.setItem('ISpooferMotion_SavedPlaceIds', JSON.stringify(next));
      } catch {}
      return { assetForcePlaceIds: next };
    }),
  clearAssetForcePlaceIds: (ids) =>
    set((state) => {
      if (ids.length === 0) return {};
      const next = { ...state.assetForcePlaceIds };
      for (const id of ids) delete next[id];
      try {
        localStorage.setItem('ISpooferMotion_SavedPlaceIds', JSON.stringify(next));
      } catch {}
      return { assetForcePlaceIds: next };
    }),

  assetStatuses: {},
  setAssetStatus: (assetId, status) =>
    set((state) => ({
      assetStatuses: { ...state.assetStatuses, [assetId]: status },
    })),
  clearAssetStatuses: () => set({ assetStatuses: {} }),

  toast: null,
  showToast: (level, message, ttlMs = 4000) => {
    const id = Date.now();
    set({ toast: { id, level, message } });
    setTimeout(() => {
      const cur = useSpooferStore.getState().toast;
      if (cur && cur.id === id) set({ toast: null });
    }, ttlMs);
  },
  dismissToast: () => set({ toast: null }),

  isDiscoveringPlaceIds: false,
  setIsDiscoveringPlaceIds: (val) => set({ isDiscoveringPlaceIds: val }),

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  activeAssetFilters: [],
  setActiveAssetFilters: (val) =>
    set((state) => ({
      activeAssetFilters: typeof val === 'function' ? val(state.activeAssetFilters) : val,
    })),

  isInspectorOpen: true,
  setIsInspectorOpen: (val) =>
    set((state) => ({
      isInspectorOpen: typeof val === 'function' ? val(state.isInspectorOpen) : val,
    })),

  isPropertiesOpen: true,
  setIsPropertiesOpen: (val) =>
    set((state) => ({
      isPropertiesOpen: typeof val === 'function' ? val(state.isPropertiesOpen) : val,
    })),

  activeInspectAsset: null,
  setActiveInspectAsset: (asset) => set({ activeInspectAsset: asset }),

  forceSpoof: false,
  setForceSpoof: (val) => set({ forceSpoof: val }),

  discoveryTimeoutSecs: 60,
  setDiscoveryTimeoutSecs: (val) => set({ discoveryTimeoutSecs: val }),

  ghostAssetIds: new Set<string>(),
  addGhostAssets: (ids: string[]) =>
    set((state) => {
      const next = new Set(state.ghostAssetIds);
      for (const id of ids) {
        if (id) next.add(id);
      }
      return { ghostAssetIds: next };
    }),
  removeGhostAssets: (ids: string[]) =>
    set((state) => {
      const next = new Set(state.ghostAssetIds);
      for (const id of ids) next.delete(id);
      return { ghostAssetIds: next };
    }),
  clearGhostAssets: () => set({ ghostAssetIds: new Set() }),
}));

/**
 * Dispatches a set of generated asset IDs to either the Studio Plugin Bridge or
 * directly into Studio's memory, depending on user settings.
 *
 * This is the final step of the spoofing pipeline. It translates our successful
 * web API uploads into actual game modifications.
 */
export const applyReplacements = async (
  replacements: Record<string, string>,
  skipPersist = false,
) => {
  if (!isTauriRuntime()) return;
  const { config } = useConfigStore.getState();
  const { setSpoofingLogs, setLastReplacements, setIsReplacing, setReplaceError } =
    useSpooferStore.getState();

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    setIsReplacing(true);
    setReplaceError(false);

    if (Object.keys(replacements).length === 0) {
      setSpoofingLogs((prev) =>
        appendSpoofingLog(
          prev,
          '\n[INFO] No replacements were generated (all assets may have been skipped or failed).',
        ),
      );
      if (typeof window.ismLog === 'function') {
        window.ismLog(
          'info',
          'No replacements generated. All selected assets may have already been spoofed or failed.',
          true,
        );
      }
      return;
    }

    setSpoofingLogs((prev) => appendSpoofingLog(prev, '\nApplying replacements to Studio...'));

    // Memory injection and the plugin bridge are complementary, not
    // exclusive. Memory injection can only patch length-matching id pairs
    // (WriteProcessMemory writes bytes in-place, so 10-digit -> 15-digit
    // pairs get skipped). The plugin bridge handles those length-mismatched
    // cases plus anything memory injection missed. Running only one leaves
    // gaps -- length-mismatched pairs silently don't get replaced.
    //
    // Order matters: memory injection first (fast, in-process), then queue
    // to the plugin bridge. If memory injection already replaced a value,
    // the plugin's scan will see the new id and plan_patches produces no
    // patch for it -- idempotent, no double work.
    //
    // skipPersist=true when called from ConfigContext, which already
    // persisted the full merged history (including previous runs).
    // For all other callers (PasteIdsModal, AssetExplorer) persist here.
    if (!skipPersist) {
      setLastReplacements(replacements);
    }

    if (config.advanced.memoryInjectionEnabled) {
      setSpoofingLogs((prev) => appendSpoofingLog(prev, 'Starting Memory Injection (Beta)...'));
      const pid = await invoke<number | null>('find_studio_process');
      if (!pid) {
        setSpoofingLogs((prev) =>
          appendSpoofingLog(
            prev,
            "[INFO] Studio isn't running -- skipping memory injection. Mappings are ready; open Studio and hit Retry Replacement (or copy the IDs from the Results panel).",
          ),
        );
      } else {
        const results = await invoke<Record<string, { total_replaced: number }>>(
          'scan_and_replace_multiple_strings',
          {
            pid,
            replacements,
          },
        );

        let total = 0;
        for (const [, res] of Object.entries(results)) {
          total += res.total_replaced;
        }

        setSpoofingLogs((prev) =>
          appendSpoofingLog(
            prev,
            `Memory injection complete! Patched ${total} exact matches in memory. Handing any length-mismatched pairs to the plugin bridge...`,
          ),
        );
      }
    }

    try {
      await queueStudioReplacements(replacements, useSpooferStore.getState().targetPathsMap);
      setSpoofingLogs((prev) =>
        appendSpoofingLog(
          prev,
          "Queued replacements to plugin bridge. The Studio plugin will auto-replace anything memory injection couldn't patch.",
        ),
      );
    } catch (bridgeErr: unknown) {
      const msg = String(bridgeErr);
      // Plugin/Studio not being reachable isn't a spoof failure. The upload
      // side already completed; the user can apply the mappings later by
      // opening Studio and hitting the Retry Replacement button, or by
      // copying the IDs from the Results panel and pasting them wherever.
      if (msg.includes('plugin') || msg.includes('Studio') || msg.includes('bridge')) {
        setSpoofingLogs((prev) =>
          appendSpoofingLog(
            prev,
            `[INFO] ${Object.keys(replacements).length} replacement(s) generated but the Studio plugin isn't connected. Open Studio with the ISpooferMotion plugin loaded and use Retry Replacement, or copy the IDs from the Results panel.`,
          ),
        );
      } else {
        throw bridgeErr;
      }
    }
  } catch (e: unknown) {
    const errorStr = String(e);
    // These are expected non-fatal outcomes - log as info rather than showing an error toast.
    const isExpectedOutcome =
      errorStr.includes('No usable replacements') ||
      errorStr.includes('did not accept any mappings') ||
      errorStr.includes('rejected the mappings') ||
      errorStr.includes('length mismatch') ||
      errorStr.includes('Plugin bridge will apply');
    if (isExpectedOutcome) {
      setSpoofingLogs((prev) =>
        appendSpoofingLog(prev, `\n[INFO] ${errorStr.replace('Error: ', '')}`),
      );
    } else {
      setReplaceError(true);
      notifyError('Replacement Error', errorStr);
      setSpoofingLogs((prev) =>
        appendSpoofingLog(prev, `[ERROR] Failed to apply replacements: ${errorStr}`),
      );
    }
  } finally {
    setIsReplacing(false);
  }
};
