import { detectLang, isLang, isRtl, type Lang } from '../shared/i18n';
import { storage } from '../ui/dom';
import { ar } from './locales/ar';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { he, type ControllerDict } from './locales/he';
import { ru } from './locales/ru';

const DICTS: Record<Lang, ControllerDict> = { he, en, ar, ru, es, fr };
const STORAGE_KEY = 'gameu.lang';

function initialLang(): Lang {
  const saved = storage.get(STORAGE_KEY);
  if (isLang(saved)) return saved;
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  return detectLang(prefs, 'en');
}

let currentLang: Lang = initialLang();
let current: ControllerDict = DICTS[currentLang];

export function lang(): Lang {
  return currentLang;
}

/** Switches the phone's language (remembered on this device). */
export function setLang(l: Lang): void {
  currentLang = l;
  current = DICTS[l] ?? en;
  storage.set(STORAGE_KEY, l);
  applyDocumentLang();
}

export function applyDocumentLang(): void {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = isRtl(currentLang) ? 'rtl' : 'ltr';
  document.title = current.title;
}

export const t = new Proxy({} as ControllerDict, { get: (_t, key: string) => current[key as keyof ControllerDict] });

/** Layout texts the server sends as keys rather than prose. */
export function layoutText(text: string): string {
  if (text === 'host_offline') return t.hostOffline;
  return text;
}
