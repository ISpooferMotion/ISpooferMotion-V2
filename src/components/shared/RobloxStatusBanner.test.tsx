import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as LanguageContext from '../../contexts/LanguageContext';
import { RobloxStatusBanner } from './RobloxStatusBanner';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

describe('RobloxStatusBanner', () => {
  it('renders nothing when isVisible is false', () => {
    (LanguageContext.useLanguage as any).mockReturnValue({ t: (k: string) => k });
    const { container } = render(<RobloxStatusBanner isVisible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner when isVisible is true', () => {
    (LanguageContext.useLanguage as any).mockReturnValue({
      t: (k: string) => (k === 'misc.robloxApiDown' ? 'Roblox API is down' : k),
    });
    render(<RobloxStatusBanner isVisible={true} />);

    expect(screen.getByText('Roblox API is down')).toBeInTheDocument();
  });
});
