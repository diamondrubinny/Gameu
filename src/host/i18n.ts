import { isRtl, type Lang } from '../shared/i18n';
import { ar } from './locales/ar';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { he, type HostDict } from './locales/he';
import { ru } from './locales/ru';

export type { Lang };

const DICTS: Record<Lang, HostDict> = { he, en, ar, ru, es, fr };

let current: HostDict = he;
let currentLang: Lang = 'he';

/** Sets the TV language (document lang/dir included). */
export function setLang(lang: Lang): void {
  currentLang = lang;
  current = DICTS[lang] ?? en;
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
}

export function lang(): Lang {
  return currentLang;
}

/** Texts in a specific language (e.g. a player's phone language). */
export function tFor(l: Lang): HostDict {
  return DICTS[l] ?? en;
}

/** Texts in the TV language. */
export const t = new Proxy({} as HostDict, { get: (_t, key: string) => current[key as keyof HostDict] });
