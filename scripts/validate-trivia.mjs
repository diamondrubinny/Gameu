#!/usr/bin/env node
/**
 * Validates trivia data files (games/trivia/data/<category>.json).
 *   node scripts/validate-trivia.mjs                 all files + completeness checks
 *   node scripts/validate-trivia.mjs geography.json  only the given files
 * Exit code 1 on any problem. Also used by tests/unit/trivia-db.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(root, 'games', 'trivia', 'data');
export const CATEGORY_IDS = ['general', 'geography', 'history', 'science', 'space', 'nature', 'body', 'sports', 'music', 'movies', 'literature', 'art', 'food', 'tech', 'math', 'israel'];
export const LIMITS = { question: 160, answer: 60, minPerCategory: 20, minPerDifficulty: 3 };

/** Must match the controller's SafeTextSchema rules: no control/format chars, no angle brackets. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Co}<>]/u;
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

export function validateFile(file) {
  const errors = [];
  const cat = path.basename(file, '.json');
  if (!CATEGORY_IDS.includes(cat)) errors.push(`${cat}: unknown category file name`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { cat, count: 0, errors: [`${cat}: invalid JSON (${e.message})`], questions: [] };
  }
  if (!Array.isArray(data)) return { cat, count: 0, errors: [`${cat}: root must be an array`], questions: [] };
  const ids = new Set();
  data.forEach((q, i) => {
    const at = `${cat}[${i}]${q && q.id ? ` (${q.id})` : ''}`;
    if (!q || typeof q !== 'object') return errors.push(`${at}: not an object`);
    const keys = Object.keys(q).sort().join(',');
    if (keys !== 'c,d,en,he,id') errors.push(`${at}: keys must be exactly id,d,c,he,en (got ${keys})`);
    if (typeof q.id !== 'string' || !new RegExp(`^${cat}-\\d{3}$`).test(q.id)) errors.push(`${at}: id must look like ${cat}-001`);
    if (ids.has(q.id)) errors.push(`${at}: duplicate id`);
    ids.add(q.id);
    if (![1, 2, 3].includes(q.d)) errors.push(`${at}: d (difficulty) must be 1, 2 or 3`);
    if (![0, 1, 2, 3].includes(q.c)) errors.push(`${at}: c (correct index) must be 0..3`);
    for (const lang of ['he', 'en']) {
      const loc = q[lang];
      if (!loc || typeof loc.q !== 'string' || !Array.isArray(loc.a)) {
        errors.push(`${at}: ${lang} must be { q: string, a: string[4] }`);
        continue;
      }
      if (Object.keys(loc).sort().join(',') !== 'a,q') errors.push(`${at}: ${lang} keys must be exactly q,a`);
      const qt = loc.q.trim();
      if (qt.length < 8 || qt.length > LIMITS.question) errors.push(`${at}: ${lang}.q length must be 8..${LIMITS.question} (got ${qt.length})`);
      if (qt !== loc.q) errors.push(`${at}: ${lang}.q has leading/trailing spaces`);
      if (UNSAFE.test(loc.q)) errors.push(`${at}: ${lang}.q contains forbidden characters (< > or control/format chars)`);
      if (loc.a.length !== 4) errors.push(`${at}: ${lang}.a must have exactly 4 answers`);
      const seen = new Set();
      for (const a of loc.a) {
        if (typeof a !== 'string' || a.trim().length === 0 || a.length > LIMITS.answer) errors.push(`${at}: ${lang} answer must be 1..${LIMITS.answer} chars: ${JSON.stringify(a)}`);
        else if (a.trim() !== a) errors.push(`${at}: ${lang} answer has leading/trailing spaces: ${JSON.stringify(a)}`);
        else if (UNSAFE.test(a)) errors.push(`${at}: ${lang} answer contains forbidden characters: ${JSON.stringify(a)}`);
        else if (seen.has(norm(a))) errors.push(`${at}: ${lang} has duplicate answers: ${JSON.stringify(a)}`);
        if (typeof a === 'string') seen.add(norm(a));
      }
    }
    if (q.he && /[a-z]{4,}/i.test(q.he.q) && !/[֐-׿]/.test(q.he.q)) errors.push(`${at}: he.q has no Hebrew text`);
  });
  return { cat, count: data.length, errors, questions: data };
}

export function validateAll(files) {
  const all = (files?.length ? files : CATEGORY_IDS.map((c) => path.join(DATA_DIR, `${c}.json`))).map((f) => (path.isAbsolute(f) ? f : path.join(DATA_DIR, path.basename(f))));
  const results = [];
  const errors = [];
  for (const f of all) {
    if (!fs.existsSync(f)) {
      errors.push(`${path.basename(f)}: missing`);
      continue;
    }
    const r = validateFile(f);
    results.push(r);
    errors.push(...r.errors);
    if (r.count < LIMITS.minPerCategory) errors.push(`${r.cat}: only ${r.count} questions (need ≥ ${LIMITS.minPerCategory})`);
    for (const d of [1, 2, 3]) {
      const n = r.questions.filter((q) => q.d === d).length;
      if (n < LIMITS.minPerDifficulty) errors.push(`${r.cat}: only ${n} questions of difficulty ${d} (need ≥ ${LIMITS.minPerDifficulty})`);
    }
  }
  // Duplicate questions across all checked files (normalized Hebrew and English text).
  const seen = new Map();
  for (const r of results) {
    for (const q of r.questions) {
      for (const lang of ['he', 'en']) {
        const key = `${lang}:${norm(q?.[lang]?.q ?? '')}`;
        if (key.length < 6) continue;
        if (seen.has(key)) errors.push(`${q.id}: duplicate ${lang} question text of ${seen.get(key)}`);
        else seen.set(key, q.id);
      }
    }
  }
  return { results, errors, total: results.reduce((n, r) => n + r.count, 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { results, errors, total } = validateAll(process.argv.slice(2));
  for (const r of results) {
    const by = [1, 2, 3].map((d) => r.questions.filter((q) => q.d === d).length).join('/');
    console.log(`${r.cat.padEnd(11)} ${String(r.count).padStart(3)} questions (easy/medium/hard ${by})`);
  }
  console.log(`total: ${total}`);
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  console.log('OK');
}
