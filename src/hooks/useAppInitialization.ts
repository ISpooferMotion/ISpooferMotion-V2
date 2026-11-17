import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useEffect, useState } from 'react';

import { useConfigStore } from '../stores/configStore';
import { isTauriRuntime } from '../utils/tauriRuntime';

export function useAppInitialization() {
  const [maintenance, setMaintenance] = useState<{ mode: boolean; message: string }>({
    mode: false,
    message: '',
  });
  const [isRobloxApiDown, setIsRobloxApiDown] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkStatus = async () => {
      try {
        const isUp: boolean = await invoke('check_roblox_api_status');
        if (!cancelled) setIsRobloxApiDown(!isUp);
      } catch {
        if (!cancelled) setIsRobloxApiDown(true);
      } finally {
        if (!cancelled) timer = setTimeout(() => void checkStatus(), 60000);
      }
    };
    void checkStatus();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const telemetryEnabled = useConfigStore((s) => s.config.general.telemetryEnabled);

  const proxyUrl = useConfigStore((s) => s.config.advanced.proxyUrl);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke('set_proxy_url', { url: proxyUrl || null }).catch(console.warn);
  }, [proxyUrl]);

  useEffect(() => {
    let cancelled = false;
    const tauriRuntime = isTauriRuntime();
    const baseUrl =
      import.meta.env.VITE_API_BASE_URL === undefined
        ? 'https://ispoofermotion.com'
        : import.meta.env.VITE_API_BASE_URL;
    const defaultCacheWriteUrl = `${baseUrl.replace(/\/+$/, '')}/api/cache`;

    if (tauriRuntime) {
      void invoke('initialize_remote_cache', {
        pushUrl: telemetryEnabled ? defaultCacheWriteUrl : null,
      }).catch(console.warn);
    }

    const fetchConfig = async () => {
      try {
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

  useEffect(() => {
    if (!isTauriRuntime() || !telemetryEnabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const sendHeartbeat = async () => {
      const request = new AbortController();
      controller = request;
      const deadline = setTimeout(() => request.abort(), 15000);
      try {
        const baseUrl =
          import.meta.env.VITE_API_BASE_URL === undefined
            ? 'https://ispoofermotion.com'
            : import.meta.env.VITE_API_BASE_URL;
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        if (cancelled) return;
        await tauriFetch(`${baseUrl}/api/dev/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'spoofer' }),
          signal: request.signal,
        });
      } catch {
        return;
      } finally {
        clearTimeout(deadline);
        if (controller === request) controller = undefined;
        if (!cancelled) timer = setTimeout(() => void sendHeartbeat(), 60000);
      }
    };

    void sendHeartbeat();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [telemetryEnabled]);

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
