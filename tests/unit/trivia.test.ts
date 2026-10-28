import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../games/trivia/categories';
import { BASE_POINTS, localize, prepare, rank, scoreAnswer, selectQuestions, type Question } from '../../games/trivia/contest';
import { QUESTIONS } from '../../games/trivia/db';
// @ts-expect-error plain ESM build script without type declarations
import { CATEGORY_IDS, TRANSLATION_LANGS, validateAll, validateTranslations } from '../../scripts/validate-trivia.mjs';

/** Deterministic RNG for reproducible selections. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const q = (id: string, cat: string, d: 1 | 2 | 3): Question => ({ id, cat, d, c: 0, he: { q: `שאלה ${id}`, a: ['א', 'ב', 'ג', 'ד'] }, en: { q: `Question ${id}`, a: ['A', 'B', 'C', 'D'] } });

describe('trivia database', () => {
  it('passes the data validator (format, lengths, duplicates, coverage)', () => {
    const { errors, total } = validateAll();
    expect(errors, errors.join('\n')).toEqual([]);
    expect(total).toBeGreaterThanOrEqual(CATEGORIES.length * 20);
  });

  it('has a data file and questions for every category, and only known categories', () => {
    expect([...CATEGORY_IDS].sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
    for (const c of CATEGORIES) expect(QUESTIONS.filter((x) => x.cat === c.id).length, c.id).toBeGreaterThanOrEqual(20);
    expect(new Set(QUESTIONS.map((x) => x.id)).size).toBe(QUESTIONS.length);
  });

  it('every question fits the phone controller limits (prompt ≤ 200, option ≤ 80)', () => {
    for (const x of QUESTIONS) {
      for (const lang of ['he', 'en'] as const) {
        expect(x[lang].q.length).toBeLessThanOrEqual(200);
        for (const a of x[lang].a) expect(a.length).toBeLessThanOrEqual(80);
      }
    }
  });
});

describe('selectQuestions', () => {
  const db: Question[] = [];
  for (const cat of ['a', 'b', 'c']) for (let i = 0; i < 10; i++) db.push(q(`${cat}-${i}`, cat, ((i % 3) + 1) as 1 | 2 | 3));

  it('returns distinct questions from the chosen categories', () => {
    const out = selectQuestions(db, { categories: ['a', 'c'], count: 8, difficulty: 'mixed' }, seeded(1));
    expect(out).toHaveLength(8);
    expect(new Set(out.map((x) => x.id)).size).toBe(8);
    expect(out.every((x) => x.cat === 'a' || x.cat === 'c')).toBe(true);
  });

  it('interleaves categories so a mixed contest stays varied', () => {
    const out = selectQuestions(db, { categories: [], count: 9, difficulty: 'easy' }, seeded(2));
    const perCat = (c: string) => out.filter((x) => x.cat === c).length;
    expect(Math.max(perCat('a'), perCat('b'), perCat('c')) - Math.min(perCat('a'), perCat('b'), perCat('c'))).toBeLessThanOrEqual(1);
  });

  it('respects difficulty and ramps up in mixed mode', () => {
    expect(selectQuestions(db, { categories: [], count: 30, difficulty: 'easy' }).every((x) => x.d === 1)).toBe(true);
    expect(selectQuestions(db, { categories: [], count: 30, difficulty: 'hard' }).every((x) => x.d >= 2)).toBe(true);
    const mixed = selectQuestions(db, { categories: [], count: 12, difficulty: 'mixed' }, seeded(3));
    for (let i = 1; i < mixed.length; i++) expect(mixed[i]!.d).toBeGreaterThanOrEqual(mixed[i - 1]!.d);
  });

  it('returns what exists when asked for more, and avoids excluded ids when possible', () => {
    expect(selectQuestions(db, { categories: ['a'], count: 50, difficulty: 'mixed' })).toHaveLength(10);
    const exclude = new Set(db.filter((x) => x.cat === 'b').slice(0, 5).map((x) => x.id));
    const out = selectQuestions(db, { categories: ['b'], count: 5, difficulty: 'mixed' }, seeded(4), exclude);
    expect(out.some((x) => exclude.has(x.id))).toBe(false);
  });

  it('works on the real database for every category and level', () => {
    for (const c of CATEGORIES) {
      for (const difficulty of ['easy', 'mixed', 'hard'] as const) {
        const out = selectQuestions(QUESTIONS, { categories: [c.id], count: 10, difficulty }, seeded(5));
        expect(out.length, `${c.id}/${difficulty}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('prepare / localize', () => {
  it('shuffles answers once and keeps the correct one marked in every language', () => {
    const base: Question = { ...q('x', 'a', 1), c: 2, ru: { q: 'Вопрос x', a: ['А', 'Б', 'В', 'Г'] } };
    const seen = new Set<number>();
    for (let s = 1; s < 40; s++) {
      const p = prepare(base, seeded(s));
      const en = localize(p, 'en');
      expect(en.answers[p.correct]).toBe('C');
      expect([...en.answers].sort()).toEqual(['A', 'B', 'C', 'D']);
      expect(localize(p, 'he').answers[p.correct]).toBe('ג');
      expect(localize(p, 'ru').answers[p.correct]).toBe('В');
      seen.add(p.correct);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('falls back to English for missing translations', () => {
    const p = prepare({ ...q('y', 'a', 1), c: 0 }, seeded(1));
    expect(localize(p, 'fr').text).toBe('Question y');
  });
});

describe('trivia translations', () => {
  it('every translation language is complete and valid', () => {
    for (const lang of TRANSLATION_LANGS as string[]) {
      const { errors, translated } = validateTranslations(lang);
      expect(errors.slice(0, 20), `${lang}:\n${errors.slice(0, 20).join('\n')}`).toEqual([]);
      expect(translated, lang).toBe(QUESTIONS.length);
    }
  });

  it('db attaches translations to questions', () => {
    for (const lang of TRANSLATION_LANGS as ('ar' | 'ru' | 'es' | 'fr')[]) {
      expect(QUESTIONS.filter((x) => x[lang]).length, lang).toBe(QUESTIONS.length);
    }
  });
});

describe('scoring', () => {
  const base = { d: 2 as const, totalMs: 20_000, streak: 1, double: false };
  it('gives nothing for a wrong answer', () => {
    expect(scoreAnswer({ ...base, correct: false, remainingMs: 20_000 }).points).toBe(0);
  });
  it('scales with speed between 50% and 100% of the difficulty base', () => {
    expect(scoreAnswer({ ...base, correct: true, remainingMs: 20_000 }).points).toBe(BASE_POINTS[2]);
    expect(scoreAnswer({ ...base, correct: true, remainingMs: 0 }).points).toBe(BASE_POINTS[2] / 2);
    expect(scoreAnswer({ ...base, correct: true, remainingMs: 99_999 }).points).toBe(BASE_POINTS[2]);
    expect(scoreAnswer({ ...base, d: 3, correct: true, remainingMs: 20_000 }).points).toBeGreaterThan(scoreAnswer({ ...base, d: 1, correct: true, remainingMs: 20_000 }).points);
  });
  it('adds a capped streak bonus from the 3rd correct answer and doubles the final', () => {
    expect(scoreAnswer({ ...base, correct: true, remainingMs: 0, streak: 2 }).bonus).toBe(0);
    expect(scoreAnswer({ ...base, correct: true, remainingMs: 0, streak: 3 }).bonus).toBe(100);
    expect(scoreAnswer({ ...base, correct: true, remainingMs: 0, streak: 10 }).bonus).toBe(300);
    const single = scoreAnswer({ ...base, correct: true, remainingMs: 10_000, streak: 4 });
    const dbl = scoreAnswer({ ...base, correct: true, remainingMs: 10_000, streak: 4, double: true });
    expect(dbl.points).toBe(single.points * 2);
  });
});

describe('rank', () => {
  it('orders by score and shares ranks on ties', () => {
    const r = rank(new Map([['a', 100], ['b', 300], ['c', 100], ['d', 50]]));
    expect(r.map((x) => [x.playerId, x.rank])).toEqual([['b', 1], ['a', 2], ['c', 2], ['d', 4]]);
    expect(rank(new Map())).toEqual([]);
  });
});
