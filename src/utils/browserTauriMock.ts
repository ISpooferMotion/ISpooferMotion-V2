/**
 * Browser-only mock of the Tauri IPC bridge.
 *
 * The desktop app runs inside Tauri, where `window.__TAURI_INTERNALS__.invoke`
 * is provided by the Rust core. In a plain browser (vite dev preview) that
 * object is absent, and any unguarded `invoke()` call throws synchronously
 * ("Cannot read properties of undefined (reading 'invoke')"), crashing the
 * React tree before the explorer-first UI can render.
 *
 * This module installs a permissive mock when `isTauriRuntime()` is false so
 * the frontend can be previewed in a browser. `invoke` returns canned defaults
 * for the commands the app touches during boot, and `null` for anything else.
 * Import it once, early, in `main.tsx` — before any component mounts.
 */

const MOCK_COMMANDS: Record<string, unknown> = {
  get_app_version: 'browser-preview',
  get_runtime_info: { platform: 'windows' },
  check_roblox_api_status: true,
  set_plugin_theme_accent: null,
  save_profile_secrets: null,
  load_profile_secrets: {
    cookie: '',
    apiKey: '',
    profileCookies: {},
    accountSecrets: {},
  },
  get_manageable_groups: [],
  get_group_icons_batch: {},
  get_studio_asset_snapshots: {
    anims: { assets: [] },
    sounds: { assets: [] },
    images: { assets: [] },
    meshes: { assets: [] },
    scriptRefs: { assets: [] },
  },
  find_studio_process: null,
  detect_opencloud_api_key_owner: { ok: true, ownerUserId: null, message: '' },
  fetch_audio_quota: null,
  quit_app: null,
  scan_and_replace_multiple_strings: {},
  get_studio_connection_state: null,
  get_plugin_port: null,
  read_clipboard_text: null,
};

let callbackId = 0;

export function installBrowserTauriMock() {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
      transformCallback?: unknown;
    };
  };

  if (w.__TAURI_INTERNALS__) return; // real Tauri (or already installed)

  w.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, _args?: unknown) => {
      if (cmd in MOCK_COMMANDS) return MOCK_COMMANDS[cmd];
      // Tauri event listen/unlisten: resolve to a no-op unlisten.
      if (typeof cmd === 'string' && cmd.startsWith('plugin:event|')) return null;
      return null;
    },
    transformCallback: () => callbackId++,
  };
  // Marker so other modules can tell they're in the browser preview (the mock
  // above makes isTauriRuntime() return true, so that check can't distinguish
  // real Tauri from the preview).
  (window as unknown as { __IS_BROWSER_PREVIEW__?: boolean }).__IS_BROWSER_PREVIEW__ = true;
}

export function isBrowserPreview(): boolean {
  return Boolean(
    (window as unknown as { __IS_BROWSER_PREVIEW__?: boolean }).__IS_BROWSER_PREVIEW__,
  );
}
