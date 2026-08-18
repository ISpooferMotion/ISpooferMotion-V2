import { invoke } from '@tauri-apps/api/core';

import { addDebugLog } from './debugLogger';
import { DEFAULT_PLUGIN_PORT, findPluginBridgePort } from './pluginBridge';

import { useSpooferStore } from '../stores/spooferStore';

export async function queueStudioReplacements(
  replacements: Record<string, string>,
  targetPathsMap?: Record<string, string[]>,
) {
  if (Object.keys(replacements).length === 0) {
    addDebugLog('info', ['No new spoofed assets found to apply to Studio.']);
    return;
  }
  const pluginPort = (await findPluginBridgePort()) || DEFAULT_PLUGIN_PORT;
  const targets = targetPathsMap ?? useSpooferStore.getState().targetPathsMap ?? {};
  const hasAnyTargets = Object.values(targets).some((t) => t && t.length > 0);

  const replacementsPayload = hasAnyTargets
    ? Object.entries(replacements).map(([origId, newId]) => ({
        originalId: origId,
        newId,
        targetPaths: targets[origId] && targets[origId].length > 0 ? targets[origId] : null,
      }))
    : replacements;

  const result = await invoke<string | boolean>('push_to_studio', {
    replacementsMap: replacementsPayload,
    pluginPort,
  });
  // The Rust command returns machine-readable strings on failure.
  // Translate them into thrown errors for accurate caller feedback.
  if (result === 'plugin_not_connected' || result === 'bridge_unavailable') {
    throw new Error(
      'Could not reach the ISpooferMotion Studio plugin. Make sure Studio is open and the plugin is connected, then try again.',
    );
  }
  if (result === 'empty_mappings') {
    throw new Error('No valid asset mappings were found to send to Studio.');
  }
}
