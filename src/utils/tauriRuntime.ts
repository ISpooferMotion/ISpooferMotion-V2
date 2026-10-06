// ISM-V2-PROVENANCE: 0FCFF20815B65F7A7CE3C4AC
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

export function isTauriRuntime() {
  const internals = (
    window as Window & {
      __TAURI_INTERNALS__?: { invoke?: unknown; transformCallback?: unknown };
    }
  ).__TAURI_INTERNALS__;

  return Boolean(
    internals &&
    typeof internals.invoke === 'function' &&
    typeof internals.transformCallback === 'function',
  );
}

let cachedPlatform: string | null | undefined;

async function getTauriPlatform(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  if (cachedPlatform !== undefined) {
    return cachedPlatform;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = await invoke<{ platform?: string }>('get_runtime_info');
    cachedPlatform = info.platform ?? null;
    return cachedPlatform;
  } catch {
    cachedPlatform = null;
    return null;
  }
}

export async function isMemoryInjectionSupported(): Promise<boolean> {
  return (await getTauriPlatform()) === 'windows';
}

// ISM-V2-PROVENANCE-END: 0FCFF20815B65F7A7CE3C4AC
