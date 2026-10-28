/** Pure contest logic (no DOM): question selection, answer shuffling, scoring and ranking. */
import type { Lang } from '../../src/shared/i18n';

export type { Lang };
export type Difficulty = 1 | 2 | 3;

export interface Localized {
  q: string;
  a: [string, string, string, string] | string[];
}

export interface Question {
  id: string;
  cat: string;
  d: Difficulty;
  /** Index of the correct answer in `a` (same order in both languages). */
  c: number;
  he: Localized;
  en: Localized;
  /** Translations (same answer order); missing ones fall back to English. */
  ar?: Localized;
  ru?: Localized;
  es?: Localized;
  fr?: Localized;
}

export function textOf(q: Question, lang: Lang): Localized {
  return q[lang] ?? q.en;
}

export type DifficultyMode = 'easy' | 'mixed' | 'hard';

export interface ContestOptions {
  /** Empty = all categories. */
  categories: string[];
  count: number;
  difficulty: DifficultyMode;
}

export type Rng = () => number;

export function shuffle<T>(arr: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function allowed(d: Difficulty, mode: DifficultyMode): boolean {
  if (mode === 'easy') return d === 1;
  if (mode === 'hard') return d >= 2;
  return true;
}

/**
 * Picks `count` distinct questions. Categories are interleaved so a mixed contest
 * stays varied; in "mixed" difficulty the contest ramps from easy to hard.
 * Never repeats an id from `exclude` unless the pool would otherwise run out.
 */
export function selectQuestions(db: readonly Question[], opts: ContestOptions, rng: Rng = Math.random, exclude: ReadonlySet<string> = new Set()): Question[] {
  const cats = opts.categories.length ? new Set(opts.categories) : null;
  const base = db.filter((q) => (!cats || cats.has(q.cat)) && allowed(q.d, opts.difficulty));
  const fresh = base.filter((q) => !exclude.has(q.id));
  const pool = fresh.length >= Math.min(opts.count, base.length) ? fresh : base;

  // Round-robin over categories (each category's questions shuffled).
  const byCat = new Map<string, Question[]>();
  for (const q of shuffle(pool, rng)) {
    const list = byCat.get(q.cat) ?? [];
    list.push(q);
    byCat.set(q.cat, list);
  }
  const order = shuffle([...byCat.keys()], rng);
  const picked: Question[] = [];
  while (picked.length < opts.count && order.some((c) => (byCat.get(c)?.length ?? 0) > 0)) {
    for (const c of order) {
      const q = byCat.get(c)?.shift();
      if (q) picked.push(q);
      if (picked.length >= opts.count) break;
    }
  }

  if (opts.difficulty === 'mixed') {
    // Stable sort by difficulty keeps the category interleaving within each level.
    return picked.map((q, i) => ({ q, i })).sort((a, b) => a.q.d - b.q.d || a.i - b.i).map((x) => x.q);
  }
  return picked;
}

export interface PreparedQuestion {
  id: string;
  cat: string;
  d: Difficulty;
  /** Shuffled answer order, shared by every language so answer indexes match on all phones. */
  order: number[];
  correct: number;
  source: Question;
}

/** Shuffles the answer order once (so the position of the right answer can't be memorized). */
export function prepare(q: Question, rng: Rng = Math.random): PreparedQuestion {
  const order = shuffle([0, 1, 2, 3], rng);
  return { id: q.id, cat: q.cat, d: q.d, order, correct: order.indexOf(q.c), source: q };
}

/** The question and its answers in one language, in the prepared order. */
export function localize(p: PreparedQuestion, lang: Lang): { text: string; answers: string[] } {
  const loc = textOf(p.source, lang);
  return { text: loc.q, answers: p.order.map((i) => loc.a[i] as string) };
}

export const BASE_POINTS: Record<Difficulty, number> = { 1: 500, 2: 750, 3: 1000 };
export const STREAK_BONUS = 100;
export const STREAK_BONUS_MAX = 300;

export interface ScoreInput {
  correct: boolean;
  d: Difficulty;
  /** Time left when the answer arrived, and the full time for the question. */
  remainingMs: number;
  totalMs: number;
  /** Consecutive correct answers including this one. */
  streak: number;
  double: boolean;
}

/** Correct answers earn 50–100% of the difficulty base by speed, plus a streak bonus; the final question counts double. */
export function scoreAnswer(s: ScoreInput): { points: number; bonus: number } {
  if (!s.correct) return { points: 0, bonus: 0 };
  const speed = 0.5 + 0.5 * Math.max(0, Math.min(1, s.totalMs > 0 ? s.remainingMs / s.totalMs : 0));
  const bonus = s.streak >= 3 ? Math.min(STREAK_BONUS_MAX, STREAK_BONUS * (s.streak - 2)) : 0;
  const mult = s.double ? 2 : 1;
  return { points: (Math.round(BASE_POINTS[s.d] * speed) + bonus) * mult, bonus: bonus * mult };
}

export interface Ranked {
  playerId: string;
  score: number;
  /** 1-based; ties share a rank (1, 1, 3). */
  rank: number;
}

export function rank(scores: ReadonlyMap<string, number>): Ranked[] {
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  let prevScore = Number.NaN;
  let prevRank = 0;
  return sorted.map(([playerId, score], i) => {
    const r = score === prevScore ? prevRank : i + 1;
    prevScore = score;
    prevRank = r;
    return { playerId, score, rank: r };
  });
}
