import * as tauriCore from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseAnimationXml } from './robloxAnimParser';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('robloxAnimParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls backend invoke with xml and returns data', async () => {
    const mockAnim = { loop: true, priority: 1, duration: 1, keyframes: [] };
    vi.mocked(tauriCore.invoke).mockResolvedValue(mockAnim);

    const result = await parseAnimationXml('<roblox>...</roblox>');
    expect(tauriCore.invoke).toHaveBeenCalledWith('parse_animation_data', {
      xml: '<roblox>...</roblox>',
    });
    expect(result).toBe(mockAnim);
  });

  it('returns null and logs error if invoke fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(tauriCore.invoke).mockRejectedValue(new Error('fail'));

    const result = await parseAnimationXml('<roblox>...</roblox>');
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
