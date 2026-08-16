import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useEffect, useState } from 'react';

import { useConfigStore } from '../stores/configStore';
import { isTauriRuntime } from '../utils/tauriRuntime';

/**
 * Bootstraps the ISpooferMotion React environment on startup.
 *
 * This hook is responsible for:
 * Pinging the Roblox API to detect if the platform is down.
 * Fetching remote killswitches (Maintenance Mode) from our config server.
 * Starting the telemetry heartbeat.
 * Registering global OS shortcuts (like Alt+I to summon the window).
 */
export function useAppInitialization() {
  const [maintenance, setMaintenance] = useState<{ mode: boolean; message: string }>({
    mode: false,
    message: '',
  });
  const [isRobloxApiDown, setIsRobloxApiDown] = useState(false);

  // Auto-install / sync Roblox plugin on frontend mount
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke('sync_roblox_plugin').catch(console.warn);
  }, []);

  // Check Roblox API Status
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const checkStatus = async () => {
      try {
        const isUp: boolean = await invoke('check_roblox_api_status');
        setIsRobloxApiDown(!isUp);
      } catch (e) {
        setIsRobloxApiDown(true);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const telemetryEnabled = useConfigStore((s) => s.config.general.telemetryEnabled);

  // Push the configured proxy URL to the Rust backend so all outbound Roblox
  // calls route through it. An empty value falls back to the OS system proxy
  // (Windows WinINET — what VPN "proxy mode" apps like Happ set). Runs on mount
  // and whenever the setting changes.
  const proxyUrl = useConfigStore((s) => s.config.advanced.proxyUrl);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke('set_proxy_url', { url: proxyUrl || null }).catch(console.warn);
  }, [proxyUrl]);

  // Fetch remote config (Maintenance Mode) and initialize remote cache
  useEffect(() => {
    let cancelled = false;
    const tauriRuntime = isTauriRuntime();

    // Opt-out must not depend on the config server being reachable. Doing this
    // before the fetch also closes the window where an old endpoint stays active.
    if (tauriRuntime && !telemetryEnabled) {
      void invoke('initialize_remote_cache', { pushUrl: null }).catch(console.warn);
    }

    const fetchConfig = async () => {
      try {
        const baseUrl =
          import.meta.env.VITE_API_BASE_URL === undefined
            ? 'https://ispoofermotion.com'
            : import.meta.env.VITE_API_BASE_URL;
        let res;
        if (tauriRuntime) {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          res = await tauriFetch(`${baseUrl}/api/config`);
        } else {
          res = await fetch(`${baseUrl}/api/config`);
        }
        if (!res.ok || cancelled) return;

        const data = await res.json();
        if (cancelled) return;

        const maintenanceMode = data.maintenanceMode === true;
        setMaintenance({
          mode: maintenanceMode,
          message:
            maintenanceMode && typeof data.maintenanceMessage === 'string'
              ? data.maintenanceMessage
              : '',
        });

        if (tauriRuntime && telemetryEnabled) {
          const pushUrl =
            typeof data.communityCacheUrl === 'string' && data.communityCacheUrl.trim()
              ? data.communityCacheUrl
              : `${baseUrl}/api/v1/cache/discovery`;
          void invoke('initialize_remote_cache', { pushUrl }).catch(console.warn);
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('Could not connect to app config server:', e);
        }
      }
    };

    void fetchConfig();
    return () => {
      cancelled = true;
    };
  }, [telemetryEnabled]);

  // Heartbeat
  useEffect(() => {
    if (!isTauriRuntime() || !telemetryEnabled) return;

    const sendHeartbeat = async () => {
      try {
        const baseUrl =
          import.meta.env.VITE_API_BASE_URL === undefined
            ? 'https://ispoofermotion.com'
            : import.meta.env.VITE_API_BASE_URL;
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        await tauriFetch(`${baseUrl}/api/dev/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'spoofer' }),
        });
      } catch (e) {
        // ignore network errors for heartbeat
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 60000);
    return () => clearInterval(interval);
  }, [telemetryEnabled]);

  // Global Shortcuts & Dragging Prevention
  useEffect(() => {
    const preventDrag = (e: Event) => e.preventDefault();
    window.addEventListener('dragover', preventDrag);
    window.addEventListener('drop', preventDrag);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i')) {
        invoke('open_frontend_devtools').catch(console.error);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const shortcut = 'Alt+I';
    let isCancelled = false;
    let didRegisterShortcut = false;
    const registerShortcut = async () => {
      if (!isTauriRuntime()) return;
      try {
        if (await isRegistered(shortcut)) return;
        await register(shortcut, async (event) => {
          if (event.state === 'Pressed') {
            const win = getCurrentWindow();
            await win.show();
            await win.setFocus();
          }
        });
        didRegisterShortcut = true;
        if (isCancelled) {
          await unregister(shortcut);
          didRegisterShortcut = false;
        }
      } catch (error) {
        if (!String(error).includes('already registered')) {
          console.error(error);
        }
      }
    };

    void registerShortcut();

    return () => {
      isCancelled = true;
      window.removeEventListener('dragover', preventDrag);
      window.removeEventListener('drop', preventDrag);
      window.removeEventListener('keydown', handleKeyDown);
      if (!didRegisterShortcut) return;
      unregister(shortcut).catch((error) => {
        if (!String(error).toLowerCase().includes('not registered')) {
          console.error(error);
        }
      });
    };
  }, []);

  return { maintenance, isRobloxApiDown };
}
