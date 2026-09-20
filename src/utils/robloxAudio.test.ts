import * as tauriCore from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../contexts/ConfigContext';
import { playRobloxAudio, stopRobloxAudio } from './robloxAudio';
import * as robloxProfiles from './robloxProfiles';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path) => `asset://${path}`),
}));

vi.mock('./robloxProfiles', () => ({
  logIsm: vi.fn(),
}));

describe('robloxAudio', () => {
  let mockAudio: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(10000));
    vi.clearAllMocks();
    mockAudio = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      addEventListener: vi.fn((event: string, cb: any) => {
        if (event === 'ended' || event === 'error') {
          mockAudio[`on${event}`] = cb;
        }
      }),
      currentTime: 0,
    };
    globalThis.Audio = vi.fn().mockImplementation(function () {
      return mockAudio;
    }) as any;
  });

  afterEach(() => {
    stopRobloxAudio();
  });

  const dummyConfig = {
    spoofing: { cookie: 'test-cookie' },
    debug: { enableCache: false },
  } as unknown as AppConfig;

  it('returns false and logs warning if asset id is empty', async () => {
    const result = await playRobloxAudio(' ', dummyConfig);
    expect(result).toBe(false);
    expect(robloxProfiles.logIsm).toHaveBeenCalledWith('warn', expect.any(String));
  });

  it('plays audio successfully', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue('/temp/audio.mp3');
    vi.mocked(robloxProfiles.logIsm).mockImplementation((level, msg) => {
      console.log('LOG_ISM:', level, msg);
    });

    const result = await playRobloxAudio('123', dummyConfig);

    expect(result).toBe(true);
    expect(globalThis.Audio).toHaveBeenCalledWith('asset:///temp/audio.mp3');
    expect(mockAudio.play).toHaveBeenCalled();
    expect(robloxProfiles.logIsm).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('handles playback failure from tauri backend', async () => {
    vi.mocked(tauriCore.invoke).mockRejectedValue(new Error('backend error'));
    const result = await playRobloxAudio('123', dummyConfig);

    expect(result).toBe(false);
    expect(robloxProfiles.logIsm).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('backend error'),
    );
  });

  it('handles playback error event', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue('/temp/audio.mp3');
    await playRobloxAudio('123', dummyConfig);

    mockAudio.onerror();
    expect(robloxProfiles.logIsm).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Playback failed'),
    );
  });

  it('handles playback ended event without error', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue('/temp/audio.mp3');
    await playRobloxAudio('123', dummyConfig);

    mockAudio.onended();

    stopRobloxAudio();
  });
});
