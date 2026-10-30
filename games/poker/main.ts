import { createSdk, type GamePlayer, type Input } from '../../src/sdk/gameu';
import { AVATARS } from '../../src/shared/constants';
import { $, announce, applyDocumentSettings, clear, h, shuffle, sleep } from '../../src/sdk/game-utils';
import { CATEGORY_KEYS, HoldemTable, cardCode, type Action, type Card, type HandResult, type Legal, type TableEvent } from './engine';
import { DICTS } from './locales';
import type { PokerDict } from './locales/he';

const STARTING_CHIPS = 1000;
const MAX_HANDS = 25;
const HANDS_PER_LEVEL = 5;
const BLIND_LEVELS: [number, number][] = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400]];
const AWAY_TIMEOUT_MS = 5000;
const SHOWDOWN_MS = 5500;

const sdk = createSdk();
let players: GamePlayer[] = [];
let table: HoldemTable | null = null;
let turnSeconds = 30;
/** Raise presets offered to the current player: button id → raise target. */
let presets = new Map<string, number>();
let resolveTurn: ((a: Action) => void) | null = null;
let turnDeadline = 0;
/** Last action text shown under each seat during the hand. */
const lastAction = new Map<string, string>();
let showdown: HandResult | null = null;

const tv = (): PokerDict => sdk.tr(DICTS);
const pt = (id: string): PokerDict => sdk.trFor(id, DICTS);
const player = (id: string) => players.find((p) => p.id === id);
const nameOf = (id: string) => player(id)?.nickname ?? '?';

sdk.onInit(async (ctx) => {
  applyDocumentSettings(ctx.settings);
  players = ctx.players;
  turnSeconds = ctx.settings.extendedTime ? 60 : 30;
  $('#title').textContent = `♠ ${tv().title}`;
  $('#board').setAttribute('aria-label', tv().boardLabel);
  sdk.music('tense');
  const seated = shuffle(players.filter((p) => p.connected));
  table = new HoldemTable(
    seated.map((p) => ({ id: p.id, chips: STARTING_CHIPS })),
    { sb: BLIND_LEVELS[0]![0], bb: BLIND_LEVELS[0]![1] },
  );
  render();
  await intro();
  await run();
});

sdk.onPlayers((p) => {
  players = p;
  render();
  updatePhones();
});

sdk.onInput((playerId: string, input: Input) => {
  const t = table;
  if (!t || !resolveTurn || t.currentId !== playerId) return;
  if (input.kind !== 'button' || !input.pressed) return;
  const legal = t.legal(playerId);
  if (!legal) return;
  let action: Action | null = null;
  if (input.id === 'fold') action = { type: 'fold' };
  else if (input.id === 'check' && legal.check) action = { type: 'check' };
  else if (input.id === 'call' && !legal.check) action = { type: 'call' };
  else if (input.id === 'allin') action = { type: 'allin' };
  else if (presets.has(input.id)) action = { type: 'raise', to: presets.get(input.id)! };
  if (action) resolveTurn(action);
});

async function intro(): Promise<void> {
  const overlay = $('#overlay');
  clear(overlay);
  overlay.append(h('div', { class: 'card pop' }, h('div', { class: 'big' }, `♠ ♥ ${tv().title} ♦ ♣`), h('p', {}, tv().intro(STARTING_CHIPS)), h('p', { class: 'muted' }, tv().noMoney)));
  announce(`${tv().title}. ${tv().intro(STARTING_CHIPS)} ${tv().noMoney}`);
  for (const p of players) sdk.setLayout({ type: 'message', text: pt(p.id).title, subtext: pt(p.id).noMoney }, p.id);
  await sleep(4500);
  clear(overlay);
}

async function run(): Promise<void> {
  const t = table!;
  for (let hand = 0; hand < MAX_HANDS; hand++) {
    if (seatedConnected().length < 2 || t.withChips().length < 2) break;
    const level = BLIND_LEVELS[Math.min(BLIND_LEVELS.length - 1, Math.floor(hand / HANDS_PER_LEVEL))]!;
    if (level[1] !== t.bb) {
      [t.sb, t.bb] = level;
      await banner(tv().blindsUp(t.sb, t.bb));
    }
    // Players who left the room for good are folded out of every hand.
    lastAction.clear();
    showdown = null;
    t.startHand();
    sdk.sound('card');
    await handleEvents();
    while (t.street !== 'done') {
      for (const s of t.seats) if (!s.out && !s.folded && !player(s.id)) t.forceFold(s.id);
      // forceFold may have ended the hand (TS can't see the mutation).
      const id = t.currentId;
      if (!id) break;
      const action = await askTurn(id);
      if (!t.act(id, action).ok) t.act(id, t.legal(id)?.check ? { type: 'check' } : { type: 'fold' });
      await handleEvents();
    }
    await handleEvents();
    for (const s of t.seats) {
      if (s.chips === 0 && !s.out) {
        announce(tv().eliminated(nameOf(s.id)));
        sdk.setLayout({ type: 'message', text: pt(s.id).youAreOut }, s.id);
      }
    }
  }
  await finishGame();
}

