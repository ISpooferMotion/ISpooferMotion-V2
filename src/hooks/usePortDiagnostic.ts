import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

import { isTauriRuntime } from '../utils/tauriRuntime';

export interface OccupiedPort {
  port: number;
  exe: string;
}

export interface PortDiagnostic {
  boundPort: number | null;
  defaultsOccupied: OccupiedPort[];
  extended: boolean;
  failed: boolean;
}

/**
 * Fetches the plugin HTTP server's port-binding diagnostic.
 *
 * The server binds during app launch and writes the diagnostic once it has
 * either bound a port or given up. The React app can mount before that task
 * runs, so this polls briefly until the diagnostic is populated.
 */
export function usePortDiagnostic() {
  const [diagnostic, setDiagnostic] = useState<PortDiagnostic | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const check = async () => {
      if (cancelled) return;
      try {
        const result = await invoke<PortDiagnostic>('get_port_diagnostic');
        if (cancelled) return;
        setDiagnostic(result);
        // Stop once the bridge has reported a concrete outcome.
        const ready = result.failed || result.boundPort !== null;
        if (ready || attempts >= 10) return;
      } catch {
        if (attempts >= 10) return;
      }
      attempts += 1;
      timer = setTimeout(check, 1000);
    };

    check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return diagnostic;
}
