import { describe, expect, it } from 'vitest';
import { isCorrectGuess, normalizeGuess } from '../../games/draw-guess/guess';
import { WORDS } from '../../games/draw-guess/words';
import { QUESTIONS } from '../../games/trivia/questions';

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

describe('trivia questions', () => {
  it('are well-formed and fit controller limits', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(10);
    for (const q of QUESTIONS) {
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(4);
      for (const loc of [q.he, q.en]) {
        expect(loc.q.length).toBeLessThanOrEqual(200);
        expect(new Set(loc.a).size).toBe(4);
        for (const a of loc.a) expect(a.length).toBeLessThanOrEqual(80);
      }
    }
  });
});
