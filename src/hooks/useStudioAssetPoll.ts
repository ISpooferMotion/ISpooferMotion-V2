import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';

import type { PluginAsset, PluginAssetStore } from '../utils/pluginBridge';

export type StudioScanBundle = {
  anims: PluginAssetStore;
  sounds: PluginAssetStore;
  images: PluginAssetStore;
  meshes: PluginAssetStore;
  scriptRefs: PluginAssetStore;
};

export function useStudioAssetPoll(
  studioConnected: boolean,
  onComplete: (bundle: StudioScanBundle) => void,
) {
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!studioConnected) return;

    let cancelled = false;
    let idle = false;
    let inFlight = false;
    let lastSnapshot = '';
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const hashAssets = (assets?: PluginAsset[]) => {
      let hash = 2166136261;
      for (const asset of assets ?? []) {
        const value = JSON.stringify(asset);
        for (let i = 0; i < value.length; i++) {
          hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
        }
        hash = Math.imul(hash ^ 255, 16777619);
      }
      return `${assets?.length ?? 0}:${hash >>> 0}`;
    };

    const bundleSnapshot = (bundle: StudioScanBundle) =>
      `${hashAssets(bundle.anims.assets)}-${hashAssets(bundle.sounds.assets)}-${hashAssets(bundle.images.assets)}-${hashAssets(bundle.meshes.assets)}-${hashAssets(bundle.scriptRefs.assets)}`;

    const schedulePoll = (delayMs: number) => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;

      try {
        const bundle = await invoke<StudioScanBundle>('get_studio_asset_snapshots');
        if (cancelled) return;

        const { anims, sounds, images, meshes, scriptRefs } = bundle;
        const stores = [anims, sounds, images, meshes, scriptRefs];
        const anyScanning = stores.some((store) => store.scanning);
        if (anyScanning && idle) {
          idle = false;
          schedulePoll(2000);
        }

        const allDone = stores.every((store) => store.complete);

        if (!allDone) {
          idle = false;
          lastSnapshot = '';
          schedulePoll(2000);
          return;
        }

        const snapshot = bundleSnapshot(bundle);
        if (snapshot === lastSnapshot) {
          if (!idle) {
            idle = true;
            schedulePoll(10000);
          }
          return;
        }

        onCompleteRef.current(bundle);
        lastSnapshot = snapshot;
        idle = true;
        schedulePoll(10000);
      } catch {
        if (!cancelled) schedulePoll(2000);
      } finally {
        inFlight = false;
      }
    };

    void poll();
    schedulePoll(2000);

    return () => {
      cancelled = true;
      idle = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [studioConnected]);
}
