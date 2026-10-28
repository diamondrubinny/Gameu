import { describe, expect, it } from 'vitest';
import { isCorrectGuess, normalizeGuess } from '../../games/draw-guess/guess';
import { WORDS } from '../../games/draw-guess/words';

describe('draw & guess matching', () => {
  it('ignores case, spaces, punctuation, niqqud and final letters', () => {
    expect(isCorrectGuess('  חָתוּל! ', ['חתול'])).toBe(true);
    expect(isCorrectGuess('Ice-Cream', ['ice cream'])).toBe(true);
    expect(isCorrectGuess('שעונ', ['שעון'])).toBe(true);
    expect(isCorrectGuess('כלבים', ['כלב'])).toBe(false);
    expect(isCorrectGuess('', ['כלב'])).toBe(false);
    expect(normalizeGuess("ג'ירפה")).toBe(normalizeGuess('ג׳ירפה'));
  });
  it('has unique, non-empty words', () => {
    const he = WORDS.map((w) => normalizeGuess(w.he));
    expect(new Set(he).size).toBe(he.length);
    expect(WORDS.every((w) => w.he && w.en)).toBe(true);
  });
});
