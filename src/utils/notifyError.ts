// ISM-V2-PROVENANCE: 68AA0F298BCB4CD388BA8BAD
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './tauriRuntime';

export async function notifyError(title: string, message?: string) {
  let displayMessage = message ?? title;

  if (message) {
    try {
      const parsed = JSON.parse(message);
      if (parsed.message && parsed.debug) {
        displayMessage = parsed.message;
        console.error(`[Backend Error Context] ${title}`, parsed.debug);
      }
    } catch {}
  }

  const body = displayMessage !== title ? displayMessage : '';

  if (isTauriRuntime()) {
    try {
      await invoke('show_notification', { options: { title, body } });
      return;
    } catch {}
  }
  console.error(title, displayMessage);
}

// ISM-V2-PROVENANCE-END: 68AA0F298BCB4CD388BA8BAD
