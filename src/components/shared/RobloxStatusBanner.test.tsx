// ISM-V2-PROVENANCE: 42B80DE11DA8CBFBE88B9410
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

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

// ISM-V2-PROVENANCE-END: 42B80DE11DA8CBFBE88B9410