function seatedConnected() {
  return table!.seats.filter((s) => s.chips > 0 && player(s.id)?.connected);
}

/** Waits for the player's decision; auto-checks/folds on timeout (sooner if they are away). */
function askTurn(id: string): Promise<Action> {
  const t = table!;
  const legal = t.legal(id)!;
  presets = raisePresets(legal);
  const connected = player(id)?.connected ?? false;
  const ms = connected ? turnSeconds * 1000 : AWAY_TIMEOUT_MS;
  turnDeadline = performance.now() + ms;
  sdk.sound('turn');
  if (connected) sdk.haptic([80, 40, 80], id);
  announce(tv().turnOf(nameOf(id)));
  return new Promise((resolve) => {
    let lastSec = -1;
    const timer = window.setInterval(() => {
      const left = turnDeadline - performance.now();
      const sec = Math.ceil(left / 1000);
      paintTimer(left / ms);
      if (sec !== lastSec) {
        lastSec = sec;
        if (sec > 0 && sec <= 5 && connected) sdk.sound('tick');
      }
      // A player who disconnects mid-turn gets the short timeout.
      if (!player(id)?.connected && turnDeadline - performance.now() > AWAY_TIMEOUT_MS) turnDeadline = performance.now() + AWAY_TIMEOUT_MS;
      if (left <= 0) done(legal.check ? { type: 'check' } : { type: 'fold' });
    }, 200);
    const done = (a: Action) => {
      window.clearInterval(timer);
      resolveTurn = null;
      presets = new Map();
      resolve(a);
    };
    resolveTurn = done;
    // Only now (with the handler registered) do phones get the action buttons.
    render();
    updatePhones();
  });
}

function raisePresets(legal: Legal): Map<string, number> {
  const out = new Map<string, number>();
  if (!legal.canRaise) return out;
  const t = table!;
  const pot = t.pot + legal.call; // pot after calling
  const round = (n: number) => Math.round(n / t.sb) * t.sb;
  const targets = [legal.minRaiseTo, round(t.currentBet + pot / 2), round(t.currentBet + pot)]
    .filter((x) => x >= legal.minRaiseTo && x < legal.maxRaiseTo);
  [...new Set(targets)].sort((a, b) => a - b).slice(0, 3).forEach((to, i) => out.set(`raise${i + 1}`, to));
  return out;
}

async function handleEvents(): Promise<void> {
  const t = table!;
  for (const e of t.drainEvents()) await onEvent(e);
  render();
  updatePhones();
}

async function onEvent(e: TableEvent): Promise<void> {
  const d = tv();
  switch (e.type) {
    case 'blinds':
      sdk.sound('chip');
      break;
    case 'action': {
      const text = actionText(d, e.action, e.amount, e.id);
      lastAction.set(e.id, text);
      announce(`${nameOf(e.id)}: ${text}`);
      sdk.sound(e.action === 'fold' ? 'card' : e.action === 'check' ? 'letter' : 'chip');
      render();
      await sleep(350);
      break;
    }
    case 'street':
      lastAction.clear();
      render();
      for (let i = 0; i < (e.street === 'flop' ? 3 : 1); i++) {
        sdk.sound('card');
        await sleep(180);
      }
      announce(`${d.streets[e.street]}: ${e.board.map(cardSpeech).join(', ')}`);
      await sleep(700);
      break;
    case 'end':
      await showResult(e.result);
      break;
  }
}

function actionText(d: PokerDict, action: string, amount: number, id: string): string {
  // After a street closes the bets are already collected, so fall back to the amount added.
  const total = table!.seat(id)?.bet || amount;
  switch (action) {
    case 'fold':
      return d.did.fold;
    case 'check':
      return d.did.check;
    case 'call':
      return d.did.call(amount);
    case 'raise':
      return d.did.raise(total);
    default:
      return d.did.allin(amount);
  }
}

