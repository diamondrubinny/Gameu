import { describe, expect, it } from 'vitest';
import { LANG_CODES } from '../../src/shared/i18n';
import { ALPHABETS, WordRound, letterKey } from '../../games/word-guess/logic';
import { CATEGORY_KEYS, WORDS } from '../../games/word-guess/words';

describe('letter keys', () => {
  it('maps Hebrew final letters to their base letter', () => {
    expect(letterKey('ם', 'he')).toBe('מ');
    expect(letterKey('ץ', 'he')).toBe('צ');
    expect(letterKey(' ', 'he')).toBeNull();
  });
  it('maps Arabic letter variants', () => {
    expect(letterKey('أ', 'ar')).toBe('ا');
    expect(letterKey('ة', 'ar')).toBe('ه');
    expect(letterKey('ى', 'ar')).toBe('ي');
  });
  it('treats Ё as Е but keeps Й', () => {
    expect(letterKey('Ё', 'ru')).toBe('Е');
    expect(letterKey('й', 'ru')).toBe('Й');
  });
  it('strips accents but keeps Ñ in Spanish', () => {
    expect(letterKey('Á', 'es')).toBe('A');
    expect(letterKey('ñ', 'es')).toBe('Ñ');
    expect(letterKey('ç', 'fr')).toBe('C');
    expect(letterKey('ë', 'fr')).toBe('E');
    expect(letterKey('-', 'fr')).toBeNull();
  });
});

describe('word lists', () => {
  it('every letter of every word is on that language keyboard, and lists are complete', () => {
    for (const lang of LANG_CODES) {
      expect(ALPHABETS[lang].length).toBeLessThanOrEqual(40); // layout limit
      for (const cat of CATEGORY_KEYS) {
        const words = WORDS[lang][cat];
        expect(words.length, `${lang}/${cat}`).toBeGreaterThanOrEqual(10);
        expect(new Set(words).size).toBe(words.length);
        for (const w of words) {
          for (const ch of w) {
            if (ch === ' ' || ch === '-') continue;
            expect(letterKey(ch, lang), `${lang} "${w}" char "${ch}"`).not.toBeNull();
          }
        }
      }
    }
  });
});

describe('round', () => {
  it('reveals letters, counts misses and completes', () => {
    const r = new WordRound('ICE CREAM', 'en');
    expect(r.masked()).toEqual([null, null, null, ' ', null, null, null, null, null]);
    expect(r.guessLetter('e')).toEqual({ ok: true, hits: 2 });
    expect(r.guessLetter('E')).toEqual({ ok: false, hits: 0 }); // already used
    expect(r.guessLetter('z')).toEqual({ ok: true, hits: 0 });
    expect(r.misses).toEqual(['Z']);
    for (const c of 'ICRAM') r.guessLetter(c);
    expect(r.over).toBe(true);
    expect(r.solved).toBe(true);
  });

  it('Hebrew final letters are revealed by the base letter', () => {
    const r = new WordRound('מצרים', 'he');
    r.guessLetter('מ');
    expect(r.masked()).toEqual(['מ', null, null, null, 'ם']);
  });

  it('solving ignores accents, case, spaces and hyphens', () => {
    expect(new WordRound('ARC-EN-CIEL', 'fr').trySolve('arc en ciel')).toBe(true);
    expect(new WordRound('HÉLICOPTÈRE', 'fr').trySolve('helicoptere')).toBe(true);
    expect(new WordRound('הר געש', 'he').trySolve('הרגעש')).toBe(true);
    expect(new WordRound('مرآة', 'ar').trySolve('مراه')).toBe(true);
    const r = new WordRound('SHIP', 'en');
    expect(r.trySolve('SHOP')).toBe(false);
    expect(r.misses).toHaveLength(1);
  });

  it('pops after the maximum misses', () => {
    const r = new WordRound('OWL', 'en', 3);
    for (const c of 'ABC') r.guessLetter(c);
    expect(r.popped).toBe(true);
    expect(r.over).toBe(true);
    expect(r.guessLetter('O').ok).toBe(false);
  });
});
