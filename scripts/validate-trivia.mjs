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
export const I18N_DIR = path.join(root, 'games', 'trivia', 'i18n');
export const TRANSLATION_LANGS = ['ar', 'ru', 'es', 'fr'];
/** Translations may be longer than the source, up to what the phone controller accepts. */
export const TR_LIMITS = { question: 200, answer: 80 };

/** Must match the controller's SafeTextSchema rules: no control/format chars, no angle brackets. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Co}<>]/u;
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[\u0591-\u05C7]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

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
    if (q.he && /[a-z]{4,}/i.test(q.he.q) && !/[\u0590-\u05FF]/.test(q.he.q)) errors.push(`${at}: he.q has no Hebrew text`);
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

const digits = (s) => (s.match(/\d/g) ?? []).join('');

/**
 * Validates games/trivia/i18n/<lang>/<category>.json against the base questions:
 * same ids (complete coverage), { q, a[4] } in the SAME answer order, limits, no duplicates,
 * and numeric answers keep their digits (catches reordered answers).
 */
export function validateTranslations(lang, { requireComplete = true } = {}) {
  const errors = [];
  let translated = 0;
  for (const cat of CATEGORY_IDS) {
    const baseFile = path.join(DATA_DIR, `${cat}.json`);
    const trFile = path.join(I18N_DIR, lang, `${cat}.json`);
    if (!fs.existsSync(baseFile)) continue;
    const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
    if (!fs.existsSync(trFile)) {
      errors.push(`${lang}/${cat}: missing file`);
      continue;
    }
    let tr;
    try {
      tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));
    } catch (e) {
      errors.push(`${lang}/${cat}: invalid JSON (${e.message})`);
      continue;
    }
    if (!tr || typeof tr !== 'object' || Array.isArray(tr)) {
      errors.push(`${lang}/${cat}: root must be an object { "<id>": { "q", "a" } }`);
      continue;
    }
    const ids = new Set(base.map((q) => q.id));
    for (const id of Object.keys(tr)) if (!ids.has(id)) errors.push(`${lang}/${cat}: unknown id ${id}`);
    const seenQ = new Set();
    for (const q of base) {
      const t = tr[q.id];
      if (!t) {
        if (requireComplete) errors.push(`${lang}/${q.id}: missing translation`);
        continue;
      }
      translated++;
      const at = `${lang}/${q.id}`;
      if (typeof t.q !== 'string' || !Array.isArray(t.a) || Object.keys(t).sort().join(',') !== 'a,q') {
        errors.push(`${at}: must be exactly { q: string, a: string[4] }`);
        continue;
      }
      if (t.q.trim() !== t.q || t.q.length < 5 || t.q.length > TR_LIMITS.question) errors.push(`${at}: q length must be 5..${TR_LIMITS.question} without outer spaces`);
      if (UNSAFE.test(t.q)) errors.push(`${at}: q contains forbidden characters`);
      if (seenQ.has(norm(t.q))) errors.push(`${at}: duplicate question text in ${lang}/${cat}`);
      seenQ.add(norm(t.q));
      if (t.a.length !== 4) {
        errors.push(`${at}: needs exactly 4 answers`);
        continue;
      }
      const seenA = new Set();
      t.a.forEach((a, i) => {
        if (typeof a !== 'string' || !a.trim() || a.trim() !== a || a.length > TR_LIMITS.answer) errors.push(`${at}: answer ${i} must be 1..${TR_LIMITS.answer} chars without outer spaces`);
        else if (UNSAFE.test(a)) errors.push(`${at}: answer ${i} contains forbidden characters`);
        else if (seenA.has(norm(a))) errors.push(`${at}: duplicate answers`);
        if (typeof a === 'string') seenA.add(norm(a));
        const src = q.en.a[i];
        if (typeof a === 'string' && /^[\d\s.,:/\u00D7x+\-\u2212%\u00B0]+$/.test(src) && digits(src) && digits(a.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))) !== digits(src)) {
          errors.push(`${at}: numeric answer ${i} must keep the same number as English (${JSON.stringify(src)} vs ${JSON.stringify(a)})`);
        }
      });
    }
  }
  return { lang, translated, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const trArg = process.argv.find((a) => a.startsWith('--lang='));
  if (trArg) {
    const langs = trArg.slice('--lang='.length).split(',');
    let failed = false;
    for (const l of langs) {
      const r = validateTranslations(l, { requireComplete: !process.argv.includes('--partial') });
      console.log(`${l}: ${r.translated} translated`);
      if (r.errors.length) {
        failed = true;
        console.error(`${r.errors.length} problem(s):\n- ${r.errors.slice(0, 80).join('\n- ')}`);
      }
    }
    if (failed) process.exit(1);
    console.log('OK');
    process.exit(0);
  }
  const { results, errors, total } = validateAll(process.argv.slice(2).filter((a) => !a.startsWith('--')));
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
