import { createSdk, type GamePlayer, type Input } from '../../src/sdk/gameu';
import { AVATARS } from '../../src/shared/constants';
import { $, announce, applyDocumentSettings, clear, h, shuffle, sleep } from '../../src/sdk/game-utils';
import { DICTS } from './locales';
import type { WordDict } from './locales/he';
import { ALPHABETS, WordRound } from './logic';
import { CATEGORY_KEYS, WORDS, type CategoryKey } from './words';

const WORDS_PER_GAME = 5;
const MAX_MISSES = 7;
const POINTS_PER_LETTER = 10;
const COMPLETE_BONUS = 20;
const SOLVE_BONUS = 30;

const sdk = createSdk();
let players: GamePlayer[] = [];
const scores = new Map<string, number>();
let turnSeconds = 25;
let round: WordRound | null = null;
let category: CategoryKey = 'animals';
let wordIndex = 0;
let currentId: string | null = null;
let revealAll = false;
let turnHandler: ((playerId: string, input: Input) => void) | null = null;

const tv = (): WordDict => sdk.tr(DICTS);
const pt = (id: string): WordDict => sdk.trFor(id, DICTS);
const nameOf = (id: string) => players.find((p) => p.id === id)?.nickname ?? '?';
const connected = () => players.filter((p) => p.connected);

sdk.onInit(async (ctx) => {
  applyDocumentSettings(ctx.settings);
  players = ctx.players;
  turnSeconds = ctx.settings.extendedTime ? 50 : 25;
  for (const p of players) scores.set(p.id, 0);
  $('#title').textContent = `\u{1F388} ${tv().title}`;
  sdk.music('calm');
  render();
  await intro();
  await run();
});

sdk.onPlayers((p) => {
  players = p;
  for (const pl of p) if (!scores.has(pl.id)) scores.set(pl.id, 0);
  render();
  // Re-send the current state to anyone who (re)joined.
  if (round && !round.over) sendPhones();
});

sdk.onInput((playerId, input) => turnHandler?.(playerId, input));

async function intro(): Promise<void> {
  await card(tv().title, tv().intro, 4500);
  for (const p of connected()) sdk.setLayout({ type: 'message', text: pt(p.id).title, subtext: pt(p.id).intro }, p.id);
}

async function run(): Promise<void> {
  const lang = sdk.lang;
  const cats = shuffle([...CATEGORY_KEYS]);
  let turnOrder = shuffle(connected().map((p) => p.id));
  for (wordIndex = 0; wordIndex < WORDS_PER_GAME; wordIndex++) {
    if (connected().length === 0) break;
    category = cats[wordIndex % cats.length]!;
    const word = shuffle(WORDS[lang][category])[0]!;
    round = new WordRound(word, lang, MAX_MISSES);
    revealAll = false;
    // New players join the rotation; the starting player rotates every word.
    for (const p of connected()) if (!turnOrder.includes(p.id)) turnOrder.push(p.id);
    turnOrder = turnOrder.filter((id) => players.some((p) => p.id === id));
    let turn = wordIndex % Math.max(1, turnOrder.length);
    render();
    await card(tv().wordN(wordIndex + 1, WORDS_PER_GAME), tv().category(tv().categories[category]), 2500);
    sdk.sound('go');
    while (!round.over) {
      if (connected().length === 0) break;
      // Skip disconnected players.
      let guard = 0;
      while (!players.find((p) => p.id === turnOrder[turn % turnOrder.length])?.connected && guard++ < turnOrder.length) turn++;
      const id = turnOrder[turn % turnOrder.length]!;
      const keepTurn = await playTurn(id);
      if (!keepTurn) turn++;
    }
    await endWord();
  }
  sdk.music('off');
  sdk.sound('win');
  sdk.end([...scores.entries()].map(([playerId, score]) => ({ playerId, score })));
}

/** One player's turn. Returns true when they keep the turn (a correct letter). */
function playTurn(id: string): Promise<boolean> {
  const r = round!;
  currentId = id;
  render();
  sendPhones();
  sdk.sound('turn');
  sdk.haptic([60, 30, 60], id);
  announce(tv().turnOf(nameOf(id)));
  const ms = turnSeconds * 1000;
  const start = performance.now();
  return new Promise((resolve) => {
    let lastSec = -1;
    const timer = window.setInterval(() => {
      const left = ms - (performance.now() - start);
      const bar = document.getElementById('timer');
      if (bar) bar.style.transform = `scaleX(${Math.max(0, left / ms)})`;
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        if (sec > 0 && sec <= 5) sdk.sound('tick');
      }
      const p = players.find((x) => x.id === id);
      if (left <= 0 || !p?.connected) {
        if (left <= 0) status(tv().timeUp(nameOf(id)));
        finish(false);
      }
    }, 200);
    const finish = (keep: boolean) => {
      window.clearInterval(timer);
      turnHandler = null;
      resolve(keep);
    };
    turnHandler = (playerId, input) => {
      if (playerId !== id || input.kind !== 'text') return;
      const before = r.hiddenCount();
      if (input.id === 'solve') {
        turnHandler = null; // one decision per turn
        if (r.trySolve(input.value)) {
          addScore(id, SOLVE_BONUS + POINTS_PER_LETTER * before);
          status(tv().solvedBy(nameOf(id)));
          sdk.setLayout({ type: 'message', text: pt(id).solvedBy(nameOf(id)), subtext: pt(id).plusPoints(SOLVE_BONUS + POINTS_PER_LETTER * before) }, id);
          sdk.sound('correct');
          render();
          finish(false);
        } else {
          status(tv().wrongSolve(nameOf(id), input.value.slice(0, 30)));
          sdk.setLayout({ type: 'message', text: pt(id).wrongWord }, id);
          sdk.sound('wrong');
          render();
          finish(false);
        }
        return;
      }
      const letter = input.value.trim();
      const out = r.guessLetter(letter);
      if (!out.ok) {
        sendPhones(); // already used / not a letter: let them pick again
        return;
      }
      turnHandler = null; // one decision per turn
      sdk.sound('letter');
      if (out.hits > 0) {
        let pts = POINTS_PER_LETTER * out.hits;
        const completed = r.hiddenCount() === 0;
        if (completed) pts += COMPLETE_BONUS;
        addScore(id, pts);
        status(completed ? tv().completedBy(nameOf(id)) : tv().hit(nameOf(id), letter, out.hits));
        sdk.sound(completed ? 'correct' : 'coin');
        sdk.setLayout({ type: 'message', text: completed ? pt(id).completedBy(nameOf(id)) : pt(id).nice, subtext: pt(id).plusPoints(pts) }, id);
        render();
        window.setTimeout(() => finish(!completed), 900);
      } else {
        status(tv().miss(nameOf(id), letter));
        sdk.sound('wrong');
        sdk.setLayout({ type: 'message', text: pt(id).oops }, id);
        render();
        window.setTimeout(() => finish(false), 900);
      }
    };
  });
}

