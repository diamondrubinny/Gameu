/**
 * Guess-the-word logic, pure and language-aware: which letters exist, how accented/final/variant
 * forms map onto them, masking and solving.
 */
import type { Lang } from '../../src/shared/i18n';

export const ALPHABETS: Record<Lang, string[]> = {
  he: [...'אבגדהוזחטיכלמנסעפצקרשת'],
  en: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  ar: [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'],
  ru: [...'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'],
  es: [...'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'],
  fr: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
};

const HE_FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const AR_VARIANTS: Record<string, string> = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و' };

/** The alphabet letter a character counts as, or null for spaces/punctuation (always shown). */
export function letterKey(ch: string, lang: Lang): string | null {
  let c = ch;
  switch (lang) {
    case 'he':
      c = HE_FINALS[c] ?? c;
      break;
    case 'ar':
      c = AR_VARIANTS[c] ?? c;
      break;
    case 'ru':
      c = c.toUpperCase().replace('Ё', 'Е');
      break;
    case 'es': {
      const up = c.toUpperCase();
      c = up === 'Ñ' ? up : up.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      break;
    }
    default:
      c = c.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return ALPHABETS[lang].includes(c) ? c : null;
}

export interface GuessOutcome {
  ok: boolean;
  /** Occurrences revealed by this letter (0 = miss). */
  hits: number;
}

export class WordRound {
  readonly chars: string[];
  readonly keys: (string | null)[];
  readonly used: string[] = [];
  readonly misses: string[] = [];
  solved = false;

  constructor(readonly word: string, readonly lang: Lang, readonly maxMisses = 7) {
    this.chars = [...word];
    this.keys = this.chars.map((c) => letterKey(c, lang));
  }

  /** Characters to display: revealed letters, spaces/punctuation, or null for a hidden letter. */
  masked(): (string | null)[] {
    return this.chars.map((c, i) => {
      const k = this.keys[i] ?? null;
      return k === null || this.solved || this.used.includes(k) ? c : null;
    });
  }

  hiddenCount(): number {
    return this.masked().filter((c) => c === null).length;
  }

  get popped(): boolean {
    return this.misses.length >= this.maxMisses;
  }

  get over(): boolean {
    return this.solved || this.popped || this.hiddenCount() === 0;
  }

  guessLetter(raw: string): GuessOutcome {
    const k = letterKey(raw.trim().slice(0, 2), this.lang);
    if (!k || this.over || this.used.includes(k)) return { ok: false, hits: 0 };
    this.used.push(k);
    const hits = this.keys.filter((x) => x === k).length;
    if (hits === 0) this.misses.push(k);
    if (this.hiddenCount() === 0) this.solved = true;
    return { ok: true, hits };
  }

  /** Whole-word attempt: compares letter keys, ignoring spaces, punctuation, accents and final forms. */
  trySolve(text: string): boolean {
    if (this.over) return false;
    const norm = (s: string) => [...s].map((c) => letterKey(c, this.lang)).filter((k): k is string => k !== null).join('');
    const ok = norm(text) === norm(this.word) && norm(text).length > 0;
    if (ok) this.solved = true;
    else this.misses.push('?');
    return ok;
  }
}
