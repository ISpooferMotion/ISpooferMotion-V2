import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';

import { findPluginBridgePort } from '../utils/pluginBridge';

export interface ScanStatus {
  scanning: boolean;
  current_service: string;
  scanned: number;
  total: number;
}

const STUDIO_PLACE_ID_CACHE_KEY = 'ISpooferMotion_LastStudioPlaceId'; // cache the last place ID so we don't have to wait for studio to reconnect just to show basic place info
const readCachedStudioPlaceId = () => {
  try {
    const value = window.localStorage.getItem(STUDIO_PLACE_ID_CACHE_KEY) || '';
    return /^\d+$/.test(value) && value !== '0' ? value : '';
  } catch {
    return '';
  }
};

/**
 * Maintains the heartbeat connection between the React frontend and Roblox Studio.
 *
 * Implements exponential backoff when Studio is closed, and immediately ramps up
 * polling when the user switches focus back to the app. Also caches the last known
 * Place ID in LocalStorage so the UI doesn't look empty during brief disconnects.
 */
export function useStudioConnection() {
  const [studioConnected, setStudioConnected] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [studioPlaceId, setStudioPlaceId] = useState(readCachedStudioPlaceId);
  const [studioPlaceName, setStudioPlaceName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let currentDelay = 1000;
    const MAX_DELAY = 10000;
    const VISIBILITY_PENALTY = 5000;

    const check = async () => {
      if (cancelled) return;

      let success = false;
      try {
        const activePort = await findPluginBridgePort();
        if (activePort) {
          const result = await invoke<{
            synced: boolean;
            scanStatus: ScanStatus | null;
            studioPlaceId: string | null;
            studioPlaceName: string | null;
          }>('get_studio_health_status');

          if (!cancelled) {
            success = result.synced === true;
            setStudioConnected(success);
            if (result.studioPlaceName && result.studioPlaceName.trim() !== '') {
              setStudioPlaceName(result.studioPlaceName);
            }
            setScanStatus((prev) => {
              const next = result.scanStatus || null;
              if (prev === next) return prev;
              if (
                prev &&
                next &&
                prev.scanning === next.scanning &&
                prev.scanned === next.scanned &&
                prev.total === next.total &&
                prev.current_service === next.current_service
              ) {
                return prev;
              }
              return next;
            });
            const placeId = String(result.studioPlaceId || '').trim();
            if (/^\d+$/.test(placeId) && placeId !== '0') {
              setStudioPlaceId((prev) => {
                if (prev === placeId) return prev;
                window.localStorage.setItem(STUDIO_PLACE_ID_CACHE_KEY, placeId);
                return placeId;
              });
            }
          }
        } else if (!cancelled) {
          setStudioConnected(false);
          setScanStatus(null);
        }
      } catch {
        if (!cancelled) {
          setStudioConnected(false);
          setScanStatus(null);
        }
      }

      if (cancelled) return;

      if (success) {
        currentDelay = 1000;
      } else {
        currentDelay = Math.min(currentDelay * 1.5, MAX_DELAY);
      }

      let nextDelay = currentDelay;
      if (document.hidden) {
        nextDelay = Math.max(nextDelay, VISIBILITY_PENALTY);
      }

      timerId = setTimeout(check, nextDelay);
    };

    check();

    const handleVisibilityChange = () => {
      if (!document.hidden && timerId) {
        clearTimeout(timerId);
        currentDelay = 1000;
        check();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return useMemo(
    () => ({ studioConnected, scanStatus, studioPlaceId, studioPlaceName }),
    [studioConnected, scanStatus, studioPlaceId, studioPlaceName],
  );
}
