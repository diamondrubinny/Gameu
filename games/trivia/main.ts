import { createSdk, type GamePlayer, type Input } from '../../src/sdk/gameu';
import { AVATARS } from '../../src/shared/constants';
import { $, announce, applyDocumentSettings, clear, h, sleep } from '../../src/sdk/game-utils';
import { nextInDirection, type Direction } from '../../src/host/spatial';
import { CATEGORIES } from './categories';
import { prepare, rank, scoreAnswer, selectQuestions, type ContestOptions, type DifficultyMode, type PreparedQuestion, type Ranked } from './contest';
import { QUESTIONS } from './db';

const SHAPES = ['▲', '◆', '●', '■'];
const COUNTS = [10, 15, 20, 30];
const DIFFICULTIES: DifficultyMode[] = ['mixed', 'easy', 'hard'];
const LEADERBOARD_EVERY = 5;
const REVEAL_MS = 5000;
const LEADERBOARD_MS = 6500;
const PODIUM_MS = 7000;

const sdk = createSdk();
const stage = $('#stage');
let players: GamePlayer[] = [];
const scores = new Map<string, number>();
const streaks = new Map<string, number>();
let previousRanks = new Map<string, number>();
let answers = new Map<string, { index: number; at: number }>();
let accepting = false;
let roundStart = 0;
let baseSeconds = 20;
let resolveRound: (() => void) | null = null;

// ---------------- setup state ----------------
const options: ContestOptions = { categories: [], count: 10, difficulty: 'mixed' };
let phase: 'setup' | 'play' = 'setup';
let controllerId: string | null = null;
let focused: HTMLElement | null = null;
let startContest: (() => void) | null = null;

const t = (he: string, en: string) => sdk.t(he, en);
const lang = () => (sdk.settings?.language === 'en' ? 'en' : 'he');
const catName = (id: string) => {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? `${c.icon} ${c[lang()]}` : id;
};
const nameOf = (id: string) => players.find((p) => p.id === id)?.nickname ?? '';
const connected = () => players.filter((p) => p.connected);

sdk.onInit(async (ctx) => {
  applyDocumentSettings(ctx.settings);
  players = ctx.players;
  baseSeconds = ctx.settings.extendedTime ? 35 : 20;
  for (const p of players) ensurePlayer(p.id);
  await runSetup();
  await runContest();
});

sdk.onPlayers((p) => {
  players = p;
  for (const pl of p) ensurePlayer(pl.id);
  if (phase === 'setup') {
    const before = controllerId;
    if (pickController() !== before) setupLayouts();
    renderSetupHint();
  } else {
    renderAnswered();
    if (accepting && everyoneAnswered()) resolveRound?.();
  }
});

sdk.onInput((playerId: string, input: Input) => {
  if (phase === 'setup') {
    if (playerId !== controllerId || input.kind !== 'button' || !input.pressed) return;
    if (input.id === 'ok') focused?.click();
    else if (['up', 'down', 'left', 'right'].includes(input.id)) moveFocus(input.id as Direction);
    return;
  }
  if (!accepting || input.kind !== 'choice' || input.id !== 'answer') return;
  if (answers.has(playerId) || input.index > 3) return;
  answers.set(playerId, { index: input.index, at: performance.now() });
  sdk.setLayout({ type: 'message', text: t('התשובה נקלטה ✓', 'Answer locked in ✓'), subtext: t('ממתינים לשאר השחקנים…', 'Waiting for the others…') }, playerId);
  renderAnswered();
  if (everyoneAnswered()) resolveRound?.();
});

function ensurePlayer(id: string): void {
  if (!scores.has(id)) scores.set(id, 0);
  if (!streaks.has(id)) streaks.set(id, 0);
}

// ---------------- setup ----------------

function pickController(): string | null {
  const c = connected();
  return (c.find((p) => p.isAdmin) ?? c[0])?.id ?? null;
}

function setupLayouts(): void {
  controllerId = pickController();
  const name = controllerId ? nameOf(controllerId) : '';
  sdk.setLayout({ type: 'message', text: t(`${name} בוחר/ת נושאים…`, `${name} is choosing topics…`), subtext: t('התחרות תתחיל בעוד רגע', 'The contest starts soon') });
  if (controllerId) {
    sdk.setLayout(
      { type: 'dpad', title: t('הגדרת התחרות — חצים ובחירה', 'Contest setup — arrows and Select'), buttons: [{ id: 'ok', label: t('בחירה', 'Select'), color: 'primary' }] },
      controllerId,
    );
  }
}

