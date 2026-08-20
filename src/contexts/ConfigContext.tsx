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
import { logIsm } from '../utils/robloxProfiles';

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
        const startTime = useSpooferStore.getState().spoofStartTime;
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
        const durationMs = startTime ? Date.now() - startTime : 0;
        const durationSec = (durationMs / 1000).toFixed(2);
        const avgMsPerAsset = Math.round(durationMs / Math.max(1, total));
        let level: 'success' | 'error' | 'info' = 'info';
        let message: string;
        if (e.payload.error) {
          level = 'error';
          message = `Job failed: ${e.payload.error}`;
        } else if (failed === 0 && total > 0) {
          level = 'success';
          message = `Spoofing complete for ${total} asset(s) in ${durationSec}s (${avgMsPerAsset}ms/asset, ${ok}/${total} succeeded${skipped ? `, ${skipped} skipped` : ''}).`;
        } else if (ok === 0) {
          level = 'error';
          message = `Spoofing failed: all ${total} asset(s) failed. See the Console for details.`;
        } else {
          level = 'info';
          message = `Spoofing finished for ${total} asset(s) in ${durationSec}s (${avgMsPerAsset}ms/asset, ${ok}/${total} succeeded, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}).`;
        }
        useSpooferStore.getState().showToast(level, message, 6000);
        logIsm(
          level === 'error' ? 'error' : level === 'success' ? 'success' : 'info',
          message,
          false,
        );

        if (e.payload.error) {
          setSpoofingLogs((prev) => appendSpoofingLog(prev, `[ERROR] ${e.payload.error}`));
        } else {
          setSpoofingLogs((prev) => appendSpoofingLog(prev, `[SUCCESS] ${message}`));
          // Always apply replacements when the backend emits them (even if the
          // payload object exists but is empty, we still want to persist and
          // re-send mappings that were skipped by skipExistingReplacements).
          //
          // IMPORTANT: Only send the NEW batch's replacements to Studio, not
          // the full merged history. Sending 4000 stale mappings after a
          // 2-asset re-spoof causes Studio plugin timeouts / silently dropped
          // packets. The merge is only used for persisting to lastReplacements
          // so that "Retry Replacement" covers all historical assets.
          if (e.payload.replacements !== undefined) {
            const newBatchReplacements: Record<string, string> = e.payload.replacements ?? {};
            const existingMappings = useSpooferStore.getState().lastReplacements;
            const mergedReplacements: Record<string, string> = {
              ...existingMappings,
              ...newBatchReplacements,
            };
            // Persist the full history for Retry Replacement button
            useSpooferStore.getState().setLastReplacements(mergedReplacements);
            // But only push the new batch to Studio — avoids flooding the
            // plugin bridge with thousands of already-applied mappings
            const toApply =
              Object.keys(newBatchReplacements).length > 0
                ? newBatchReplacements
                : mergedReplacements;
            applyReplacements(toApply, true);
          }

          // Auto-grant permissions to target experiences/users/groups if configured
          const storeState = useConfigStore.getState();
          const currentConfig = storeState.config;
          const permissionsConfig = currentConfig.permissions;
          if (permissionsConfig?.enabled && permissionsConfig.subjectIds?.trim()) {
            const rawIds: unknown[] = [];
            if (e.payload.replacements) {
              rawIds.push(...Object.values(e.payload.replacements));
            }
            if (e.payload.assetResults) {
              for (const r of e.payload.assetResults as any[]) {
                const newId = r.new_asset_id || r.newAssetId;
                if (newId) {
                  rawIds.push(newId);
                }
              }
            }

            const newAssetIds: number[] = [];
            for (const val of rawIds) {
              const num = Number(val);
              if (Number.isFinite(num) && num > 0 && !newAssetIds.includes(num)) {
                newAssetIds.push(num);
              }
            }

            if (newAssetIds.length > 0) {
              const subjectIds = permissionsConfig.subjectIds
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

              if (subjectIds.length > 0) {
                const selectedUser = currentConfig.spoofing.selectedUser;
                const accountSecrets = storeState.accountSecrets;
                let apiKey =
                  (selectedUser !== 'none' ? accountSecrets[selectedUser]?.apiKey : null) ||
                  currentConfig.spoofing.apiKey?.trim() ||
                  null;
                let cookie =
                  (selectedUser !== 'none' ? accountSecrets[selectedUser]?.cookie : null) ||
                  currentConfig.spoofing.cookie?.trim() ||
                  null;

                // Fallback to any available account's secrets if selected user has none
                if (!cookie && currentConfig.accounts?.length) {
                  for (const acc of currentConfig.accounts) {
                    const candidate = accountSecrets[acc.id]?.cookie?.trim();
                    if (candidate) {
                      cookie = candidate;
                      break;
                    }
                  }
                }
                if (!apiKey && currentConfig.accounts?.length) {
                  for (const acc of currentConfig.accounts) {
                    const candidate = accountSecrets[acc.id]?.apiKey?.trim();
                    if (candidate) {
                      apiKey = candidate;
                      break;
                    }
                  }
                }

                console.log(
                  '[AssetPermissions] Auto-granting permissions for asset IDs:',
                  newAssetIds,
                  'to targets:',
                  subjectIds,
                  `(${permissionsConfig.subjectType})`,
                  'Has Cookie:',
                  Boolean(cookie),
                  'Has API Key:',
                  Boolean(apiKey),
                );

                setSpoofingLogs((prev) =>
                  appendSpoofingLog(
                    prev,
                    `[INFO] Auto-granting permissions for ${newAssetIds.length} asset(s) to ${subjectIds.length} target(s) (${permissionsConfig.subjectType})...`,
                  ),
                );

                useSpooferStore.getState().setIsGrantingPermissions(true);
                useSpooferStore.getState().setPermissionsTotalCount(newAssetIds.length);
                useSpooferStore.getState().setPermissionsCurrentCount(0);
                useSpooferStore.getState().setPermissionsStartTime(Date.now());

                import('@tauri-apps/api/core')
                  .then(({ invoke }) =>
                    invoke<{
                      success_asset_ids: number[];
                      failed_asset_ids: number[];
                      errors: string[];
                    }>('batch_grant_asset_permissions', {
                      req: {
                        asset_ids: newAssetIds,
                        subject_type: permissionsConfig.subjectType,
                        subject_ids: subjectIds,
                        action: 'Use',
                        api_key: apiKey,
                        cookie: cookie,
                      },
                    }),
                  )
                  .then((res) => {
                    console.log('[AssetPermissions] Response:', res);
                    const okCount = res.success_asset_ids.length;
                    const failCount = res.failed_asset_ids.length;
                    const logMsg = `Permissions auto-grant complete: ${okCount} succeeded${failCount > 0 ? `, ${failCount} failed` : ''}`;
                    setSpoofingLogs((prev) =>
                      appendSpoofingLog(
                        prev,
                        failCount > 0 ? `[WARN] ${logMsg}` : `[SUCCESS] ${logMsg}`,
                      ),
                    );
                    if (res.errors && res.errors.length > 0) {
                      for (const err of res.errors) {
                        console.error('[AssetPermissions] Error:', err);
                        setSpoofingLogs((prev) => appendSpoofingLog(prev, `[ERROR] ${err}`));
                      }
                    }
                    logIsm(failCount > 0 ? 'warn' : 'success', logMsg, false);
                  })
                  .catch((err) => {
                    console.error('[AssetPermissions] Fatal error granting permissions:', err);
                    const errMsg = `Failed to auto-grant permissions: ${String(err)}`;
                    setSpoofingLogs((prev) => appendSpoofingLog(prev, `[ERROR] ${errMsg}`));
                    logIsm('error', errMsg, false);
                  })
                  .finally(() => {
                    useSpooferStore.getState().setIsGrantingPermissions(false);
                  });
              }
            }
          }
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

      const p6 = listen<{ current?: number; total?: number }>('patch-progress', (e) => {
        const { current, total } = e.payload;
        if (typeof current === 'number') {
          useSpooferStore.getState().setReplaceCurrentCount(current);
        }
        if (typeof total === 'number') {
          useSpooferStore.getState().setReplaceTotalCount(total);
        }
      });

      const p7 = listen<{ succeeded?: number; failed?: number; total?: number }>(
        'patch-results',
        () => {
          useSpooferStore.getState().setIsReplacing(false);
        },
      );

      const p8 = listen<{ current?: number; total?: number; assetId?: number }>(
        'asset-permissions-progress',
        (e) => {
          const { current, total } = e.payload;
          if (typeof current === 'number') {
            useSpooferStore.getState().setPermissionsCurrentCount(current);
          }
          if (typeof total === 'number') {
            useSpooferStore.getState().setPermissionsTotalCount(total);
          }
        },
      );

      // Initial batch size sync to plugin bridge
      import('@tauri-apps/api/core').then(({ invoke }) => {
        const currentBatch = useConfigStore.getState().config.advanced.batchSize ?? 50;
        invoke('set_plugin_batch_size', { batchSize: currentBatch }).catch(() => {});
      });

      const uns = await Promise.all([p1, p2, p3, p4, p5, p6, p7, p8]);
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
