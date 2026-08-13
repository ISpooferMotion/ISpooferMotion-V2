import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

import { invoke } from '@tauri-apps/api/core';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hasStorage =
    typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = hasStorage ? localStorage.getItem('theme') : null;
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const [accentColor, setAccentColor] = useState<string>(() => {
    return (hasStorage ? localStorage.getItem('accentColor') : null) || '#10b981';
  });

  // Sync theme mode to DOM
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
    if (hasStorage && typeof localStorage.setItem === 'function') {
      localStorage.setItem('theme', themeMode);
    }
  }, [themeMode]);

  // Sync accent color to DOM
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', accentColor);
    if (hasStorage && typeof localStorage.setItem === 'function') {
      localStorage.setItem('accentColor', accentColor);
    }
    invoke('set_plugin_theme_accent', { color: accentColor }).catch(console.error);
  }, [accentColor]);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, accentColor, setAccentColor }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useThemeAccent = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useThemeAccent must be used within a ThemeProvider');
  }
  return context;
};
