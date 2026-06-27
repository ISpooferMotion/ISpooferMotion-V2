import { invoke } from '@tauri-apps/api/core';

import { DEFAULT_PLUGIN_PORT, findPluginBridgePort } from './pluginBridge';

// pushes a batch of replaced asset IDs to the roblox studio plugin so it can rewrite scripts and instances
export async function queueStudioReplacements(
  replacements: Record<string, string>,
  preferredPort?: string,
) {
  if (Object.keys(replacements).length === 0) {
    throw new Error('No new spoofed assets found to apply to Studio.');
  }
  const pluginPort =
    (await findPluginBridgePort(preferredPort)) || preferredPort || DEFAULT_PLUGIN_PORT;
  const queued = await invoke<boolean>('push_to_studio', {
    replacementsMap: replacements,
    pluginPort,
  });
  if (!queued) throw new Error('Studio replacement queue did not accept any mappings (ensure the Studio plugin is installed and running).');
}
