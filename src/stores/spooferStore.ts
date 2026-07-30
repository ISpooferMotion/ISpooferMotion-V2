import { create } from 'zustand';

import type { SpooferAssetResult } from '../types/tauriEvents';
import { notifyError } from '../utils/notifyError';
import type { RbxInstance } from '../utils/robloxPlaceParser/types';
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

  keyframeWarningCount: number;
  setKeyframeWarningCount: (val: number | ((prev: number) => number)) => void;

  assetMetadataMap: Record<string, { name: string; type: string }>;
  setAssetMetadataMap: (val: Record<string, { name: string; type: string }>) => void;
}

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

  lastReplacements: {},
  setLastReplacements: (val) =>
    set((state) => ({
      lastReplacements: typeof val === 'function' ? val(state.lastReplacements) : val,
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

  keyframeWarningCount: 0,
  setKeyframeWarningCount: (val) =>
    set((state) => ({
      keyframeWarningCount: typeof val === 'function' ? val(state.keyframeWarningCount) : val,
    })),

  assetMetadataMap: {},
  setAssetMetadataMap: (val) => set({ assetMetadataMap: val }),
}));

/**
 * Dispatches a set of generated asset IDs to either the Studio Plugin Bridge or
 * directly into Studio's memory, depending on user settings.
 *
 * This is the final step of the spoofing pipeline. It translates our successful
 * web API uploads into actual game modifications.
 */
export const applyReplacements = async (replacements: Record<string, string>) => {
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
    // The spoof job itself (download + upload) already finished successfully
    // before we get here -- the replacements map is populated. Persist it
    // NOW so it survives any subsequent apply-step failures. Otherwise a
    // user who spoofs without Studio open loses the mapping table entirely
    // when the apply step throws, even though the assets were uploaded.
    setLastReplacements(replacements);

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
      await queueStudioReplacements(replacements);
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