async function showResult(result: HandResult): Promise<void> {
  const d = tv();
  showdown = result;
  if (result.shown.length) sdk.sound('reveal');
  render();
  const lines: string[] = [];
  for (const pot of result.pots) {
    const hand = pot.hand ? d.hands[CATEGORY_KEYS[pot.hand.cat]] : null;
    const names = pot.winners.map(nameOf).join(' & ');
    lines.push(pot.winners.length > 1 ? d.split(names, pot.amount) : hand ? d.winsWith(names, pot.amount, hand) : d.wins(names, pot.amount));
  }
  $('#status').textContent = lines.join(' · ');
  announce(lines.join('. '));
  await sleep(result.shown.length ? 900 : 300);
  sdk.sound('coin');
  for (const [id, net] of Object.entries(result.net)) {
    if (!player(id)) continue;
    const p = pt(id);
    if (net > 0) {
      sdk.setLayout({ type: 'message', text: p.youWon(net) }, id);
      sdk.haptic([60, 40, 60], id);
    } else if (net < 0) sdk.setLayout({ type: 'message', text: p.youLost(-net) }, id);
  }
  await sleep(result.shown.length ? SHOWDOWN_MS : 2500);
  $('#status').textContent = '';
}

async function finishGame(): Promise<void> {
  const t = table!;
  const ranked = [...t.seats].sort((a, b) => b.chips - a.chips);
  const top = ranked[0];
  sdk.music('off');
  if (top) {
    sdk.sound('win');
    await banner(`${tv().gameOver} — ${tv().champion(nameOf(top.id))}`, 3500);
  }
  sdk.end(t.seats.map((s) => ({ playerId: s.id, score: s.chips })));
}

async function banner(text: string, ms = 2200): Promise<void> {
  const overlay = $('#overlay');
  clear(overlay);
  overlay.append(h('div', { class: 'card pop' }, h('div', { class: 'big' }, text)));
  announce(text);
  await sleep(ms);
  clear(overlay);
}

// ---------------------------------------------------------------- TV rendering

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

function cardSpeech(c: Card): string {
  const code = cardCode(c);
  return `${code[0] === 'T' ? '10' : code[0]}${SUIT_SYMBOL[c.s]}`;
}

function cardEl(c: Card | null, extra = ''): HTMLElement {
  if (!c) return h('div', { class: `pcard back ${extra}`, role: 'img', 'aria-label': tv().cardBack });
  const code = cardCode(c);
  return h(
    'div',
    { class: `pcard suit-${c.s} ${extra}`, role: 'img', 'aria-label': cardSpeech(c) },
    h('span', { class: 'rank', 'aria-hidden': 'true' }, code[0] === 'T' ? '10' : code[0]!),
    h('span', { class: 'suit', 'aria-hidden': 'true' }, SUIT_SYMBOL[c.s]!),
  );
}

