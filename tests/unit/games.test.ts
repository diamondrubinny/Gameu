import { describe, expect, it } from 'vitest';
import { isCorrectGuess, normalizeGuess } from '../../games/draw-guess/guess';
import { DICTS } from '../../games/draw-guess/locales';
import { WORD_KEYS } from '../../games/draw-guess/words';

describe('draw & guess matching', () => {
  it('ignores case, spaces, punctuation, niqqud and final letters', () => {
    expect(isCorrectGuess('  חָתוּל! ', ['חתול'])).toBe(true);
    expect(isCorrectGuess('Ice-Cream', ['ice cream'])).toBe(true);
    expect(isCorrectGuess('שעונ', ['שעון'])).toBe(true);
    expect(isCorrectGuess('כלבים', ['כלב'])).toBe(false);
    expect(isCorrectGuess('', ['כלב'])).toBe(false);
    expect(normalizeGuess("ג'ירפה")).toBe(normalizeGuess('ג׳ירפה'));
  });
  it('accepts Arabic, Russian, Spanish and French spelling variants', () => {
    expect(isCorrectGuess('قِطَّة', ['قطة'])).toBe(true); // harakat
    expect(isCorrectGuess('قطه', ['قطة'])).toBe(true); // ta marbuta written as ha
    expect(isCorrectGuess('أرنب', ['ارنب'])).toBe(true); // hamza on alef
    expect(isCorrectGuess('ёлка', ['елка'])).toBe(true);
    expect(isCorrectGuess('ÁRBOL', ['árbol'])).toBe(true);
    expect(isCorrectGuess('gâteau', ['gateau'])).toBe(true);
    // Leading articles are ignored, but not when they are the start of the word itself.
    expect(isCorrectGuess('un chat', ['chat'])).toBe(true);
    expect(isCorrectGuess("l'arbre", ['arbre'])).toBe(true);
    expect(isCorrectGuess('the cat', ['cat'])).toBe(true);
    expect(isCorrectGuess('el gato', ['gato'])).toBe(true);
    expect(isCorrectGuess('القطة', ['قطة'])).toBe(true);
    expect(isCorrectGuess('lapin', ['pin'])).toBe(false);
    expect(isCorrectGuess('lune', ['une'])).toBe(false);
    expect(isCorrectGuess('ant', ['t'])).toBe(false);
  });

  it('has a non-empty, unique word list in every language', () => {
    for (const [lang, dict] of Object.entries(DICTS)) {
      const primaries = WORD_KEYS.map((k) => normalizeGuess(dict.words[k]?.[0] ?? ''));
      expect(primaries.every(Boolean), lang).toBe(true);
      expect(new Set(primaries).size, lang).toBe(primaries.length);
    }
  });

});
