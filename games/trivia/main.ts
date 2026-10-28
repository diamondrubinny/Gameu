import { createSdk, type GamePlayer, type Input } from '../../src/sdk/gameu';
import { AVATARS } from '../../src/shared/constants';
import { $, announce, applyDocumentSettings, clear, h, sleep } from '../../src/sdk/game-utils';
import { nextInDirection, type Direction } from '../../src/host/spatial';
import { CATEGORIES } from './categories';
import { localize, prepare, rank, scoreAnswer, selectQuestions, type ContestOptions, type DifficultyMode, type PreparedQuestion, type Ranked } from './contest';
import { QUESTIONS } from './db';
import { DICTS } from './locales';
import type { TriviaDict } from './locales/he';

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

/** TV texts (console language). */
const tv = (): TriviaDict => sdk.tr(DICTS);
/** One player's texts (phone language). */
const pt = (playerId: string): TriviaDict => sdk.trFor(playerId, DICTS);
const catName = (id: string, dict: TriviaDict = tv()) => {
  const c = CATEGORIES.find((x) => x.id === id);
  const name = (dict.categories as Record<string, string>)[id] ?? id;
  return c ? `${c.icon} ${name}` : id;
};
const topicsText = (dict: TriviaDict) => (options.categories.length ? options.categories.map((c) => catName(c, dict)).join(' · ') : dict.allTopics);
const nameOf = (id: string) => players.find((p) => p.id === id)?.nickname ?? '';
const connected = () => players.filter((p) => p.connected);

/** Sends each connected phone a message built in its own language. */
function messageEach(build: (d: TriviaDict, p: GamePlayer) => { text: string; subtext?: string }): void {
  for (const p of connected()) sdk.setLayout({ type: 'message', ...build(pt(p.id), p) }, p.id);
}

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
    // A new player, a language change or a controller change: refresh every phone.
    setupLayouts();
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
  const d = pt(playerId);
  sdk.setLayout({ type: 'message', text: d.answerLocked, subtext: d.waitingOthers }, playerId);
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
  for (const p of connected()) {
    const d = pt(p.id);
    if (p.id === controllerId) {
      sdk.setLayout({ type: 'dpad', title: d.setupPadTitle, buttons: [{ id: 'ok', label: d.select, color: 'primary' }] }, p.id);
    } else {
      sdk.setLayout({ type: 'message', text: d.choosingTopics(name), subtext: d.startsSoon }, p.id);
    }
  }
}

async function runSetup(): Promise<void> {
  phase = 'setup';
  setupLayouts(); // assigns the controller before the hint is drawn
  renderSetup();
  announce(tv().setupAnnounce);
  await new Promise<void>((resolve) => (startContest = resolve));
  startContest = null;
}

function available(): number {
  const cats = options.categories.length ? new Set(options.categories) : null;
  return QUESTIONS.filter((q) => (!cats || cats.has(q.cat)) && (options.difficulty === 'easy' ? q.d === 1 : options.difficulty === 'hard' ? q.d >= 2 : true)).length;
}

function difficultyLabel(d: DifficultyMode): string {
  const t = tv();
  return d === 'easy' ? t.easy : d === 'hard' ? t.hard : t.mixed;
}

