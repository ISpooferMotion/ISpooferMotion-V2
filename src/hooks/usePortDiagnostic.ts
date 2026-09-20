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
