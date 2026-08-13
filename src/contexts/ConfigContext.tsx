import { createContext, useContext, useEffect, useMemo } from 'react';

import { type AppConfig, useConfigStore } from '../stores/configStore';
import { applyReplacements, useSpooferStore } from '../stores/spooferStore';
import type {
  SpooferLogPayload,
  SpooferProgressPayload,
  SpooferResultPayload,
  SpooferStartedPayload,
} from '../types/tauriEvents';
import { appendSpoofingLog } from '../utils/spoofingLogs';
import { isTauriRuntime } from '../utils/tauriRuntime';

export type { AppConfig };

interface ConfigContextType {
  config: AppConfig;
  updateConfig: <C extends keyof AppConfig, K extends keyof AppConfig[C]>(
    c: C,
    k: K,
    v: AppConfig[C][K],
  ) => void;
  updateCategory: <C extends keyof AppConfig>(c: C, vals: Partial<AppConfig[C]>) => void;
  resetConfig: () => void;
}

const Context = createContext<ConfigContextType | undefined>(undefined);

/**
 * Wraps the config store and initializes Tauri IPC listeners for the spoofer.
 *
 * Sits near the root to ensure IPC event listeners (like progress or logs) are always mounted
 * and actively pushing state down into the `spooferStore` even when the user navigates away
 * from the main execution view.
 */