async function runSetup(): Promise<void> {
  phase = 'setup';
  renderSetup();
  setupLayouts();
  announce(t('הגדרת תחרות טריוויה. בחרו נושאים, מספר שאלות ורמת קושי.', 'Trivia contest setup. Choose topics, number of questions and difficulty.'));
  await new Promise<void>((resolve) => (startContest = resolve));
  startContest = null;
}

function available(): number {
  const cats = options.categories.length ? new Set(options.categories) : null;
  return QUESTIONS.filter((q) => (!cats || cats.has(q.cat)) && (options.difficulty === 'easy' ? q.d === 1 : options.difficulty === 'hard' ? q.d >= 2 : true)).length;
}

function difficultyLabel(d: DifficultyMode): string {
  return d === 'easy' ? t('קל', 'Easy') : d === 'hard' ? t('קשה', 'Hard') : t('מעורב (מתחיל קל ומתקשה)', 'Mixed (gets harder)');
}

function renderSetup(): void {
  clear(stage);
  const grid = h('div', { class: 'cats', role: 'group', 'aria-label': t('נושאים', 'Topics') });
  const all = h('button', { class: 'cat', 'data-nav': true, 'data-cat': 'all', type: 'button' }, h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, '🌈'), h('span', {}, t('כל הנושאים', 'All topics')));
  all.addEventListener('click', () => {
    options.categories = [];
    refreshSetup();
  });
  grid.append(all);
  for (const c of CATEGORIES) {
    const tile = h('button', { class: 'cat', 'data-nav': true, 'data-cat': c.id, type: 'button' }, h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, c.icon), h('span', {}, c[lang()]));
    tile.addEventListener('click', () => {
      const set = new Set(options.categories);
      if (set.has(c.id)) set.delete(c.id);
      else set.add(c.id);
      options.categories = set.size === CATEGORIES.length ? [] : [...set];
      refreshSetup();
    });
    grid.append(tile);
  }
  const countBtn = h('button', { class: 'opt', 'data-nav': true, id: 'opt-count', type: 'button' });
  countBtn.addEventListener('click', () => {
    options.count = COUNTS[(COUNTS.indexOf(options.count) + 1) % COUNTS.length] ?? 10;
    refreshSetup();
  });
  const diffBtn = h('button', { class: 'opt', 'data-nav': true, id: 'opt-diff', type: 'button' });
  diffBtn.addEventListener('click', () => {
    options.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(options.difficulty) + 1) % DIFFICULTIES.length] ?? 'mixed';
    refreshSetup();
  });
  const start = h('button', { class: 'opt start', 'data-nav': true, id: 'opt-start', type: 'button' }, '▶ ', t('התחילו!', 'Start!'));
  start.addEventListener('click', () => {
    if (available() === 0) return;
    startContest?.();
  });
  stage.append(
    h(
      'div',
      { class: 'setup' },
      h('h1', { class: 'setup-title' }, '❓ ', t('טריוויה — תחרות', 'Trivia contest')),
      h('p', { class: 'setup-hint', id: 'setup-hint' }),
      grid,
      h('div', { class: 'opts' }, countBtn, diffBtn, start),
      h('p', { class: 'setup-summary', id: 'setup-summary', role: 'status' }),
    ),
  );
  setFocus(start);
  refreshSetup();
  renderSetupHint();
}

function renderSetupHint(): void {
  const el = document.getElementById('setup-hint');
  if (!el) return;
  const name = controllerId ? nameOf(controllerId) : '';
  el.textContent = name ? t(`${name} 👑 בוחר/ת מהטלפון: חצים לניווט, "בחירה" לסימון`, `${name} 👑 chooses on their phone: arrows to move, "Select" to pick`) : t('ממתינים לשחקנים…', 'Waiting for players…');
}

