import { createSdk, type GamePlayer, type Input } from '../../src/sdk/gameu';
import { AVATARS } from '../../src/shared/constants';
import { $, announce, applyDocumentSettings, clear, h, shuffle, sleep } from '../../src/sdk/game-utils';
import { isCorrectGuess } from './guess';
import { DICTS } from './locales';
import { WORD_KEYS, type WordKey } from './words';

const MAX_ROUNDS = 6;
const COLORS = ['#000000', '#e63946', '#1d4ed8', '#16a34a', '#f59e0b', '#8b5cf6', '#8b4513', '#ffffff'];

const sdk = createSdk();
const canvas = $('#canvas') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
let players: GamePlayer[] = [];
const scores = new Map<string, number>();
let roundSeconds = 75;

interface RoundState {
  drawer: GamePlayer;
  word: WordKey;
  answers: string[];
  guessed: Set<string>;
  start: number;
  active: boolean;
  last: Map<number, [number, number]>;
  finish: () => void;
}
let round: RoundState | null = null;

/** Strokes kept in normalized coordinates so the TV can redraw on resize. */
let strokes: { color: number; size: number; points: [number, number][] }[] = [];
let strokeIndex = new Map<number, number>();

sdk.onInit(async (ctx) => {
  applyDocumentSettings(ctx.settings);
  players = ctx.players;
  roundSeconds = ctx.settings.extendedTime ? 110 : 75;
  for (const p of players) scores.set(p.id, 0);
  const tv = sdk.tr(DICTS);
  $('#title').textContent = `🎨 ${tv.title}`;
  $('#feed-title').textContent = tv.guesses;
  canvas.setAttribute('aria-label', tv.canvasLabel);
  fit();
  window.addEventListener('resize', fit);
  renderScores();
  await run();
});

sdk.onPlayers((p) => {
  players = p;
  for (const pl of p) if (!scores.has(pl.id)) scores.set(pl.id, 0);
  renderScores();
  if (round?.active) {
    const drawer = players.find((x) => x.id === round!.drawer.id);
    if (!drawer?.connected) round.finish();
    else if (allGuessed()) round.finish();
  }
});

sdk.onInput((playerId: string, input: Input) => {
  const r = round;
  if (!r || !r.active) return;
  if (playerId === r.drawer.id) {
    if (input.kind === 'draw') addPoints(input.stroke, input.color, input.size, input.points);
    else if (input.kind === 'button' && input.id === 'clear' && input.pressed) {
      strokes = [];
      strokeIndex = new Map();
      redraw();
    }
    return;
  }
  if (input.kind !== 'text' || r.guessed.has(playerId)) return;
  const player = players.find((p) => p.id === playerId);
  if (!player) return;
  if (isCorrectGuess(input.value, r.answers)) {
    r.guessed.add(playerId);
    const remaining = Math.max(0, roundSeconds * 1000 - (performance.now() - r.start));
    const pts = 100 + Math.round((200 * remaining) / (roundSeconds * 1000));
    scores.set(playerId, (scores.get(playerId) ?? 0) + pts);
    scores.set(r.drawer.id, (scores.get(r.drawer.id) ?? 0) + 50);
    feed(sdk.tr(DICTS).guessedFeed(player.nickname), true);
    announce(sdk.tr(DICTS).guessedAnnounce(player.nickname));
    const pt = sdk.trFor(playerId, DICTS);
    sdk.setLayout({ type: 'message', text: pt.youGotIt, subtext: pt.plusPoints(pts) }, playerId);
    sdk.haptic([60, 40, 60], playerId);
    sdk.haptic([30], r.drawer.id);
    sdk.sound('correct');
    renderScores();
    if (allGuessed()) r.finish();
  } else {
    feed(`${player.nickname}: ${input.value.slice(0, 40)}`, false);
  }
});

function connected(): GamePlayer[] {
  return players.filter((p) => p.connected);
}

function allGuessed(): boolean {
  const r = round;
  if (!r) return false;
  const guessers = connected().filter((p) => p.id !== r.drawer.id);
  return guessers.length > 0 && guessers.every((p) => r.guessed.has(p.id));
}

async function run(): Promise<void> {
  const drawers = shuffle(connected()).slice(0, MAX_ROUNDS);
  const words = shuffle(WORD_KEYS);
  for (let i = 0; i < drawers.length; i++) {
    const drawer = players.find((p) => p.id === drawers[i]!.id);
    if (!drawer?.connected) continue;
    if (connected().length < 2) break;
    await playRound(drawer, words[i % words.length]!, i, drawers.length);
  }
  sdk.end([...scores.entries()].map(([playerId, score]) => ({ playerId, score })));
}

/** The word in a given player's language (first form), or in the TV language. */
function wordFor(word: WordKey, playerId?: string): string {
  const dict = playerId ? sdk.trFor(playerId, DICTS) : sdk.tr(DICTS);
  return dict.words[word]?.[0] ?? DICTS.en.words[word][0] ?? word;
}

/** Every accepted form of the word, in every language. */
function allForms(word: WordKey): string[] {
  return Object.values(DICTS).flatMap((d) => d.words[word] ?? []);
}