export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const configState = useConfigStore();

  useEffect(() => {
    configState.loadSecrets();
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let isMounted = true;
    const unlisteners: Array<() => void> = [];

    // Bind global IPC listeners here.
    // Views read directly from the spooferStore.
    const setup = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const {
        setIsSpoofing,
        setSpoofingLogs,
        setActiveSpooferJobId,
        setSpoofProgress,
        setLastAssetResults,
        setKeyframeWarningCount,
        incrementSpoofCompletionVersion,
        setSpoofStatusText,
        setSpoofCurrentCount,
        setSpoofTotalCount,
        setSpoofStartTime,
        setAssetStatus,
      } = useSpooferStore.getState();

      const p1 = listen<SpooferStartedPayload>('spoofer-started', (e) => {
        setIsSpoofing(true);
        setSpoofingLogs([]);
        setSpoofProgress(0);
        setSpoofStatusText('Initializing...');
        setSpoofCurrentCount(0);
        setSpoofTotalCount(0);
        setSpoofStartTime(Date.now());
        setActiveSpooferJobId(e.payload.job_id ?? e.payload.jobId);
      });

      const p2 = listen<SpooferLogPayload>('spoofer-log', (e) => {
        let msg = e.payload.message ?? '';
        const rawLevel = (e.payload.level || 'info').toUpperCase();

        // Apply a level prefix to the log if missing.
        if (!msg.startsWith('[')) {
          msg = `[${rawLevel}] ${msg}`;
        }

        // Parse per-asset status from log messages
        // "Processing asset {assetId} ({current}/{total})" → downloading
        const processingMatch = msg.match(/Processing asset (\S+)\s+\((\d+)\/(\d+)\)/);
        if (processingMatch) {
          const assetId = processingMatch[1];
          setAssetStatus(assetId, { stage: 'downloading' });
        }
        // "Found N candidate Place ID(s)..." → discovering
        if (msg.includes('candidate Place ID')) {
          // Set a global discovering status on all selected assets
          // (the log doesn't specify which asset, so we set it globally via spoofStatusText)
        }
        // Upload-related messages
        if (msg.toLowerCase().includes('upload') && msg.includes('asset')) {
          const uploadMatch = msg.match(/asset (\S+)/i);
          if (uploadMatch) {
            setAssetStatus(uploadMatch[1], { stage: 'uploading' });
          }
        }

        setSpoofingLogs((prev) => appendSpoofingLog(prev, msg));
      });

      const p3 = listen<SpooferProgressPayload>('spoofer-progress', (e) => {
        if (e.payload.message) {
          setSpoofStatusText(e.payload.message);
        }

        if (e.payload.current !== undefined) {
          setSpoofCurrentCount(e.payload.current);
        }

        if (e.payload.total !== undefined) {
          setSpoofTotalCount(e.payload.total);
        }

        if (e.payload.progress !== undefined) {
          setSpoofProgress(e.payload.progress);
        } else if (
          e.payload.current !== undefined &&
          e.payload.total !== undefined &&
          e.payload.total > 0
        ) {
          setSpoofProgress((e.payload.current / e.payload.total) * 100);
        }
      });

      const p4 = listen<SpooferResultPayload>('spoofer-result', (e) => {
        setIsSpoofing(false);
        setActiveSpooferJobId(null);
        setSpoofStartTime(null);
        setLastAssetResults(e.payload.assetResults ?? e.payload.results ?? []);
        setKeyframeWarningCount(e.payload.keyframe_warnings ?? 0);
        incrementSpoofCompletionVersion();

        // Set per-asset final status from results
        const results = e.payload.assetResults ?? e.payload.results ?? [];
        for (const result of results) {
          if (!result.id) continue;
          if (result.skipped) {
            setAssetStatus(String(result.id), {
              stage: 'skipped',
              message: result.reason || result.errorReason,
            });
          } else if (result.success) {
            setAssetStatus(String(result.id), { stage: 'done' });
          } else {
            setAssetStatus(String(result.id), {
              stage: 'error',
              message: result.errorReason || result.reason || 'Failed',
            });
          }
        }

        // Surface a bottom-right toast so the user knows the job is done without
        // the modal that lived here previously. Success / partial / failure all
        // get a clear, distinct message.
        const total = results.length;
        const ok = results.filter((r) => r.success).length;
        const skipped = results.filter((r) => r.skipped).length;
        const failed = results.filter((r) => !r.success && !r.skipped).length;
        let level: 'success' | 'error' | 'info' = 'info';
        let message: string;
        if (e.payload.error) {
          level = 'error';
          message = `Job failed: ${e.payload.error}`;
        } else if (failed === 0 && total > 0) {
          level = 'success';
          message = `Spoofing complete: ${ok}/${total} succeeded${skipped ? `, ${skipped} skipped` : ''}.`;
        } else if (ok === 0) {
          level = 'error';
          message = `Spoofing failed: all ${total} asset(s) failed. See the Console for details.`;
        } else {
          level = 'info';
          message = `Spoofing finished: ${ok}/${total} succeeded, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}.`;
        }
        useSpooferStore.getState().showToast(level, message, 6000);

        if (e.payload.error) {
          setSpoofingLogs((prev) => appendSpoofingLog(prev, `[ERROR]: ${e.payload.error}`));
        } else if (e.payload.replacements) {
          // Merge the new batch's replacements with any previously-accumulated mappings
          // from earlier runs in this session. Without this merge, assets that were already
          // uploaded and skipped by skipExistingReplacements would never have their known
          // old->new mappings re-sent to Studio, causing only a subset to be replaced.
          const existingMappings = useSpooferStore.getState().lastReplacements;
          const mergedReplacements: Record<string, string> = {
            ...existingMappings,
            ...e.payload.replacements,
          };
          applyReplacements(mergedReplacements);
        }
      });

      const p5 = listen<{
        id: string;
        original_asset_id?: string;
        status?: string;
        error?: string;
      }>('transfer-update', (e) => {
        const payload = e.payload;
        const assetId = payload.original_asset_id || payload.id;
        if (!assetId) return;

        const rawStatus = payload.status || '';
        if (rawStatus.startsWith('downloading:')) {
          const progressStr = rawStatus.slice('downloading:'.length);
          setAssetStatus(assetId, {
            stage: 'downloading',
            message: `Downloading (${progressStr})...`,
          });
        } else if (rawStatus === 'resolving_location') {
          setAssetStatus(assetId, {
            stage: 'resolving_location',
            message: 'Checking direct Place IDs...',
          });
        } else if (rawStatus === 'discovering_usage') {
          setAssetStatus(assetId, {
            stage: 'discovering_usage',
            message: 'Discovering Place IDs (Asset Usage)...',
          });
        } else if (rawStatus === 'discovering_graph') {
          setAssetStatus(assetId, {
            stage: 'discovering_graph',
            message: 'Discovering Place IDs (Creator Graph)...',
          });
        } else if (rawStatus === 'uploading') {
          setAssetStatus(assetId, {
            stage: 'uploading',
            message: 'Uploading...',
          });
        } else if (rawStatus === 'done' || rawStatus === 'completed') {
          setAssetStatus(assetId, { stage: 'done', message: 'Completed' });
        } else if (rawStatus === 'failed_discovery') {
          setAssetStatus(assetId, {
            stage: 'error',
            message: payload.error || 'Failed: No Place ID found',
          });
        } else if (rawStatus === 'failed_download') {
          setAssetStatus(assetId, {
            stage: 'error',
            message: payload.error || 'Failed: Download rejected',
          });
        } else if (payload.error) {
          setAssetStatus(assetId, { stage: 'error', message: payload.error });
        }
      });

      const uns = await Promise.all([p1, p2, p3, p4, p5]);
      if (!isMounted) {
        uns.forEach((u) => u());
      } else {
        unlisteners.push(...uns);
      }
    };

    setup();
    return () => {
      isMounted = false;
      unlisteners.forEach((u) => u());
    };
  }, []);

  // Memoized to prevent full app re-renders on minor state changes.
  const contextValue = useMemo<ConfigContextType>(
    () => ({
      config: configState.config,
      updateConfig: configState.updateConfig,
      updateCategory: configState.updateCategory,
      resetConfig: configState.resetConfig,
    }),
    [
      configState.config,
      configState.updateConfig,
      configState.updateCategory,
      configState.resetConfig,
    ],
  );

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
};

export const useConfig = () => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
};
