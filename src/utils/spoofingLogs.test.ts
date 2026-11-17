import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appendSpoofingLog } from './spoofingLogs';

describe('appendSpoofingLog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 34, 56));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends a single line', () => {
    const result = appendSpoofingLog([], '[INFO] hello');
    expect(result).toEqual(['[12:34:56] [INFO] hello']);
  });

  it('preserves multi-line chunks as a single entry for color formatting', () => {
    const result = appendSpoofingLog([], 'line1\nline2\nline3');
    expect(result).toEqual(['[12:34:56] line1\nline2\nline3']);
  });

  it('ignores empty or whitespace-only chunks', () => {
    expect(appendSpoofingLog(['existing'], '')).toEqual(['existing']);
    expect(appendSpoofingLog(['existing'], '   ')).toEqual(['existing']);
  });

  it('trims chunk before appending', () => {
    const result = appendSpoofingLog([], '  [WARN] trimmed  ');
    expect(result).toEqual(['[12:34:56] [WARN] trimmed']);
  });

  it('does not add a second timestamp to backend-stamped chunks', () => {
    const result = appendSpoofingLog([], '[09:08:07] [INFO] already stamped');
    expect(result).toEqual(['[09:08:07] [INFO] already stamped']);
  });

  it('caps the log at 750 lines', () => {
    const existing = Array.from({ length: 749 }, (_, i) => `line ${i}`);
    const result = appendSpoofingLog(existing, 'new entry');
    expect(result).toHaveLength(750);
    expect(result[result.length - 1]).toBe('[12:34:56] new entry');
  });

  it('slices from the end when over the limit', () => {
    const existing = Array.from({ length: 750 }, (_, i) => `old ${i}`);
    const result = appendSpoofingLog(existing, 'new line');
    expect(result).toHaveLength(750);
    expect(result[result.length - 1]).toBe('[12:34:56] new line');
    expect(result[0]).toBe('old 1');
  });

  it('accumulates multiple appends correctly', () => {
    let logs: string[] = [];
    logs = appendSpoofingLog(logs, '[INFO] start');
    logs = appendSpoofingLog(logs, '[SUCCESS] done');
    expect(logs).toEqual(['[12:34:56] [INFO] start', '[12:34:56] [SUCCESS] done']);
  });
});
