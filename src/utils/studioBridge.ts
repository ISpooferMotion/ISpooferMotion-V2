import { invoke } from '@tauri-apps/api/core';

import { DEFAULT_PLUGIN_PORT, findPluginBridgePort } from './pluginBridge';

// pushes a batch of replaced asset IDs to the roblox studio plugin so it can rewrite scripts and instances
export async function queueStudioReplacements(
  replacements: Record<string, string>,
  preferredPort?: string,
) {
  const pluginPort =
    (await findPluginBridgePort(preferredPort)) || preferredPort || DEFAULT_PLUGIN_PORT;
  const queued = await invoke<boolean>('push_to_studio', {
    replacementsMap: replacements,
    pluginPort,
  });
  if (!queued) throw new Error('Studio replacement queue did not accept any mappings.');
}
