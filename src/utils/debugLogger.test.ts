import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addDebugLog, clearDebugLogs, getDebugLogs, subscribeDebugLogs } from './debugLogger';
import * as tauriRuntime from './tauriRuntime';

describe('debugLogger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearDebugLogs();
    vi.spyOn(tauriRuntime, 'isTauriRuntime').mockReturnValue(false);
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('adds logs properly and assigns incremental IDs', () => {
    addDebugLog('info', ['Test message 1']);
    addDebugLog('error', ['Test message 2'], 'ism');

    const logs = getDebugLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe('Test message 1');
    expect(logs[0].level).toBe('info');
    expect(logs[0].source).toBe('console');

    expect(logs[1].message).toBe('Test message 2');
    expect(logs[1].level).toBe('error');
    expect(logs[1].source).toBe('ism');

    expect(logs[1].id).toBeGreaterThan(logs[0].id);
  });

  it('handles Error objects and formats them', () => {
    const err = new Error('Something broke');
    addDebugLog('error', [err]);

    const logs = getDebugLogs();
    expect(logs[0].message).toContain('Something broke');
  });

  it('handles object payloads', () => {
    addDebugLog('info', [{ data: 123 }]);

    const logs = getDebugLogs();
    expect(logs[0].message).toBe('Object logged');
    expect(logs[0].payload).toEqual([{ data: 123 }]);
  });

  it('subscribes and notifies listeners', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDebugLogs(listener);

    expect(listener).toHaveBeenCalledWith([]);

    addDebugLog('info', ['New log']);

    vi.runAllTimers();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0][0].message).toBe('New log');

    unsubscribe();
  });

  it('calls tauri invoke for append_debug_log if in tauri runtime', () => {
    vi.spyOn(tauriRuntime, 'isTauriRuntime').mockReturnValue(true);
    addDebugLog('warn', ['Warning message']);

    expect(invoke).toHaveBeenCalledWith('append_debug_log', {
      level: 'warn',
      source: 'console',
      message: 'Warning message',
    });
  });

  it('truncates logs at MAX_LOGS', () => {
    for (let i = 0; i < 1010; i++) {
      addDebugLog('info', [`log ${i}`]);
    }
    const logs = getDebugLogs();
    expect(logs.length).toBe(1000);
    expect(logs[999].message).toBe('log 1009');
  });

  describe('global hooks', () => {
    it('window.ismLog invokes addDebugLog with source ism', () => {
      window.ismLog('success', 'Operation completed');
      const logs = getDebugLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('success');
      expect(logs[0].message).toBe('Operation completed');
      expect(logs[0].source).toBe('ism');
    });
  });
});
