/** Supported languages (dependency-free; shared by server, TV, phones and games). */
export const LANGUAGES = [
  { code: 'he', name: 'עברית', dir: 'rtl' },
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'ru', name: 'Русский', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];
export const LANG_CODES = LANGUAGES.map((l) => l.code) as [Lang, ...Lang[]];

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANG_CODES as string[]).includes(v);
}

export function isRtl(lang: Lang): boolean {
  return LANGUAGES.find((l) => l.code === lang)?.dir === 'rtl';
}

export function languageName(lang: Lang): string {
  return LANGUAGES.find((l) => l.code === lang)?.name ?? lang;
}

/** Best supported match for a browser's language list (e.g. navigator.languages), or the fallback. */
export function detectLang(preferred: readonly string[], fallback: Lang = 'en'): Lang {
  for (const p of preferred) {
    const base = p.toLowerCase().split('-')[0];
    if (base === 'iw') return 'he'; // legacy code for Hebrew
    if (isLang(base)) return base;
  }
  return fallback;
}

/** Picks a translation with English, then Hebrew, as fallbacks. */
export function pick<T>(map: Partial<Record<Lang, T>> & { en: T }, lang: Lang): T {
  return map[lang] ?? map.en;
}
