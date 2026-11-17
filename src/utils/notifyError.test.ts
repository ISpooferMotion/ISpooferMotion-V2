import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyError } from './notifyError';
import * as tauriRuntime from './tauriRuntime';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('notifyError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs title and fallback message to console when not in Tauri', async () => {
    vi.spyOn(tauriRuntime, 'isTauriRuntime').mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await notifyError('Error Title', 'Something went wrong');

    expect(consoleSpy).toHaveBeenCalledWith('Error Title', 'Something went wrong');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('unpacks structured backend error JSON with message and debug info', async () => {
    vi.spyOn(tauriRuntime, 'isTauriRuntime').mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const structuredError = JSON.stringify({
      message: 'Clean user-facing message',
      debug: 'Stack trace line 42',
    });

    await notifyError('Operation Failed', structuredError);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[Backend Error Context] Operation Failed',
      'Stack trace line 42',
    );
    expect(consoleSpy).toHaveBeenCalledWith('Operation Failed', 'Clean user-facing message');
  });

  it('handles unstructured message gracefully', async () => {
    vi.spyOn(tauriRuntime, 'isTauriRuntime').mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await notifyError('Error Title', 'Plain error text');

    expect(consoleSpy).toHaveBeenCalledWith('Error Title', 'Plain error text');
  });

  it('falls back to title when message is omitted', async () => {
    vi.spyOn(tauriRuntime, 'isTauriRuntime').mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await notifyError('Only Title Provided');

    expect(consoleSpy).toHaveBeenCalledWith('Only Title Provided', 'Only Title Provided');
  });

  it('invokes native notification when in Tauri runtime', async () => {
    vi.spyOn(tauriRuntime, 'isTauriRuntime').mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await notifyError('Tauri Title', 'Tauri Body');

    expect(invoke).toHaveBeenCalledWith('show_notification', {
      options: { title: 'Tauri Title', body: 'Tauri Body' },
    });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('falls back to console when invoke fails in Tauri runtime', async () => {
    vi.spyOn(tauriRuntime, 'isTauriRuntime').mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue(new Error('Notification failed') as never);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await notifyError('Failed Tauri Title', 'Failed Tauri Body');

    expect(invoke).toHaveBeenCalledWith('show_notification', {
      options: { title: 'Failed Tauri Title', body: 'Failed Tauri Body' },
    });
    expect(consoleSpy).toHaveBeenCalledWith('Failed Tauri Title', 'Failed Tauri Body');
  });
});
