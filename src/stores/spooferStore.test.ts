import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSpooferStore, applyReplacements } from './spooferStore';
import * as tauriCore from '@tauri-apps/api/core';
import { useConfigStore } from './configStore';

vi.mock('../utils/tauriRuntime', () => ({
  isTauriRuntime: vi.fn().mockReturnValue(true),
}));

vi.mock('../utils/notifyError', () => ({
  notifyError: vi.fn(),
}));

vi.mock('../utils/studioBridge', () => ({
  queueStudioReplacements: vi.fn().mockResolvedValue(undefined),
}));

describe('spooferStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all state for reliable testing
    const store = useSpooferStore.getState();
    store.setRootInstances([]);
    store.setLoadedFileName(null);
    store.setLoadedFilePath(null);
    store.setParsingFileName(null);
    store.setSelectedAssetIds(new Set());
    store.setSpoofingLogs([]);
    store.setIsSpoofing(false);
    store.setSpoofProgress(0);
    store.setSpoofStatusText('');
    store.setSpoofCurrentCount(0);
    store.setSpoofTotalCount(0);
    store.setSpoofStartTime(null);
    store.setLastReplacements({});
    store.setIsReplacing(false);
    store.setReplaceError(false);
    store.setActiveSpooferJobId(null);
    store.setIsJobPaused(false);
    store.setLastAssetResults([]);
    store.setShowAdvanced(false);
    store.setKeyframeWarningCount(0);
    store.setAssetMetadataMap({});
  });

  it('updates basic state fields', () => {
    const store = useSpooferStore.getState();
    store.setLoadedFileName('test.rbxlx');
    expect(useSpooferStore.getState().loadedFileName).toBe('test.rbxlx');

    store.setIsSpoofing(true);
    expect(useSpooferStore.getState().isSpoofing).toBe(true);

    store.setSpoofProgress(50);
    expect(useSpooferStore.getState().spoofProgress).toBe(50);
  });

  it('updates set state fields with callbacks', () => {
    const store = useSpooferStore.getState();
    store.setSpoofCurrentCount(5);
    store.setSpoofCurrentCount((prev) => prev + 10);
    expect(useSpooferStore.getState().spoofCurrentCount).toBe(15);
  });

  it('truncates spoofing logs at 500 entries', () => {
    const store = useSpooferStore.getState();
    const largeLogs = Array.from({ length: 600 }, (_, i) => `log ${i}`);
    store.setSpoofingLogs(largeLogs);
    expect(useSpooferStore.getState().spoofingLogs.length).toBe(500);
    expect(useSpooferStore.getState().spoofingLogs[499]).toBe('log 599');
  });
});

describe('applyReplacements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSpooferStore.getState().setSpoofingLogs([]);
    useSpooferStore.getState().setIsReplacing(false);
    useSpooferStore.getState().setReplaceError(false);
  });

  it('bails out early if no replacements are provided', async () => {
    await applyReplacements({});
    const store = useSpooferStore.getState();
    expect(store.isReplacing).toBe(false);
    expect(store.spoofingLogs.join('')).toContain('No replacements were generated');
  });

  it('queues replacements to studio bridge when memory injection is disabled', async () => {
    useConfigStore.getState().updateConfig('advanced', 'memoryInjectionEnabled', false);

    await applyReplacements({ '123': '456' });
    const store = useSpooferStore.getState();

    expect(store.replaceError).toBe(false);
    expect(store.isReplacing).toBe(false);
    expect(store.spoofingLogs.join('')).toContain('Queued replacements to plugin bridge');
    expect(store.lastReplacements).toEqual({ '123': '456' });
  });

  it('uses memory injection if enabled and studio process is found', async () => {
    useConfigStore.getState().updateConfig('advanced', 'memoryInjectionEnabled', true);

    (tauriCore.invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'find_studio_process') return Promise.resolve(1234);
      if (cmd === 'scan_and_replace_multiple_strings')
        return Promise.resolve({
          '123': { total_replaced: 5 },
        });
      return Promise.resolve(null);
    });

    await applyReplacements({ '123': '456' });
    const store = useSpooferStore.getState();

    expect(store.replaceError).toBe(false);
    expect(store.spoofingLogs.join('')).toContain('Patched 5 exact matches in memory');
  });

  it('handles memory injection failure gracefully if process is not found', async () => {
    useConfigStore.getState().updateConfig('advanced', 'memoryInjectionEnabled', true);

    (tauriCore.invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'find_studio_process') return Promise.resolve(null); // No process found
      return Promise.resolve(null);
    });

    await applyReplacements({ '123': '456' });
    const store = useSpooferStore.getState();

    expect(store.replaceError).toBe(false);
    expect(store.spoofingLogs.join('')).toContain("Studio isn't running");
  });
});
