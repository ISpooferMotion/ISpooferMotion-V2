import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const readSetting = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const saveSetting = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = readSetting('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const [accentColor, setAccentColor] = useState<string>(() => {
    return readSetting('accentColor') || '#10b981';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
    saveSetting('theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', accentColor);
    saveSetting('accentColor', accentColor);
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
