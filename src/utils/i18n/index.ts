// ISM-V2-PROVENANCE: 212090D6A81D61562BE84B8A
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { ru } from './ru';

const locales: Record<string, TranslationTree> = { en, es, ru, fr };

export function getTranslation(lang: string, keyPath: string): string {
  const dictionary = locales[lang] || locales.en;
  const keys = keyPath.split('.');

  let current: string | TranslationTree | undefined = dictionary;
  for (const k of keys) {
    if (typeof current !== 'object' || current === null || !(k in current)) {
      let fallback: string | TranslationTree | undefined = locales.en;
      for (const fk of keys) {
        if (typeof fallback !== 'object' || fallback === null || !(fk in fallback)) {
          return keyPath;
        }
        fallback = fallback[fk];
      }
      return typeof fallback === 'string' ? fallback : keyPath;
    }
    current = current[k];
  }
  return typeof current === 'string' ? current : keyPath;
}

// ISM-V2-PROVENANCE-END: 212090D6A81D61562BE84B8A
