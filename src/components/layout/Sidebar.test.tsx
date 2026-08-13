import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from './Sidebar';
import { vi, describe, it, expect } from 'vitest';
import * as LanguageContext from '../../contexts/LanguageContext';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('../../contexts/StudioConnectionContext', () => ({
  useStudioConnectionState: () => ({ studioConnected: true }),
}));

vi.mock('../../contexts/ConfigContext', () => ({
  useConfig: () => ({
    config: {
      ui: { theme: 'dark', language: 'en' },
      advanced: { forcePlaceIds: '' },
      spoofing: { selectedUser: 'none', selectedGroup: 'none', cookie: '', apiKey: '' },
      accounts: [],
    },
    updateConfig: vi.fn(),
  }),
}));

describe('Sidebar', () => {
  const mockT = vi.fn((key) => {
    const map: Record<string, string> = {
      'nav.spoofing': 'Spoofing',
      'nav.activity': 'Activity',
      'nav.settings': 'Settings',
    };
    return map[key] || key;
  });

  beforeEach(() => {
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({ t: mockT } as any);
  });

  it('renders all tabs with correct labels', () => {
    render(<Sidebar activeTab="spoofing" onTabChange={() => {}} />);

    expect(screen.getByText('Spoofing')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('calls onTabChange with correct id when a tab is clicked', () => {
    const handleTabChange = vi.fn();
    render(<Sidebar activeTab="spoofing" onTabChange={handleTabChange} />);

    fireEvent.click(screen.getByText('Settings'));
    expect(handleTabChange).toHaveBeenCalledWith('settings');
  });

  it('applies active styling to the active tab', () => {
    render(<Sidebar activeTab="activity" onTabChange={() => {}} />);

    const activityBtn = screen.getByText('Activity').closest('[role="button"]');
    const spoofingBtn = screen.getByText('Spoofing').closest('[role="button"]');

    expect(activityBtn).toHaveClass('bg-bg-elevated');
    expect(spoofingBtn).not.toHaveClass('bg-bg-elevated');
  });
});