function refreshSetup(): void {
  const selected = new Set(options.categories);
  for (const el of stage.querySelectorAll<HTMLElement>('.cat')) {
    const id = el.dataset.cat ?? '';
    const on = id === 'all' ? selected.size === 0 : selected.has(id);
    el.setAttribute('aria-pressed', String(on));
  }
  $('#opt-count').textContent = t(`מספר שאלות: ${options.count}`, `Questions: ${options.count}`);
  $('#opt-diff').textContent = t(`רמה: ${difficultyLabel(options.difficulty)}`, `Level: ${difficultyLabel(options.difficulty)}`);
  const n = available();
  const topics = selected.size === 0 ? t('כל הנושאים', 'all topics') : [...selected].map(catName).join(' · ');
  $('#setup-summary').textContent =
    n === 0
      ? t('אין שאלות בבחירה הזו — בחרו נושא או רמה אחרים', 'No questions for this choice — pick another topic or level')
      : t(`${Math.min(n, options.count)} שאלות מתוך ${n} זמינות · ${topics}`, `${Math.min(n, options.count)} of ${n} available questions · ${topics}`);
  $('#opt-start').toggleAttribute('disabled', n === 0);
}

/** Visual focus inside the game (the console keeps real keyboard focus). */
function setFocus(el: HTMLElement): void {
  focused?.classList.remove('focused');
  focused = el;
  el.classList.add('focused');
  el.scrollIntoView({ block: 'nearest' });
}

function moveFocus(dir: Direction): void {
  const items = [...stage.querySelectorAll<HTMLElement>('[data-nav]')];
  const next = nextInDirection(focused, dir, items);
  if (next instanceof HTMLElement) setFocus(next);
}

// ---------------- contest ----------------

async function runContest(): Promise<void> {
  phase = 'play';
  const picked = selectQuestions(QUESTIONS, options);
  const total = picked.length;
  clear(stage);
  stage.append(
    h(
      'div',
      { class: 'intro pop' },
      h('h1', {}, '❓ ', t('התחרות מתחילה!', 'The contest begins!')),
      h('p', {}, t(`${total} שאלות · ${options.categories.length ? options.categories.map(catName).join(' · ') : 'כל הנושאים'}`, `${total} questions · ${options.categories.length ? options.categories.map(catName).join(' · ') : 'all topics'}`)),
      h('p', { class: 'rules' }, t('מהר יותר = יותר נקודות · 3 תשובות נכונות ברצף = בונוס 🔥 · השאלה האחרונה כפולה!', 'Faster = more points · 3 right in a row = bonus 🔥 · The last question counts double!')),
    ),
  );
  sdk.setLayout({ type: 'message', text: t('מתכוננים…', 'Get ready…') });
  announce(t(`התחרות מתחילה. ${total} שאלות.`, `The contest begins. ${total} questions.`));
  await sleep(4500);

  for (let i = 0; i < total; i++) {
    const isFinal = i === total - 1 && total >= 5;
    await playRound(prepare(picked[i]!, lang()), i, total, isFinal);
    if ((i + 1) % LEADERBOARD_EVERY === 0 && i + 1 < total) await showLeaderboard(i + 1, total);
  }
  await showPodium();
  sdk.end([...scores.entries()].map(([playerId, score]) => ({ playerId, score })));
}

function everyoneAnswered(): boolean {
  const c = connected();
  return c.length > 0 && c.every((p) => answers.has(p.id));
}

