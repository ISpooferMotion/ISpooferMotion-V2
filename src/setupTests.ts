import '@testing-library/jest-dom';

import { vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

type TauriEventHandler = (event: { event: string; payload: unknown }) => void;

const { listeners } = vi.hoisted(() => ({
  listeners: {} as Record<string, TauriEventHandler[]>,
}));

vi.mock('@tauri-apps/api/core', () => {
  return {
    invoke: vi.fn((cmd, _args) => {
      if (cmd === 'get_config') return Promise.resolve({});
      if (cmd === 'is_update_available') return Promise.resolve(false);
      return Promise.resolve(null);
    }),
    __listeners: listeners,
  };
});

vi.mock('@tauri-apps/api/event', () => {
  return {
    listen: vi.fn((event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
      return Promise.resolve(() => {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      });
    }),
    emit: vi.fn((event, payload) => {
      if (listeners[event]) {
        listeners[event].forEach((handler) => handler({ event, payload }));
      }
      return Promise.resolve();
    }),
  };
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    toggleMaximize: vi.fn(),
  }),
}));
