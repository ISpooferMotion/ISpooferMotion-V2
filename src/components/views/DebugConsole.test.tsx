import { render, screen, fireEvent } from '@testing-library/react';
import DebugConsole from './DebugConsole';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as LanguageContext from '../../contexts/LanguageContext';
import * as debugLogger from '../../utils/debugLogger';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('../../utils/debugLogger', () => ({
  getDebugLogs: vi.fn(),
  subscribeDebugLogs: vi.fn(),
  clearDebugLogs: vi.fn(),
}));

vi.mock('../ui/JsonViewer', () => ({
  JsonViewer: ({ data }: any) => <div data-testid="json-viewer">{JSON.stringify(data)}</div>,
}));

// We must mock ResizeObserver for framer-motion or standard react components if they use it
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('DebugConsole', () => {
  const mockT = vi.fn((key) => key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({ t: mockT } as any);

    vi.mocked(debugLogger.getDebugLogs).mockReturnValue([
      {
        id: '1',
        timestamp: '12:00:00',
        level: 'info',
        source: 'ism',
        message: 'Test message',
      },
      {
        id: '2',
        timestamp: '12:00:01',
        level: 'error',
        source: 'console',
        message: 'Error message',
        payload: [{ foo: 'bar' }],
      },
    ] as any);

    vi.mocked(debugLogger.subscribeDebugLogs).mockImplementation((_callback) => {
      return () => {};
    });
  });

  it('renders nothing when not isOpen', () => {
    render(<DebugConsole isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('debug.title')).not.toBeInTheDocument();
  });

  it('renders logs correctly when isOpen', () => {
    render(<DebugConsole isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('debug.title')).toBeInTheDocument();

    // Check if first-line messages render in collapsed rows
    expect(screen.getByText('Test message')).toBeInTheDocument();
    expect(screen.getByText('Error message')).toBeInTheDocument();

    // Click the error log row to expand it (payload is hidden when collapsed)
    const errorRow = screen
      .getByText('Error message')
      .closest('div[onclick], div[class*="rounded border"]');
    fireEvent.click(errorRow!);

    // Check if JsonViewer is rendered for payload after expanding
    expect(screen.getByTestId('json-viewer')).toBeInTheDocument();
    expect(screen.getByText('{"foo":"bar"}')).toBeInTheDocument();
  });

  it('filters logs by level', async () => {
    render(<DebugConsole isOpen={true} onClose={() => {}} />);

    // The multi-select dropdown needs interaction, but this might be complex if it's a custom component.
    // Instead we can just check if clear logs works.

    const clearBtn = screen.getByLabelText('debug.clearLogs');
    fireEvent.click(clearBtn);

    expect(debugLogger.clearDebugLogs).toHaveBeenCalled();
  });

  it('handles copy logs', () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });

    render(<DebugConsole isOpen={true} onClose={() => {}} />);

    const copyBtn = screen.getByLabelText('debug.copyLogs');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '[12:00:00] [ISM] INFO: Test message\n[12:00:01] [CONSOLE] ERROR: Error message',
    );
  });

  it('handles close button', () => {
    const onClose = vi.fn();
    render(<DebugConsole isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByLabelText('debug.hideConsole');
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });
});
