// ISM-V2-PROVENANCE: 4F7EB35025572096E83EB0A8
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

const MOCK_COMMANDS: Record<string, unknown> = {
  get_app_version: 'browser-preview',
  get_runtime_info: { platform: 'windows' },
  check_roblox_api_status: true,
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

  if (w.__TAURI_INTERNALS__) return;

  w.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, _args?: unknown) => {
      if (cmd in MOCK_COMMANDS) return MOCK_COMMANDS[cmd];

      if (typeof cmd === 'string' && cmd.startsWith('plugin:event|')) return null;
      return null;
    },
    transformCallback: () => callbackId++,
  };

  (window as unknown as { __IS_BROWSER_PREVIEW__?: boolean }).__IS_BROWSER_PREVIEW__ = true;
}

export function isBrowserPreview(): boolean {
  return Boolean(
    (window as unknown as { __IS_BROWSER_PREVIEW__?: boolean }).__IS_BROWSER_PREVIEW__,
  );
}

// ISM-V2-PROVENANCE-END: 4F7EB35025572096E83EB0A8