function renderSetup(): void {
  const t = tv();
  clear(stage);
  const grid = h('div', { class: 'cats', role: 'group', 'aria-label': t.topics });
  const all = h('button', { class: 'cat', 'data-nav': true, 'data-cat': 'all', type: 'button' }, h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, '🌈'), h('span', {}, t.allTopics));
  all.addEventListener('click', () => {
    options.categories = [];
    refreshSetup();
  });
  grid.append(all);
  for (const c of CATEGORIES) {
    const tile = h('button', { class: 'cat', 'data-nav': true, 'data-cat': c.id, type: 'button' }, h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, c.icon), h('span', {}, (t.categories as Record<string, string>)[c.id] ?? c.en));
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
  const start = h('button', { class: 'opt start', 'data-nav': true, id: 'opt-start', type: 'button' }, '▶ ', t.start);
  start.addEventListener('click', () => {
    if (available() === 0) return;
    startContest?.();
  });
  stage.append(
    h(
      'div',
      { class: 'setup' },
      h('h1', { class: 'setup-title' }, '❓ ', t.title),
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
  el.textContent = name ? tv().setupHint(name) : tv().waitingPlayers;
}

function refreshSetup(): void {
  const t = tv();
  const selected = new Set(options.categories);
  for (const el of stage.querySelectorAll<HTMLElement>('.cat')) {
    const id = el.dataset.cat ?? '';
    const on = id === 'all' ? selected.size === 0 : selected.has(id);
    el.setAttribute('aria-pressed', String(on));
  }
  $('#opt-count').textContent = t.questionsOpt(options.count);
  $('#opt-diff').textContent = t.levelOpt(difficultyLabel(options.difficulty));
  const n = available();
  $('#setup-summary').textContent = n === 0 ? t.noQuestions : t.summary(Math.min(n, options.count), n, topicsText(t));
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
  const t = tv();
  const picked = selectQuestions(QUESTIONS, options);
  const total = picked.length;
  clear(stage);
  stage.append(h('div', { class: 'intro pop' }, h('h1', {}, '❓ ', t.contestBegins), h('p', {}, t.introLine(total, topicsText(t))), h('p', { class: 'rules' }, t.rules)));
  messageEach((d) => ({ text: d.getReady }));
  announce(t.beginsAnnounce(total));
  await sleep(4500);

  for (let i = 0; i < total; i++) {
    const isFinal = i === total - 1 && total >= 5;
    await playRound(prepare(picked[i]!), i, total, isFinal);
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
  const t = tv();
  const onTv = localize(q, sdk.lang);
  answers = new Map();
  if (isFinal) {
    clear(stage);
    stage.append(h('div', { class: 'intro pop final' }, h('h1', {}, '🏆 ', t.championTitle), h('p', {}, t.doublePoints)));
    announce(t.finalAnnounce);
    messageEach((d) => ({ text: d.championPhone }));
    await sleep(2500);
  }
  clear(stage);
  const seconds = baseSeconds + (q.d === 3 ? 5 : 0);
  const timerBar = h('div');
  const answerEls = onTv.answers.map((a, i) =>
    h('div', { class: `answer a${i}` }, h('span', { class: 'shape', 'aria-hidden': 'true' }, SHAPES[i]), h('span', { class: 'answer-text' }, a), h('span', { class: 'count' })),
  );
  stage.append(
    h(
      'div',
      { class: 'meta' },
      h('span', { class: 'badge' }, catName(q.cat)),
      h('span', { class: 'stars', 'aria-label': t.difficultyAria(q.d) }, '★'.repeat(q.d) + '☆'.repeat(3 - q.d)),
      h('span', {}, t.questionOf(index + 1, total)),
      isFinal ? h('span', { class: 'badge double' }, '×2') : null,
    ),
    h('h1', { class: 'question pop' }, onTv.text),
    h('div', { class: 'answers' }, ...answerEls),
    h('div', { class: 'reveal', id: 'reveal' }),
    h('div', { class: 'footer' }, h('div', { class: 'answered', id: 'answered', 'aria-hidden': 'true' }), h('div', { class: 'timer' }, timerBar)),
  );
  renderAnswered();
  announce(`${onTv.text} ${onTv.answers.map((a, i) => `${i + 1}: ${a}`).join(', ')}`);
  // Every phone gets the question in its own language; the answer order is the same everywhere.
  sdk.setLayout({ type: 'choices', id: 'answer', prompt: onTv.text, options: onTv.answers });
  for (const p of connected()) {
    const mine = localize(q, sdk.langOf(p.id));
    if (sdk.langOf(p.id) !== sdk.lang) sdk.setLayout({ type: 'choices', id: 'answer', prompt: mine.text, options: mine.answers }, p.id);
  }
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
  for (const p of connected()) {
    const a = answers.get(p.id);
    if (a) counts[a.index] = (counts[a.index] ?? 0) + 1;
    const correct = a?.index === q.correct;
    const streak = correct ? (streaks.get(p.id) ?? 0) + 1 : 0;
    streaks.set(p.id, streak);
    const { points, bonus } = scoreAnswer({ correct, d: q.d, remainingMs: a ? totalMs - (a.at - roundStart) : 0, totalMs, streak, double: isFinal });
    scores.set(p.id, (scores.get(p.id) ?? 0) + points);
    const d = pt(p.id);
    if (correct) {
      gains.push({ id: p.id, points, streak });
      sdk.setLayout({ type: 'message', text: d.correctPlus(points), subtext: bonus ? d.streak(streak, bonus) : undefined }, p.id);
      sdk.haptic([60, 40, 60], p.id);
    } else {
      const mineCorrect = localize(q, sdk.langOf(p.id)).answers[q.correct] ?? '';
      sdk.setLayout({ type: 'message', text: a ? d.notThisTime : d.timesUp, subtext: d.answerIs(mineCorrect) }, p.id);
    }
  }
  answerEls.forEach((el, i) => {
    el.classList.add(i === q.correct ? 'right' : 'wrong');
    const count = el.querySelector('.count');
    if (count) count.textContent = String(counts[i]);
  });
  const reveal = $('#reveal');
  clear(reveal);
  if (gains.length === 0) reveal.textContent = t.nobody;
  for (const g of gains.sort((a, b) => b.points - a.points)) {
    const p = players.find((x) => x.id === g.id);
    reveal.append(h('span', { class: 'gain pop' }, `${AVATARS[p?.avatar ?? 0] ?? ''} ${p?.nickname ?? ''} +${g.points}${g.streak >= 3 ? ` 🔥${g.streak}` : ''}`));
  }
  announce(t.revealAnnounce(onTv.answers[q.correct] ?? '', gains.length));
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
  const t = tv();
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
      move ? h('span', { class: move === '▲' ? 'up' : 'down', 'aria-label': move === '▲' ? t.movedUp : t.movedDown }, move) : null,
      h('span', { class: 's' }, String(r.score)),
    );
    li.style.setProperty('--c', p?.color ?? '#fff');
    list.append(li);
  }
  stage.append(h('div', { class: 'leaderboard' }, h('h1', {}, '📊 ', t.leaderboard(done, total)), list));
  for (const r of ranked) {
    const d = pt(r.playerId);
    sdk.setLayout({ type: 'message', text: d.place(r.rank, ranked.length), subtext: d.points(r.score) }, r.playerId);
  }
  const top = ranked[0];
  if (top) announce(t.firstPlaceAnnounce(nameOf(top.playerId), top.score));
  previousRanks = new Map(ranked.map((r) => [r.playerId, r.rank]));
  await sleep(LEADERBOARD_MS);
}

async function showPodium(): Promise<void> {
  const t = tv();
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
        h('div', { class: 'pts' }, t.pts(r.score)),
        h('div', { class: 'block' }, String(r.rank)),
      ),
    );
  }
  const winners = ranked.filter((r) => r.rank === 1).map((r) => nameOf(r.playerId));
  stage.append(h('div', { class: 'final-screen' }, h('h1', {}, '🏆 ', t.champions), podium));
  announce(t.winnersAnnounce(winners));
  for (const r of ranked) {
    const d = pt(r.playerId);
    sdk.setLayout({ type: 'message', text: r.rank === 1 ? d.youWon : d.placeN(r.rank), subtext: d.points(r.score) }, r.playerId);
  }
  sdk.haptic([80, 60, 80, 60, 160]);
  await sleep(PODIUM_MS);
}
