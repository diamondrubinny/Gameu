/** Helpers shared by the bundled games (not part of the public SDK surface). */
export { h, clear, $ } from '../ui/dom';

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sets the language/direction of the game document from console settings. */
export function applyDocumentSettings(settings: { language: 'he' | 'en'; textScale: number; highContrast: boolean; reduceMotion: boolean }): void {
  const html = document.documentElement;
  html.lang = settings.language;
  html.dir = settings.language === 'he' ? 'rtl' : 'ltr';
  html.style.setProperty('--text-scale', String(settings.textScale));
  html.classList.toggle('high-contrast', settings.highContrast);
  html.classList.toggle('reduce-motion', settings.reduceMotion);
}

/** Screen-reader announcement through the game's live region (#live). */
export function announce(text: string): void {
  const live = document.getElementById('live');
  if (live) live.textContent = text;
}
