import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './tauriRuntime';

type LogLevel = 'info' | 'success' | 'warn' | 'error';
type LogSource = 'console' | 'ism';

export interface LogEntry {
  id: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  payload?: unknown[];
  timestamp: string;
}

// Lazy loaded to prevent circular dependencies.
let cachedConfigStore: typeof import('../stores/configStore') | null = null;

const MAX_LOGS = 1000;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false,
});

type Listener = (logs: LogEntry[]) => void;

interface DebugLoggerState {
  logs: LogEntry[];
  counter: number;
  listeners: Set<Listener>;
  patched: boolean;
  originals?: {
    log: typeof console.log;
    info: typeof console.info;
    debug: typeof console.debug;
    warn: typeof console.warn;
    error: typeof console.error;
    success: (...args: unknown[]) => void;
  };
}

declare global {
  interface Window {
    ismLog: (level: LogLevel, message: string, notify?: boolean) => void;
    __ismDebugLogger?: DebugLoggerState;
  }
}

// Initialize or retrieve global logger state across hot reloads.
function getState(): DebugLoggerState {
  if (!window.__ismDebugLogger) {
    window.__ismDebugLogger = {
      logs: [],
      counter: 0,
      listeners: new Set(),
      patched: false,
    };
  }
  return window.__ismDebugLogger;
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  try {
    return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Injects a new log line into the in-memory circular buffer and optionally forwards
 * it to the Rust backend (for disk persistence) and triggers desktop notifications.
 */
export function addDebugLog(
  level: LogLevel,
  args: unknown[],
  source: LogSource = 'console',
  notify: boolean = false,
) {
  const state = getState();
  const messageArgs = args.filter((arg) => typeof arg === 'string' || arg instanceof Error);
  const payloadArgs = args.filter((arg) => typeof arg !== 'string' && !(arg instanceof Error));

  const entry: LogEntry = {
    id: state.counter++,
    level,
    source,
    message: messageArgs.length > 0 ? messageArgs.map(formatArg).join(' ') : '',
    payload: payloadArgs.length > 0 ? payloadArgs : undefined,
    timestamp: timeFormatter.format(new Date()),
  };

  // Set a default message if only a payload is provided.
  if (!entry.message && entry.payload) {
    entry.message = 'Object logged';
  }

  state.logs = [...state.logs, entry].slice(-MAX_LOGS);
  setTimeout(() => {
    state.listeners.forEach((listener) => listener(state.logs));
  }, 0);

  if (isTauriRuntime()) {
    try {
      invoke('append_debug_log', {
        level: entry.level,
        source: entry.source,
        message: entry.message,
      }).catch((err) => {
        console.error('Failed to emit active debug logs update:', err);
      });
    } catch (e) {
      console.error('Synchronous emit failure:', e);
    }
  }

  if (
    notify &&
    (level === 'success' || level === 'error' || level === 'warn') &&
    isTauriRuntime()
  ) {
    try {
      if (!cachedConfigStore) {
        import('../stores/configStore').then((mod) => {
          cachedConfigStore = mod;
        });
      }

      if (cachedConfigStore) {
        const config = cachedConfigStore.useConfigStore.getState().config;
        if (config?.general?.desktopNotifications) {
          const title =
            level === 'success'
              ? 'ISpooferMotion - Success'
              : level === 'error'
                ? 'ISpooferMotion - Error'
                : 'ISpooferMotion - Warning';
          invoke('show_notification', {
            options: { title, body: entry.message },
          }).catch((err) => {
            console.error('Failed to emit batch active debug logs update:', err);
          });
        }
      }
    } catch (e) {
      console.error('Synchronous batch emit failure:', e);
    }
  }
}

export function subscribeDebugLogs(listener: Listener) {
  const state = getState();
  state.listeners.add(listener);
  listener(state.logs);
  return () => {
    state.listeners.delete(listener);
  };
}

export function getDebugLogs() {
  return getState().logs;
}

export function clearDebugLogs() {
  const state = getState();
  state.logs = [];
  state.listeners.forEach((listener) => listener([]));
}

/**
 * Monkey-patches `console.log`, `console.warn`, etc. globally.
 *
 * This ensures that any standard React/library logs get funneled into our custom
 * Debug Console view in the app UI, not just hidden away in the WebView inspector.
 */
function installDebugLogger() {
  const state = getState();
  if (state.patched) return;

  // Intercept and record console output.
  const originals = {
    log: Reflect.get(console, 'log').bind(console),
    info: Reflect.get(console, 'info').bind(console),
    debug: Reflect.get(console, 'debug').bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    success: (Reflect.get(console, 'success') || Reflect.get(console, 'info')).bind(console),
  };
  state.originals = originals;
  state.patched = true;

  Reflect.set(console, 'log', (...args: unknown[]) => {
    originals.log(...args);
    addDebugLog('info', args, 'console');
  });
  Reflect.set(console, 'info', (...args: unknown[]) => {
    originals.info(...args);
    addDebugLog('info', args, 'console');
  });
  Reflect.set(console, 'debug', (...args: unknown[]) => {
    originals.debug(...args);
    addDebugLog('info', args, 'console');
  });
  Reflect.set(console, 'success', (...args: unknown[]) => {
    originals.success(...args);
    addDebugLog('success', args, 'console');
  });
  console.warn = (...args) => {
    originals.warn(...args);
    addDebugLog('warn', args, 'console');
  };
  console.error = (...args) => {
    originals.error(...args);
    addDebugLog('error', args, 'console');
  };

  window.addEventListener('error', (event) => {
    addDebugLog('error', [event.error || event.message || 'Unhandled window error'], 'console');
  });
  window.addEventListener('unhandledrejection', (event) => {
    addDebugLog('error', [event.reason || 'Unhandled promise rejection'], 'console');
  });

  window.ismLog = (level: LogLevel, message: string, notify?: boolean) => {
    addDebugLog(level, [message], 'ism', notify);
  };

  if (isTauriRuntime()) {
    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        listen('log://log', (event: any) => {
          const payload = event.payload;
          if (!payload) return;

          let level: LogLevel = 'info';
          if (payload.level === 1) level = 'error';
          else if (payload.level === 2) level = 'warn';
          else if (payload.level === 3 || payload.level === 4 || payload.level === 5)
            level = 'info';

          const message = payload.message || JSON.stringify(payload);

          // Prevent feedback loop: don't log messages that originated from JS append_debug_log
          if (typeof message === 'string' && message.includes('[ui]')) return;
          if (typeof message === 'string' && message.includes('[ism]')) return;
          if (typeof message === 'string' && message.includes('[console]')) return;

          addDebugLog(level, [message], 'ism');
        }).catch((e) => {
          console.error('Failed to listen to tauri-plugin-log:', e);
        });
      })
      .catch((e) => console.error('Failed to load tauri events', e));
  }
}

installDebugLogger();