async function playRound(drawer: GamePlayer, word: WordKey, index: number, total: number): Promise<void> {
  const tv = sdk.tr(DICTS);
  const secret = wordFor(word);
  strokes = [];
  strokeIndex = new Map();
  redraw();
  clear($('#feed'));

  await showCard(tv.round(index + 1, total), `${AVATARS[drawer.avatar] ?? ''} ${tv.isDrawing(drawer.nickname)}`);
  for (const p of connected()) sdk.setLayout({ type: 'message', text: sdk.trFor(p.id, DICTS).getReady }, p.id);

  $('#hint').textContent = [...secret].map((c) => (c === ' ' ? '  ' : '_')).join(' ');
  sdk.setLayout({ type: 'draw', id: 'canvas', prompt: sdk.trFor(drawer.id, DICTS).drawPrompt(wordFor(word, drawer.id)), colors: COLORS }, drawer.id);
  for (const p of connected()) {
    if (p.id === drawer.id) continue;
    const pt = sdk.trFor(p.id, DICTS);
    sdk.setLayout({ type: 'text', id: 'guess', prompt: pt.guessPrompt(drawer.nickname), maxLength: 40, placeholder: pt.guessPlaceholder }, p.id);
  }
  sdk.haptic([80], drawer.id);
  sdk.sound('turn');
  sdk.music('calm');
  announce(tv.drawingAnnounce(drawer.nickname));

  const total_ms = roundSeconds * 1000;
  const timer = $('#timer');
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (round) round.active = false;
      resolve();
    };
    round = { drawer, word, answers: allForms(word), guessed: new Set(), start: performance.now(), active: true, last: new Map(), finish };
    renderScores();
    const tick = () => {
      if (done) return;
      const left = Math.max(0, total_ms - (performance.now() - round!.start));
      timer.style.transform = `scaleX(${left / total_ms})`;
      if (left <= 0) finish();
      else requestAnimationFrame(tick);
    };
    tick();
  });

  $('#hint').textContent = secret;
  const guessed = round?.guessed ?? new Set<string>();
  for (const p of connected()) {
    if (p.id === drawer.id) {
      sdk.setLayout({ type: 'message', text: sdk.trFor(p.id, DICTS).guessedYourDrawing(guessed.size), subtext: wordFor(word, p.id) }, p.id);
    } else if (guessed.has(p.id)) {
      const pt = sdk.trFor(p.id, DICTS);
      sdk.setLayout({ type: 'message', text: pt.youGotIt, subtext: pt.theWord(wordFor(word, p.id)) }, p.id);
    } else {
      sdk.setLayout({ type: 'message', text: sdk.trFor(p.id, DICTS).theWordWas(wordFor(word, p.id)) }, p.id);
    }
  }
  announce(tv.theWordWas(secret));
  sdk.sound('reveal');
  await showCard(tv.theWordWasTitle, secret, 4000);
  round = null;
}

async function showCard(title: string, body: string, ms = 2500): Promise<void> {
  const overlay = $('#overlay');
  clear(overlay);
  overlay.append(h('div', { class: 'card pop' }, h('p', {}, title), h('div', { class: 'big' }, body)));
  await sleep(ms);
  clear(overlay);
}

function addPoints(strokeId: number, color: number, size: number, points: [number, number][]): void {
  let idx = strokeIndex.get(strokeId);
  if (idx === undefined) {
    idx = strokes.push({ color: Math.min(color, COLORS.length - 1), size, points: [] }) - 1;
    strokeIndex.set(strokeId, idx);
    if (strokes.length > 2000) {
      // Hard cap on memory for very long sessions.
      strokes.shift();
      strokeIndex = new Map([...strokeIndex].map(([k, v]) => [k, v - 1] as [number, number]).filter(([, v]) => v >= 0));
      idx = strokes.length - 1;
    }
  }
  const s = strokes[idx]!;
  const from = s.points[s.points.length - 1];
  if (s.points.length < 5000) s.points.push(...points);
  drawPolyline(from ? [from, ...points] : points, s.color, s.size);
}

function fit(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  redraw();
}

/** The phone canvas is 4:3; letterbox it inside the TV canvas. */
function area(): { x: number; y: number; w: number; h: number } {
  const w = Math.min(canvas.width, (canvas.height * 4) / 3);
  const hgt = (w * 3) / 4;
  return { x: (canvas.width - w) / 2, y: (canvas.height - hgt) / 2, w, h: hgt };
}

function redraw(): void {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const a = area();
  g.strokeStyle = '#e5e7eb';
  g.lineWidth = 2;
  g.strokeRect(a.x, a.y, a.w, a.h);
  for (const s of strokes) drawPolyline(s.points, s.color, s.size);
}

function drawPolyline(points: [number, number][], color: number, size: number): void {
  if (!points.length) return;
  const a = area();
  g.strokeStyle = COLORS[color] ?? '#000';
  g.lineWidth = size * (a.w / 260);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  const [x0, y0] = points[0]!;
  g.moveTo(a.x + x0 * a.w, a.y + y0 * a.h);
  if (points.length === 1) g.lineTo(a.x + x0 * a.w + 0.1, a.y + y0 * a.h);
  for (const [x, y] of points.slice(1)) g.lineTo(a.x + x * a.w, a.y + y * a.h);
  g.stroke();
}

function feed(text: string, ok: boolean): void {
  const list = $('#feed');
  list.prepend(h('li', { class: ok ? 'ok' : '' }, text));
  while (list.children.length > 14) list.lastElementChild?.remove();
}

function renderScores(): void {
  const list = $('#scores');
  clear(list);
  for (const p of [...players].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))) {
    if (!p.connected && !scores.get(p.id)) continue;
    const isDrawer = round?.drawer.id === p.id;
    const li = h(
      'li',
      { class: isDrawer ? 'drawer' : '' },
      h('span', { 'aria-hidden': 'true' }, isDrawer ? '🖍️' : round?.guessed.has(p.id) ? '✅' : AVATARS[p.avatar] ?? ''),
      h('span', { class: 'n' }, p.nickname),
      h('span', { class: 's' }, scores.get(p.id) ?? 0),
    );
    li.style.setProperty('--c', p.color);
    list.append(li);
  }
}
