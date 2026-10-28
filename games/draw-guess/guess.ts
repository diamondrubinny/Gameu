/**
 * Lenient comparison for guesses in any supported language: ignores case, accents,
 * Hebrew niqqud and final letters, Arabic harakat and letter variants, Russian ё/й,
 * punctuation and spaces.
 */
export function normalizeGuess(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, '') // Hebrew niqqud & cantillation
    .replace(/[\u0300-\u036F]/g, '') // Latin/Cyrillic combining accents (é→e, ё→е, й→и)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // Arabic harakat, superscript alef, tatweel
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627') // أ إ آ ٱ → ا
    .replace(/\u0629/g, '\u0647') // ة → ه
    .replace(/\u0649/g, '\u064A') // ى → ي
    .replace(/[\u05DA\u05DD\u05DF\u05E3\u05E5]/g, (c) => ({ '\u05DA': '\u05DB', '\u05DD': '\u05DE', '\u05DF': '\u05E0', '\u05E3': '\u05E4', '\u05E5': '\u05E6' })[c] ?? c) // ך ם ן ף ץ → כ מ נ פ צ
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Leading articles that players naturally type ("the cat", "un chat", "el gato", "l'arbre"). */
const ARTICLES = /^(?:the|an?|l['\u2019]|les?|la|une?|des|el|los|las|unos?|unas?)\s*(?=\S)/i;
/** Arabic definite article ال ("القطة" → "قطة"), only before a word of 2+ letters. */
const ARABIC_DEFINITE = /^\u0627\u0644(?=\S{2,})/;

function stripArticle(s: string): string {
  const trimmed = s.trim();
  // An article counts only when followed by a space or an apostrophe ("lapin" keeps its "la").
  return trimmed.replace(ARTICLES, (m) => (/['\u2019]$/.test(m) || /\s$/.test(m) ? '' : m)).replace(ARABIC_DEFINITE, '');
}

export function isCorrectGuess(guess: string, answers: string[]): boolean {
  const forms = (s: string) => [normalizeGuess(s), normalizeGuess(stripArticle(s))].filter(Boolean);
  const g = forms(guess);
  return g.length > 0 && answers.some((a) => forms(a).some((f) => g.includes(f)));
}
