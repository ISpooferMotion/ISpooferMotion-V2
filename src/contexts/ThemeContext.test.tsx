import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useThemeAccent } from './ThemeContext';

function CurrentTheme() {
  const { themeMode } = useThemeAccent();
  return <span>{themeMode}</span>;
}

describe('ThemeProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still renders when localStorage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
    });
    render(
      <ThemeProvider>
        <CurrentTheme />
      </ThemeProvider>,
    );
    expect(screen.getByText(/light|dark/)).toBeInTheDocument();
  });
});
