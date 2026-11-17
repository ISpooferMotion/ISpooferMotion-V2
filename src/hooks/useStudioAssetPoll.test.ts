import * as tauriCore from '@tauri-apps/api/core';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStudioAssetPoll } from './useStudioAssetPoll';

const emptyStore = { assets: [], scanning: false, complete: false };
const incompleteBundle = {
  anims: emptyStore,
  sounds: emptyStore,
  images: emptyStore,
  meshes: emptyStore,
  scriptRefs: emptyStore,
};
const completedBundle = {
  anims: {
    assets: [{ assetId: '1' }, { assetId: '2' }, { assetId: '3' }],
    complete: true,
    scanning: false,
  },
  sounds: { assets: [], complete: true, scanning: false },
  images: { assets: [], complete: true, scanning: false },
  meshes: { assets: [], complete: true, scanning: false },
  scriptRefs: { assets: [], complete: true, scanning: false },
};

describe('useStudioAssetPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing while disconnected', async () => {
    const onComplete = vi.fn();
    renderHook(() => useStudioAssetPoll(false, onComplete));
    await vi.advanceTimersByTimeAsync(5000);
    expect(tauriCore.invoke).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not download unchanged snapshots, even during an unfinished scan', async () => {
    const onComplete = vi.fn();
    vi.mocked(tauriCore.invoke).mockImplementation((command) =>
      Promise.resolve(command === 'get_studio_asset_revision' ? 1 : incompleteBundle),
    );
    renderHook(() => useStudioAssetPoll(true, onComplete));
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(6000);

    const snapshotCalls = vi
      .mocked(tauriCore.invoke)
      .mock.calls.filter(([name]) => name === 'get_studio_asset_snapshots');
    expect(snapshotCalls).toHaveLength(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('fetches and delivers a completed scan only when the backend revision changes', async () => {
    let revision = 1;
    let bundle = completedBundle;
    const onComplete = vi.fn();
    vi.mocked(tauriCore.invoke).mockImplementation((command) =>
      Promise.resolve(command === 'get_studio_asset_revision' ? revision : bundle),
    );
    renderHook(() => useStudioAssetPoll(true, onComplete));
    await vi.advanceTimersByTimeAsync(100);
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(completedBundle);

    await vi.advanceTimersByTimeAsync(10100);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(tauriCore.invoke)
        .mock.calls.filter(([name]) => name === 'get_studio_asset_snapshots'),
    ).toHaveLength(1);

    revision = 2;
    bundle = {
      ...completedBundle,
      anims: {
        ...completedBundle.anims,
        assets: [{ assetId: '1' }, { assetId: 'changed' }, { assetId: '3' }],
      },
    };
    await vi.advanceTimersByTimeAsync(10100);
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith(bundle);
  });

  it('retries delivery if the UI handler throws', async () => {
    const onComplete = vi.fn().mockImplementationOnce(() => {
      throw new Error('temporary UI failure');
    });
    vi.mocked(tauriCore.invoke).mockImplementation((command) =>
      Promise.resolve(command === 'get_studio_asset_revision' ? 5 : completedBundle),
    );
    renderHook(() => useStudioAssetPoll(true, onComplete));
    await vi.advanceTimersByTimeAsync(100);
    expect(onComplete).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2100);
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('does not deliver results from requests that finish after unmount', async () => {
    let finish: (value: number) => void = () => {};
    vi.mocked(tauriCore.invoke).mockImplementation((command) =>
      command === 'get_studio_asset_revision'
        ? new Promise<number>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(completedBundle),
    );
    const onComplete = vi.fn();
    const { unmount } = renderHook(() => useStudioAssetPoll(true, onComplete));
    unmount();
    finish(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
