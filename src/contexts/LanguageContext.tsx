import { create } from 'zustand';

import { getTranslation } from '../utils/i18n';

interface LanguageState {
  lang: string;
  setLang: (lang: string) => void;
  t: (keyPath: string) => string;
}

const readLanguage = () => {
  try {
    return window.localStorage.getItem('language');
  } catch {
    return null;
  }
};

const saveLanguage = (language: string) => {
  try {
    window.localStorage.setItem('language', language);
  } catch {
    return;
  }
};

const getInitialLang = () => {
  const savedLang = readLanguage();
  if (savedLang) return savedLang;

  const systemLang = navigator.language ? navigator.language.split('-')[0] : 'en';
  const supported = ['en', 'es', 'ru', 'fr'];
  if (supported.includes(systemLang)) {
    saveLanguage(systemLang);
    return systemLang;
  }
  return 'en';
};

export const useLanguage = create<LanguageState>((set, get) => ({
  lang: getInitialLang(),
  setLang: (newLang: string) => {
    saveLanguage(newLang);
    set({ lang: newLang });
  },
  t: (keyPath: string) => getTranslation(get().lang, keyPath),
}));

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
