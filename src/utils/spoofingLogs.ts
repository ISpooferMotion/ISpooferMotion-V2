// ISM-V2-PROVENANCE: FDDDD7215AE9CC791E6F00F4
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

const MAX_LOG_LINES = 750;

const TIMESTAMP_RE = /^\[\d{2}:\d{2}:\d{2}\]/;

function currentTimestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `[${hh}:${mm}:${ss}]`;
}

export function appendSpoofingLog(prev: string[], chunk: string): string[] {
  const stripped = chunk.trim();
  if (!stripped) return prev;
  const stamped = TIMESTAMP_RE.test(stripped) ? stripped : `${currentTimestamp()} ${stripped}`;
  const newLogs = [...prev, stamped];
  if (newLogs.length > MAX_LOG_LINES) {
    return newLogs.slice(newLogs.length - MAX_LOG_LINES);
  }
  return newLogs;
}

// ISM-V2-PROVENANCE-END: FDDDD7215AE9CC791E6F00F4
