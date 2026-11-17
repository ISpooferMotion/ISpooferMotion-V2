import * as tauriApp from '@tauri-apps/api/app';
import * as tauriOs from '@tauri-apps/plugin-os';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConfigStore } from '../../stores/configStore';
import * as apiClient from '../../utils/apiClient';
import * as tauriRuntime from '../../utils/tauriRuntime';
import { ErrorBoundary } from './ErrorBoundary';

declare let process: any;

vi.mock('../../utils/apiClient', () => ({
  fetchTelemetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: vi.fn().mockReturnValue(false),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.0.0'),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  type: vi.fn().mockResolvedValue('windows'),
  version: vi.fn().mockResolvedValue('10.0.0'),
}));

const ThrowError = ({ shouldThrow }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error!');
  }
  return <div>Safe Component</div>;
};

describe('ErrorBoundary', () => {
  let originalEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env;
    useConfigStore.setState({
      config: {
        general: { telemetryEnabled: true },
      } as any,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('renders children if no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Safe Component')).toBeInTheDocument();
  });

  it('renders fallback UI when an error occurs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Something stopped working/)).toBeInTheDocument();
    expect(screen.getByText(/Test error!/)).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it('sends telemetry if enabled and not in tauri runtime', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    await vi.waitFor(() => {
      expect(apiClient.fetchTelemetry).toHaveBeenCalled();
    });

    expect(apiClient.fetchTelemetry).toHaveBeenCalledWith(
      'https://ispoofermotion.com/api/app-errors',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('Test error!'),
      },
    );

    consoleError.mockRestore();
  });

  it('sends telemetry with OS info if in tauri runtime', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(tauriRuntime.isTauriRuntime).mockReturnValue(true);

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    await vi.waitFor(() => {
      expect(apiClient.fetchTelemetry).toHaveBeenCalled();
    });

    expect(tauriApp.getVersion).toHaveBeenCalled();
    expect(tauriOs.type).toHaveBeenCalled();

    const fetchCall = vi.mocked(apiClient.fetchTelemetry).mock.calls[0];
    const payload = JSON.parse(fetchCall[1]!.body as string);

    expect(payload.appVersion).toBe('1.0.0');
    expect(payload.osInfo).toBe('windows 10.0.0');

    consoleError.mockRestore();
  });

  it('does not send telemetry if disabled', async () => {
    useConfigStore.setState({
      config: {
        general: { telemetryEnabled: false },
      } as any,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(apiClient.fetchTelemetry).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('reload button calls window.location.reload', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reloadMock = vi.fn();

    const originalLocation = window.location;
    delete (window as any).location;
    window.location = { ...originalLocation, reload: reloadMock } as any;

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    const reloadBtn = screen.getByText('Reload Application');
    fireEvent.click(reloadBtn);

    expect(reloadMock).toHaveBeenCalled();

    window.location = originalLocation as any;
    consoleError.mockRestore();
  });
});
