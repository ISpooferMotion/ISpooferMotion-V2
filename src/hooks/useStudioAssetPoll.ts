import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';

import type { PluginAssetStore } from '../utils/pluginBridge';

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
    let inFlight = false;
    let observedRevision: number | null = null;
    let complete = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delayMs: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;

      try {
        const revision = await invoke<number>('get_studio_asset_revision');
        if (cancelled) return;

        if (revision !== observedRevision) {
          const bundle = await invoke<StudioScanBundle>('get_studio_asset_snapshots');
          if (cancelled) return;

          complete = [
            bundle.anims,
            bundle.sounds,
            bundle.images,
            bundle.meshes,
            bundle.scriptRefs,
          ].every((store) => store.complete && !store.scanning);
          if (complete) onCompleteRef.current(bundle);
          observedRevision = revision;
        }
        schedule(complete ? 10000 : 2000);
      } catch {
        if (!cancelled) schedule(2000);
      } finally {
        inFlight = false;
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [studioConnected]);
}