async function endWord(): Promise<void> {
  const r = round!;
  currentId = null;
  revealAll = true;
  if (r.popped) {
    status(tv().popped);
    sdk.sound('lose');
  } else sdk.sound('reveal');
  render();
  const msg = tv().theWordWas(r.word);
  announce(`${r.popped ? tv().popped : ''} ${msg}`);
  for (const p of connected()) sdk.setLayout({ type: 'message', text: pt(p.id).theWordWas(r.word) }, p.id);
  await sleep(4000);
  status('');
}

function addScore(id: string, pts: number): void {
  scores.set(id, (scores.get(id) ?? 0) + pts);
}

// ---------------------------------------------------------------- phones

function sendPhones(): void {
  const r = round;
  if (!r || r.over) return;
  for (const p of connected()) {
    const d = pt(p.id);
    if (p.id === currentId) {
      sdk.setLayout({ type: 'letters', id: 'letter', prompt: `${d.yourTurn} · ${d.categories[category]}`, letters: ALPHABETS[sdk.lang], used: [...r.used], solve: true }, p.id);
    } else if (currentId) {
      sdk.setLayout({ type: 'message', text: d.isPicking(nameOf(currentId)), subtext: d.category(d.categories[category]) }, p.id);
    }
  }
}

// ---------------------------------------------------------------- TV

function status(text: string): void {
  $('#status').textContent = text;
  if (text) announce(text);
}

async function card(title: string, body: string, ms: number): Promise<void> {
  const overlay = $('#overlay');
  clear(overlay);
  overlay.append(h('div', { class: 'card pop' }, h('div', { class: 'big' }, title), h('p', {}, body)));
  announce(`${title}. ${body}`);
  await sleep(ms);
  clear(overlay);
}

function render(): void {
  const d = tv();
  const r = round;
  $('#word-n').textContent = r ? d.wordN(wordIndex + 1, WORDS_PER_GAME) : '';
  $('#category').textContent = r ? d.category(d.categories[category]) : '';

  const wordEl = $('#word');
  clear(wordEl);
  if (r) {
    const shown = revealAll ? r.chars : r.masked();
    shown.forEach((c, i) => {
      const key = r.keys[i] ?? null;
      if (key === null) wordEl.append(h('span', { class: r.chars[i] === ' ' ? 'gap' : 'tile punct', 'aria-hidden': 'true' }, r.chars[i] === ' ' ? '' : r.chars[i]!));
      else wordEl.append(h('span', { class: `tile${c ? ' open' : ''}${revealAll && !r.used.includes(key) && !r.solved ? ' missed' : ''}`, 'aria-hidden': 'true' }, c ?? ''));
    });
    wordEl.setAttribute('aria-label', d.wordLabel(shown.map((c) => c ?? '_').join('')));
  }

  // Balloon shrinks with each miss; text says the same for screen readers and colour-blind players.
  const misses = r?.misses.length ?? 0;
  const balloon = $('#balloon');
  balloon.classList.toggle('popped', !!r?.popped);
  balloon.style.setProperty('--scale', String(1 - (misses / MAX_MISSES) * 0.6));
  balloon.setAttribute('aria-label', d.balloonLabel(MAX_MISSES - misses));
  $('#misses').textContent = d.misses(misses, MAX_MISSES);

  const used = $('#used');
  clear(used);
  used.setAttribute('aria-label', d.usedLetters);
  for (const k of r?.used ?? []) {
    const miss = r!.misses.includes(k);
    used.append(h('li', { class: miss ? 'miss' : 'hit', 'aria-label': `${k}: ${miss ? d.notInWord : d.inWord}` }, h('span', { 'aria-hidden': 'true' }, `${k} ${miss ? '✗' : '✓'}`)));
  }

  const board = $('#scores');
  clear(board);
  for (const p of [...players].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))) {
    const li = h(
      'li',
      { class: `${p.id === currentId ? 'turn' : ''}${p.connected ? '' : ' away'}` },
      h('span', { 'aria-hidden': 'true' }, AVATARS[p.avatar] ?? ''),
      h('span', { class: 'n' }, p.id === currentId ? `▶ ${p.nickname}` : p.nickname),
      h('span', { class: 's' }, d.pts(scores.get(p.id) ?? 0)),
    );
    li.style.setProperty('--c', p.color);
    board.append(li);
  }
  if (!currentId) {
    const bar = document.getElementById('timer');
    if (bar) bar.style.transform = 'scaleX(0)';
  }
}
