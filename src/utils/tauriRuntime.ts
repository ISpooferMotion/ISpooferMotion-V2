// simple check to see if we're running inside the Tauri app or just a normal browser environment
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

export async function getTauriPlatform(): Promise<string | null> {
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
  // memory injection is incredibly cursed and only really works on windows right now
  return (await getTauriPlatform()) === 'windows';
}
