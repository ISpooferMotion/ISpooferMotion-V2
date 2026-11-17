import * as TauriDialog from '@tauri-apps/plugin-dialog';
import * as TauriFs from '@tauri-apps/plugin-fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as LanguageContext from '../../contexts/LanguageContext';
import * as SpooferStore from '../../stores/spooferStore';
import ResultsModal from './ResultsModal';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('../../stores/spooferStore', () => ({
  useSpooferStore: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

describe('ResultsModal', () => {
  const mockT = vi.fn((key) => key);
  const mockSetSpoofingLogs = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({ t: mockT } as any);

    vi.mocked(SpooferStore.useSpooferStore).mockImplementation((selector: any) => {
      const state = {
        lastReplacements: { '123': '456', '789': '012' },
        assetMetadataMap: { '123': { name: 'Test Asset', type: 'animation' } },
        loadedFilePath: 'C:/test/file.rbxlx',
        setSpoofingLogs: mockSetSpoofingLogs,
      };
      return selector(state);
    });
  });

  it('renders nothing if not isOpen', () => {
    render(<ResultsModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('results.title')).not.toBeInTheDocument();
  });

  it('renders replacements and handles copy', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });

    render(<ResultsModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('results.title')).toBeInTheDocument();
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.getByText('456')).toBeInTheDocument();

    const copyBtn = screen.getByText('results.copyAll');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('123 -> 456\n789 -> 012');

    expect(screen.getByText('common.copied')).toBeInTheDocument();
  });

  it('handles saving rbxlx correctly', async () => {
    const onClose = vi.fn();
    vi.mocked(TauriDialog.save).mockResolvedValue('C:/test/file_Spoofed.rbxlx');
    vi.mocked(TauriFs.readTextFile).mockResolvedValue('<roblox>123 and 789</roblox>');

    render(<ResultsModal isOpen={true} onClose={onClose} />);

    const saveBtn = screen.getByText('Save Spoofed .rbxlx');
    fireEvent.click(saveBtn);

    expect(TauriDialog.save).toHaveBeenCalled();

    await waitFor(() => {
      expect(TauriFs.readTextFile).toHaveBeenCalledWith('C:/test/file.rbxlx');
      expect(TauriFs.writeTextFile).toHaveBeenCalledWith(
        'C:/test/file_Spoofed.rbxlx',
        '<roblox>456 and 012</roblox>',
      );
      expect(onClose).toHaveBeenCalled();
      expect(mockSetSpoofingLogs).toHaveBeenCalled();
    });
  });

  it('does not save if user cancels save dialog', async () => {
    vi.mocked(TauriDialog.save).mockResolvedValue(null);
    render(<ResultsModal isOpen={true} onClose={() => {}} />);

    const saveBtn = screen.getByText('Save Spoofed .rbxlx');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(TauriFs.readTextFile).not.toHaveBeenCalled();
    });
  });

  it('renders empty state if no replacements', () => {
    vi.mocked(SpooferStore.useSpooferStore).mockImplementation((selector: any) => {
      const state = {
        lastReplacements: {},
        assetMetadataMap: {},
        loadedFilePath: 'C:/test/file.rbxlx',
        setSpoofingLogs: mockSetSpoofingLogs,
      };
      return selector(state);
    });

    render(<ResultsModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('results.noReplacements')).toBeInTheDocument();
    expect(screen.queryByText('Save Spoofed .rbxlx')).not.toBeInTheDocument();
  });
});
