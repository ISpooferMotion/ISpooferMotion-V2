import { addDebugLog } from './debugLogger';
import { findPluginBridgePort } from './pluginBridge';
import { isTauriRuntime } from './tauriRuntime';

export async function getStudioPlaceIdFallback(): Promise<string> {
  try {
    const cached = window.localStorage.getItem('ISpooferMotion_LastStudioPlaceId') || '';
    if (/^\d+$/.test(cached) && cached !== '0') return cached;
  } catch (e) {
    addDebugLog('warn', ['Failed to read cached Studio place ID', e]);
  }

  try {
    const activePort = await findPluginBridgePort();
    if (!activePort) return '';
    const response = await fetch(`http://localhost:${activePort}/studio-health?t=${Date.now()}`, {
      signal: AbortSignal.timeout(800),
      cache: 'no-store',
    });
    if (!response.ok) return '';
    const result = (await response.json()) as { studioPlaceId?: string };
    const placeId = String(result.studioPlaceId || '').trim();
    return /^\d+$/.test(placeId) && placeId !== '0' ? placeId : '';
  } catch (e) {
    addDebugLog('warn', ['Failed to ping Studio for fallback placeId', e]);
    return '';
  }
}

export async function fetchTelemetry(url: string, options?: RequestInit): Promise<Response> {
  if (isTauriRuntime()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, options);
  } else {
    return fetch(url, options);
  }
}