function render(): void {
  const t = table;
  if (!t) return;
  const d = tv();
  $('#hand-info').textContent = t.handNo ? d.handInfo(t.handNo, MAX_HANDS, t.sb, t.bb) : '';
  // Board: five slots so the layout doesn't jump.
  const board = $('#board');
  clear(board);
  for (let i = 0; i < 5; i++) board.append(t.board[i] ? cardEl(t.board[i]!, 'deal') : h('div', { class: 'pcard slot', 'aria-hidden': 'true' }));
  const pots = t.street === 'done' ? [] : t.livePots();
  const pot = $('#pot');
  clear(pot);
  if (t.pot > 0) {
    pot.append(h('div', { class: 'pot-main' }, '\u{1FA99} ', d.pot(t.pot)));
    if (pots.length > 1) pots.slice(1).forEach((amount, i) => pot.append(h('div', { class: 'pot-side' }, d.sidePot(i + 1, amount))));
  }
  const seatsEl = $('#seats');
  clear(seatsEl);
  const n = t.seats.length;
  const winners = new Set(showdown?.pots.flatMap((p) => p.winners) ?? []);
  const shownHands = new Map(showdown?.shown.map((s) => [s.id, s.hand]) ?? []);
  t.seats.forEach((s, i) => {
    const p = player(s.id);
    // Seat 0 at the bottom centre, others clockwise around the oval.
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = 50 + 43 * Math.cos(angle);
    const y = 50 + 40 * Math.sin(angle);
    const isTurn = t.currentId === s.id;
    const status = s.out || (s.chips === 0 && t.street === 'done' && !winners.has(s.id))
      ? d.status.out
      : s.folded
        ? d.status.folded
        : s.allIn
          ? d.status.allIn
          : !p?.connected
            ? d.status.away
            : '';
    const act = lastAction.get(s.id);
    const badges = [i === t.dealer ? h('span', { class: 'badge dealer', title: d.dealer, 'aria-label': d.dealer }, 'D') : null, i === t.sbSeat && t.street !== 'done' ? h('span', { class: 'badge', 'aria-label': d.smallBlind }, 'SB') : null, i === t.bbSeat && t.street !== 'done' ? h('span', { class: 'badge', 'aria-label': d.bigBlind }, 'BB') : null];
    const showCards = shownHands.has(s.id);
    const cards = s.out ? [] : showCards ? s.hole.map((c) => cardEl(c, 'small')) : s.hole.length && !s.folded ? [cardEl(null, 'small'), cardEl(null, 'small')] : [];
    const hand = shownHands.get(s.id);
    const el = h(
      'li',
      {
        class: `seat${isTurn ? ' turn' : ''}${s.folded || s.out ? ' folded' : ''}${winners.has(s.id) ? ' winner' : ''}`,
        'aria-label': `${d.seatLabel(p?.nickname ?? '?', s.chips)}${status ? `, ${status}` : ''}${isTurn ? `, ${d.turnOf(p?.nickname ?? '')}` : ''}`,
      },
      h('div', { class: 'seat-cards' }, ...cards),
      h(
        'div',
        { class: 'seat-plate' },
        h('span', { class: 'seat-avatar', 'aria-hidden': 'true' }, AVATARS[p?.avatar ?? 0] ?? ''),
        h('span', { class: 'seat-name' }, p?.nickname ?? '?', ...badges),
        h('span', { class: 'seat-chips' }, String(s.chips)),
        isTurn ? h('div', { class: 'seat-timer' }, h('div', { class: 'seat-timer-bar' })) : null,
      ),
      hand ? h('div', { class: 'seat-hand' }, d.hands[CATEGORY_KEYS[hand.cat]]) : status ? h('div', { class: 'seat-status' }, status) : act ? h('div', { class: 'seat-status act' }, act) : null,
      s.bet > 0 ? h('div', { class: 'seat-bet' }, '● ', String(s.bet)) : null,
    );
    // CSSOM, not a style attribute: the game CSP forbids inline styles.
    el.style.setProperty('--x', `${x.toFixed(1)}%`);
    el.style.setProperty('--y', `${y.toFixed(1)}%`);
    el.style.setProperty('--c', p?.color ?? '#888');
    seatsEl.append(el);
  });
  const cur = t.currentId;
  if (!showdown) $('#status').textContent = cur ? d.turnOf(nameOf(cur)) : '';
}

function paintTimer(frac: number): void {
  const bar = document.querySelector<HTMLElement>('.seat.turn .seat-timer-bar');
  if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
}

// ---------------------------------------------------------------- phones

function updatePhones(): void {
  const t = table;
  if (!t) return;
  const seated = new Set(t.seats.map((s) => s.id));
  for (const p of players) {
    if (!p.connected) continue;
    const d = pt(p.id);
    if (!seated.has(p.id)) {
      sdk.setLayout({ type: 'message', text: d.watching, subtext: d.noMoney }, p.id);
      continue;
    }
    const s = t.seat(p.id)!;
    if (s.out || (s.chips === 0 && t.street === 'done')) {
      sdk.setLayout({ type: 'message', text: d.youAreOut }, p.id);
      continue;
    }
    if (t.street === 'done') continue; // result messages stay on screen
    const cards = s.hole.map(cardCode);
    const info = [d.chips(s.chips), d.pot(t.pot)];
    if (t.currentId === p.id && resolveTurn) {
      const legal = t.legal(p.id)!;
      if (!legal.check) info.push(d.toCall(legal.call));
      const actions: { id: string; label: string; color?: 'primary' | 'secondary' | 'danger' | 'success' }[] = [];
      actions.push({ id: 'fold', label: d.fold, color: 'danger' });
      actions.push(legal.check ? { id: 'check', label: d.check, color: 'success' } : { id: 'call', label: d.call(legal.call), color: 'success' });
      for (const [id, to] of presets) actions.push({ id, label: t.currentBet === 0 ? d.bet(to) : d.raiseTo(to), color: 'secondary' });
      const stack = s.chips;
      if (stack > 0 && (legal.canRaise || legal.call >= stack)) actions.push({ id: 'allin', label: d.allIn(s.bet + stack), color: 'primary' });
      sdk.setLayout({ type: 'cards', id: 'hand', title: d.yourTurn, cards, info, actions }, p.id);
    } else {
      const cur = t.currentId;
      const title = s.folded ? d.folded : s.allIn ? d.youAreAllIn : cur === p.id ? d.yourTurn : cur ? d.waitingFor(nameOf(cur)) : undefined;
      sdk.setLayout({ type: 'cards', id: 'hand', title, cards, info, dim: s.folded, actions: [] }, p.id);
    }
  }
}