async function playRound(q: PreparedQuestion, index: number, total: number, isFinal: boolean): Promise<void> {
  answers = new Map();
  if (isFinal) {
    clear(stage);
    stage.append(h('div', { class: 'intro pop final' }, h('h1', {}, '🏆 ', t('שאלת האלופים', 'Champion question')), h('p', {}, t('ניקוד כפול!', 'Double points!'))));
    announce(t('שאלה אחרונה, ניקוד כפול', 'Final question, double points'));
    sdk.setLayout({ type: 'message', text: t('🏆 שאלת האלופים — ניקוד כפול!', '🏆 Champion question — double points!') });
    await sleep(2500);
  }
  clear(stage);
  const seconds = baseSeconds + (q.d === 3 ? 5 : 0);
  const timerBar = h('div');
  const answerEls = q.answers.map((a, i) =>
    h('div', { class: `answer a${i}` }, h('span', { class: 'shape', 'aria-hidden': 'true' }, SHAPES[i]), h('span', { class: 'answer-text' }, a), h('span', { class: 'count' })),
  );
  stage.append(
    h(
      'div',
      { class: 'meta' },
      h('span', { class: 'badge' }, catName(q.cat)),
      h('span', { class: 'stars', 'aria-label': t(`רמה ${q.d} מתוך 3`, `Difficulty ${q.d} of 3`) }, '★'.repeat(q.d) + '☆'.repeat(3 - q.d)),
      h('span', {}, t(`שאלה ${index + 1} מתוך ${total}`, `Question ${index + 1} of ${total}`)),
      isFinal ? h('span', { class: 'badge double' }, '×2') : null,
    ),
    h('h1', { class: 'question pop' }, q.text),
    h('div', { class: 'answers' }, ...answerEls),
    h('div', { class: 'reveal', id: 'reveal' }),
    h('div', { class: 'footer' }, h('div', { class: 'answered', id: 'answered', 'aria-hidden': 'true' }), h('div', { class: 'timer' }, timerBar)),
  );
  renderAnswered();
  announce(`${q.text} ${q.answers.map((a, i) => `${i + 1}: ${a}`).join(', ')}`);
  sdk.setLayout({ type: 'choices', id: 'answer', prompt: q.text, options: q.answers });
  sdk.haptic([40]);

  accepting = true;
  roundStart = performance.now();
  const totalMs = seconds * 1000;
  await new Promise<void>((resolve) => {
    resolveRound = resolve;
    const tick = () => {
      if (!accepting) return;
      const left = Math.max(0, totalMs - (performance.now() - roundStart));
      timerBar.style.transform = `scaleX(${left / totalMs})`;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });
  accepting = false;
  resolveRound = null;

  // ---- scoring + reveal ----
  const counts = [0, 0, 0, 0];
  const gains: { id: string; points: number; streak: number }[] = [];
  const correctText = q.answers[q.correct] ?? '';
  for (const p of connected()) {
    const a = answers.get(p.id);
    if (a) counts[a.index] = (counts[a.index] ?? 0) + 1;
    const correct = a?.index === q.correct;
    const streak = correct ? (streaks.get(p.id) ?? 0) + 1 : 0;
    streaks.set(p.id, streak);
    const { points, bonus } = scoreAnswer({ correct, d: q.d, remainingMs: a ? totalMs - (a.at - roundStart) : 0, totalMs, streak, double: isFinal });
    scores.set(p.id, (scores.get(p.id) ?? 0) + points);
    if (correct) {
      gains.push({ id: p.id, points, streak });
      sdk.setLayout({ type: 'message', text: t(`נכון! +${points}`, `Correct! +${points}`), subtext: bonus ? t(`🔥 ${streak} ברצף (+${bonus} בונוס)`, `🔥 ${streak} in a row (+${bonus} bonus)`) : undefined }, p.id);
      sdk.haptic([60, 40, 60], p.id);
    } else {
      const text = a ? t('לא הפעם 😕', 'Not this time 😕') : t('נגמר הזמן ⏰', "Time's up ⏰");
      sdk.setLayout({ type: 'message', text, subtext: t(`התשובה: ${correctText}`, `Answer: ${correctText}`) }, p.id);
    }
  }
  answerEls.forEach((el, i) => {
    el.classList.add(i === q.correct ? 'right' : 'wrong');
    const count = el.querySelector('.count');
    if (count) count.textContent = String(counts[i]);
  });
  const reveal = $('#reveal');
  clear(reveal);
  if (gains.length === 0) reveal.textContent = t('אף אחד לא צדק הפעם', 'Nobody got it this time');
  for (const g of gains.sort((a, b) => b.points - a.points)) {
    const p = players.find((x) => x.id === g.id);
    reveal.append(h('span', { class: 'gain pop' }, `${AVATARS[p?.avatar ?? 0] ?? ''} ${p?.nickname ?? ''} +${g.points}${g.streak >= 3 ? ` 🔥${g.streak}` : ''}`));
  }
  announce(t(`התשובה הנכונה: ${correctText}. ${gains.length} ענו נכון.`, `The answer: ${correctText}. ${gains.length} answered correctly.`));
  await sleep(REVEAL_MS);
}

function renderAnswered(): void {
  const el = document.getElementById('answered');
  if (!el) return;
  clear(el);
  for (const p of connected()) el.append(h('span', { class: answers.has(p.id) ? 'done' : '', title: p.nickname }, AVATARS[p.avatar] ?? '🙂'));
}

function standings(): Ranked[] {
  const active = new Map([...scores].filter(([id]) => players.some((p) => p.id === id && (p.connected || (scores.get(id) ?? 0) > 0))));
  return rank(active);
}

async function showLeaderboard(done: number, total: number): Promise<void> {
  const ranked = standings();
  clear(stage);
  const list = h('ol', { class: 'board' });
  for (const r of ranked) {
    const p = players.find((x) => x.id === r.playerId);
    const prev = previousRanks.get(r.playerId);
    const move = prev === undefined || prev === r.rank ? '' : prev > r.rank ? '▲' : '▼';
    const li = h(
      'li',
      { class: 'pop' },
      h('span', { class: 'rank' }, String(r.rank)),
      h('span', { 'aria-hidden': 'true' }, AVATARS[p?.avatar ?? 0] ?? ''),
      h('span', { class: 'n' }, p?.nickname ?? ''),
      move ? h('span', { class: move === '▲' ? 'up' : 'down', 'aria-label': move === '▲' ? t('עלה/תה', 'up') : t('ירד/ה', 'down') }, move) : null,
      h('span', { class: 's' }, String(r.score)),
    );
    li.style.setProperty('--c', p?.color ?? '#fff');
    list.append(li);
  }
  stage.append(h('div', { class: 'leaderboard' }, h('h1', {}, '📊 ', t(`טבלת המובילים · ${done}/${total}`, `Leaderboard · ${done}/${total}`)), list));
  for (const r of ranked) sdk.setLayout({ type: 'message', text: t(`מקום ${r.rank} מתוך ${ranked.length}`, `Place ${r.rank} of ${ranked.length}`), subtext: t(`${r.score} נקודות`, `${r.score} points`) }, r.playerId);
  const top = ranked[0];
  if (top) announce(t(`במקום הראשון: ${nameOf(top.playerId)} עם ${top.score} נקודות`, `In first place: ${nameOf(top.playerId)} with ${top.score} points`));
  previousRanks = new Map(ranked.map((r) => [r.playerId, r.rank]));
  await sleep(LEADERBOARD_MS);
}

async function showPodium(): Promise<void> {
  const ranked = standings();
  clear(stage);
  const podium = h('div', { class: 'podium' });
  const medals = ['🥇', '🥈', '🥉'];
  // Visual order 2-1-3 like a real podium.
  for (const place of [2, 1, 3]) {
    const r = ranked.filter((x) => x.rank === place)[0] ?? (place === 1 ? ranked[0] : undefined);
    if (!r) continue;
    const p = players.find((x) => x.id === r.playerId);
    const tied = ranked.filter((x) => x.rank === r.rank).map((x) => nameOf(x.playerId));
    podium.append(
      h(
        'div',
        { class: `step step-${r.rank} pop` },
        h('div', { class: 'medal', 'aria-hidden': 'true' }, medals[r.rank - 1] ?? ''),
        h('div', { class: 'who' }, AVATARS[p?.avatar ?? 0] ?? '', ' ', tied.join(' & ')),
        h('div', { class: 'pts' }, t(`${r.score} נק׳`, `${r.score} pts`)),
        h('div', { class: 'block' }, String(r.rank)),
      ),
    );
  }
  const winners = ranked.filter((r) => r.rank === 1).map((r) => nameOf(r.playerId));
  stage.append(h('div', { class: 'final-screen' }, h('h1', {}, '🏆 ', t('האלופים!', 'Champions!')), podium));
  announce(t(`המנצחים: ${winners.join(' ו')}`, `Winner: ${winners.join(' and ')}`));
  for (const r of ranked) {
    sdk.setLayout({ type: 'message', text: r.rank === 1 ? t('🏆 ניצחת!', '🏆 You won!') : t(`מקום ${r.rank}`, `Place ${r.rank}`), subtext: t(`${r.score} נקודות`, `${r.score} points`) }, r.playerId);
  }
  sdk.haptic([80, 60, 80, 60, 160]);
  await sleep(PODIUM_MS);
}
