import { create } from 'zustand';

import { getTranslation } from '../utils/i18n';

interface LanguageState {
  lang: string;
  setLang: (lang: string) => void;
  t: (keyPath: string) => string;
}

const getInitialLang = () => {
  // Use previously saved language if available.
  const hasStorage =
    typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  const savedLang = hasStorage ? localStorage.getItem('language') : null;
  if (savedLang) return savedLang;

  // Guess language from browser, fallback to English if unsupported.
  const systemLang = navigator.language ? navigator.language.split('-')[0] : 'en';
  const supported = ['en', 'es', 'ru', 'fr'];
  if (supported.includes(systemLang)) {
    if (hasStorage && typeof localStorage.setItem === 'function') {
      localStorage.setItem('language', systemLang);
    }
    return systemLang;
  }
  return 'en';
};

/**
 * Global Zustand store for tracking the active application language.
 *
 * Drives all i18n features in the UI. When updated, React components instantly
 * re-render with the new translations.
 */
export const useLanguage = create<LanguageState>((set, get) => ({
  lang: getInitialLang(),
  setLang: (newLang: string) => {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem('language', newLang);
    }
    set({ lang: newLang });
  },
  t: (keyPath: string) => getTranslation(get().lang, keyPath),
}));

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
