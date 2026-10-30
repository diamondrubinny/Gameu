/**
 * Texas Hold'em engine — pure logic, no DOM. Virtual chips only.
 * Rules: no-limit, TDA-style minimum raises, incomplete all-in raises do not reopen betting,
 * side pots, heads-up blind order, odd chips to the first winner left of the dealer.
 */

export type Suit = 's' | 'h' | 'd' | 'c';
export interface Card {
  /** 2..14 (14 = ace). */
  r: number;
  s: Suit;
}

const RANK_CHARS = '__23456789TJQKA';
const SUITS: Suit[] = ['s', 'h', 'd', 'c'];

export function cardCode(c: Card): string {
  return `${RANK_CHARS[c.r]}${c.s}`;
}

export function parseCard(code: string): Card {
  const r = RANK_CHARS.indexOf(code[0] ?? '');
  const s = code[1] as Suit;
  if (r < 2 || !SUITS.includes(s)) throw new Error(`bad card ${code}`);
  return { r, s };
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  return deck;
}

export function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------- hand evaluation

export const enum Cat {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_KEYS = ['highCard', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush'] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface HandValue {
  cat: Cat;
  /** Tie-break ranks, most significant first. */
  ranks: number[];
  /** Single comparable number (higher wins). */
  score: number;
  best: Card[];
}

function scoreOf(cat: number, ranks: number[]): number {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (ranks[i] ?? 0);
  return s;
}

export function evaluate5(cards: Card[]): HandValue {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0]!.s);
  const uniq = [...new Set(rs)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0]! - uniq[4]! === 4) straightHigh = uniq[0]!;
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5; // wheel A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const byGroup = groups.map((g) => g[0]);
  let cat: Cat;
  let ranks: number[];
  if (straightHigh && flush) [cat, ranks] = [Cat.StraightFlush, [straightHigh]];
  else if (shape === '41') [cat, ranks] = [Cat.Quads, byGroup];
  else if (shape === '32') [cat, ranks] = [Cat.FullHouse, byGroup];
  else if (flush) [cat, ranks] = [Cat.Flush, rs];
  else if (straightHigh) [cat, ranks] = [Cat.Straight, [straightHigh]];
  else if (shape === '311') [cat, ranks] = [Cat.Trips, byGroup];
  else if (shape === '221') [cat, ranks] = [Cat.TwoPair, byGroup];
  else if (shape === '2111') [cat, ranks] = [Cat.Pair, byGroup];
  else [cat, ranks] = [Cat.HighCard, rs];
  return { cat, ranks, score: scoreOf(cat, ranks), best: cards };
}

/** Best 5-card hand out of 5–7 cards. */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('need at least 5 cards');
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || v.score > best.score) best = v;
          }
  return best!;
}

// ---------------------------------------------------------------- table

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'done';

export type Action = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number } | { type: 'allin' };

export interface Seat {
  id: string;
  chips: number;
  hole: Card[];
  /** Not dealt in this hand (busted). */
  out: boolean;
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in during the whole hand. */
  total: number;
  acted: boolean;
  /** False after an incomplete all-in raise when this player already acted. */
  canRaise: boolean;
}

export interface Legal {
  check: boolean;
  /** Chips needed to call (already capped by the stack); 0 when checking is possible. */
  call: number;
  canRaise: boolean;
  /** Raise targets are "total bet on this street". */
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface PotResult {
  amount: number;
  winners: string[];
  /** Winning hand (absent when everyone else folded). */
  hand?: HandValue;
}

export interface HandResult {
  pots: PotResult[];
  /** Hands shown at showdown (non-folded players), empty when won by folds. */
  shown: { id: string; hand: HandValue }[];
  /** Net chips each player won this hand (winnings minus contribution). */
  net: Record<string, number>;
}

export type TableEvent =
  | { type: 'blinds'; sb: { id: string; amount: number }; bb: { id: string; amount: number } }
  | { type: 'action'; id: string; action: Action['type']; amount: number }
  | { type: 'street'; street: Exclude<Street, 'preflop' | 'done'>; board: Card[] }
  | { type: 'end'; result: HandResult };

export class HoldemTable {
  readonly seats: Seat[];
  dealer = -1;
  sb: number;
  bb: number;
  street: Street = 'done';
  board: Card[] = [];
  current = -1;
  currentBet = 0;
  minRaise = 0;
  handNo = 0;
  sbSeat = -1;
  bbSeat = -1;
  lastResult: HandResult | null = null;
  private deck: Card[] = [];
  private events: TableEvent[] = [];

  constructor(players: { id: string; chips: number }[], blinds: { sb: number; bb: number }, private readonly rand: () => number = Math.random) {
    this.seats = players.map((p) => ({ id: p.id, chips: p.chips, hole: [], out: false, folded: false, allIn: false, bet: 0, total: 0, acted: false, canRaise: true }));
    this.sb = blinds.sb;
    this.bb = blinds.bb;
  }

  /** Events since the last call (for sounds and animations). */
  drainEvents(): TableEvent[] {
    return this.events.splice(0);
  }

  seat(id: string): Seat | undefined {
    return this.seats.find((s) => s.id === id);
  }

  /** Players with chips left (meaningful between hands). */
  withChips(): Seat[] {
    return this.seats.filter((s) => s.chips > 0);
  }

  get pot(): number {
    return this.seats.reduce((sum, s) => sum + s.total, 0);
  }

  get currentId(): string | null {
    return this.street === 'done' ? null : (this.seats[this.current]?.id ?? null);
  }

  private inHand(s: Seat): boolean {
    return !s.out && !s.folded;
  }

  private canAct(s: Seat): boolean {
    return this.inHand(s) && !s.allIn;
  }

  private nextIndex(from: number, pred: (s: Seat) => boolean): number {
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + k) % n) + n) % n;
      if (pred(this.seats[i]!)) return i;
    }
    return -1;
  }

  startHand(): void {
    if (this.street !== 'done') throw new Error('hand in progress');
    const players = this.seats.filter((s) => s.chips > 0);
    if (players.length < 2) throw new Error('need two players with chips');
    this.handNo++;
    this.lastResult = null;
    for (const s of this.seats) {
      Object.assign(s, { hole: [], out: s.chips <= 0, folded: false, allIn: false, bet: 0, total: 0, acted: false, canRaise: true });
    }
    this.dealer = this.nextIndex(this.dealer, (s) => !s.out);
    this.deck = shuffle(freshDeck(), this.rand);
    this.board = [];
    const order: number[] = [];
    for (let i = this.nextIndex(this.dealer, (s) => !s.out), k = 0; k < players.length; k++, i = this.nextIndex(i, (s) => !s.out)) order.push(i);
    for (let round = 0; round < 2; round++) for (const i of order) this.seats[i]!.hole.push(this.deck.pop()!);

    const headsUp = players.length === 2;
    this.sbSeat = headsUp ? this.dealer : this.nextIndex(this.dealer, (s) => !s.out);
    this.bbSeat = this.nextIndex(this.sbSeat, (s) => !s.out);
    const sbAmt = this.put(this.seats[this.sbSeat]!, this.sb);
    const bbAmt = this.put(this.seats[this.bbSeat]!, this.bb);
    this.events.push({ type: 'blinds', sb: { id: this.seats[this.sbSeat]!.id, amount: sbAmt }, bb: { id: this.seats[this.bbSeat]!.id, amount: bbAmt } });
    this.street = 'preflop';
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    this.current = this.bbSeat;
    this.advance();
  }

  /** Moves chips from a stack into the pot; returns the amount actually put in. */
  private put(s: Seat, amount: number): number {
    const a = Math.max(0, Math.min(amount, s.chips));
    s.chips -= a;
    s.bet += a;
    s.total += a;
    if (s.chips === 0) s.allIn = true;
    return a;
  }

  legal(id: string): Legal | null {
    if (this.currentId !== id) return null;
    const s = this.seats[this.current]!;
    const toCall = Math.max(0, this.currentBet - s.bet);
    const stackTo = s.bet + s.chips;
    const opponentsCanAct = this.seats.some((o) => o !== s && this.canAct(o));
    const canRaise = s.canRaise && opponentsCanAct && stackTo > this.currentBet;
    return {
      check: toCall === 0,
      call: Math.min(toCall, s.chips),
      canRaise,
      minRaiseTo: canRaise ? Math.min(this.currentBet + this.minRaise, stackTo) : 0,
      maxRaiseTo: canRaise ? stackTo : 0,
    };
  }

  act(id: string, action: Action): { ok: true } | { ok: false; error: string } {
    const legal = this.legal(id);
    if (!legal) return { ok: false, error: 'not your turn' };
    const s = this.seats[this.current]!;
    let a = action;
    if (a.type === 'allin') {
      const to = s.bet + s.chips;
      a = legal.canRaise && to > this.currentBet ? { type: 'raise', to } : { type: 'call' };
    }
    let amount = 0;
    switch (a.type) {
      case 'fold':
        s.folded = true;
        break;
      case 'check':
        if (!legal.check) return { ok: false, error: 'cannot check' };
        break;
      case 'call':
        amount = this.put(s, legal.call);
        break;
      case 'raise': {
        if (!legal.canRaise) return { ok: false, error: 'cannot raise' };
        const to = Math.floor(a.to);
        if (to > legal.maxRaiseTo || (to < legal.minRaiseTo && to !== legal.maxRaiseTo) || to <= this.currentBet) return { ok: false, error: 'bad raise size' };
        amount = this.put(s, to - s.bet);
        const increment = to - this.currentBet;
        const full = increment >= this.minRaise;
        for (const o of this.seats) {
          if (o === s || !this.canAct(o)) continue;
          if (full) {
            o.acted = false;
            o.canRaise = true;
          } else if (o.acted) {
            // Incomplete all-in raise: they must respond but may not re-raise.
            o.acted = false;
            o.canRaise = false;
          }
        }
        if (full) this.minRaise = increment;
        this.currentBet = to;
        break;
      }
    }
    s.acted = true;
    const shown = action.type === 'allin' || s.allIn ? 'allin' : a.type;
    this.events.push({ type: 'action', id, action: shown, amount });
    this.advance();
    return { ok: true };
  }

  private advance(): void {
    const live = this.seats.filter((s) => this.inHand(s));
    if (live.length === 1) {
      this.finish();
      return;
    }
    const roundDone = this.seats.every((s) => !this.canAct(s) || (s.acted && s.bet === this.currentBet));
    if (!roundDone) {
      this.current = this.nextIndex(this.current, (s) => this.canAct(s) && (!s.acted || s.bet < this.currentBet));
      return;
    }
    // Street over: next street, or run the board out when at most one player can still bet.
    for (const s of this.seats) {
      s.bet = 0;
      s.acted = false;
      s.canRaise = true;
    }
    this.currentBet = 0;
    this.minRaise = this.bb;
    const actors = this.seats.filter((s) => this.canAct(s)).length;
    if (this.street === 'river') {
      this.finish();
      return;
    }
    this.dealStreet();
    if (actors <= 1) {
      while (this.board.length < 5) this.dealStreet();
      this.finish();
      return;
    }
    this.current = this.nextIndex(this.dealer, (s) => this.canAct(s));
  }

  private dealStreet(): void {
    this.deck.pop(); // burn
    if (this.board.length === 0) {
      this.board.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
      this.street = 'flop';
    } else {
      this.board.push(this.deck.pop()!);
      this.street = this.board.length === 4 ? 'turn' : 'river';
    }
    this.events.push({ type: 'street', street: this.street as 'flop' | 'turn' | 'river', board: [...this.board] });
  }

  /** Builds main and side pots from what everyone put in. */
  pots(): { amount: number; eligible: number[] }[] {
    const levels = [...new Set(this.seats.map((s) => s.total).filter((t) => t > 0))].sort((a, b) => a - b);
    const pots: { amount: number; eligible: number[] }[] = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const s of this.seats) amount += Math.max(0, Math.min(s.total, level) - prev);
      const eligible = this.seats.map((s, i) => (this.inHand(s) && s.total >= level ? i : -1)).filter((i) => i >= 0);
      const last = pots[pots.length - 1];
      if (eligible.length === 0 && last) last.amount += amount;
      else if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
      prev = level;
    }
    return pots.filter((p) => p.amount > 0 && p.eligible.length > 0);
  }

  /**
   * Pot amounts for display during a hand: split only at the all-in levels of players still
   * in the hand (bets in progress are not side pots yet). First entry is the main pot.
   */
  livePots(): number[] {
    const caps = [...new Set(this.seats.filter((s) => this.inHand(s) && s.allIn).map((s) => s.total))].sort((a, b) => a - b);
    const out: number[] = [];
    let prev = 0;
    let used = 0;
    for (const cap of caps) {
      let amount = 0;
      for (const s of this.seats) amount += Math.max(0, Math.min(s.total, cap) - prev);
      if (amount > 0) out.push(amount);
      used += amount;
      prev = cap;
    }
    if (this.pot - used > 0 || out.length === 0) out.push(this.pot - used);
    return out;
  }

  private finish(): void {
    const contributed = new Map(this.seats.map((s) => [s.id, s.total]));
    const live = this.seats.map((s, i) => (this.inHand(s) ? i : -1)).filter((i) => i >= 0);
    const showdown = live.length > 1;
    const hands = new Map<number, HandValue>();
    if (showdown) for (const i of live) hands.set(i, evaluateBest([...this.seats[i]!.hole, ...this.board]));
    const results: PotResult[] = [];
    const won = new Map<string, number>();
    for (const pot of this.pots()) {
      let winners = pot.eligible;
      let hand: HandValue | undefined;
      if (showdown) {
        const best = Math.max(...pot.eligible.map((i) => hands.get(i)!.score));
        winners = pot.eligible.filter((i) => hands.get(i)!.score === best);
        hand = hands.get(winners[0]!);
      }
      // Odd chips go to the winner(s) closest to the dealer's left.
      const ordered = [...winners].sort((a, b) => this.distFromDealer(a) - this.distFromDealer(b));
      const share = Math.floor(pot.amount / ordered.length);
      let rest = pot.amount - share * ordered.length;
      for (const i of ordered) {
        const s = this.seats[i]!;
        const gain = share + (rest-- > 0 ? 1 : 0);
        s.chips += gain;
        won.set(s.id, (won.get(s.id) ?? 0) + gain);
      }
      results.push({ amount: pot.amount, winners: ordered.map((i) => this.seats[i]!.id), hand });
    }
    const net: Record<string, number> = {};
    for (const s of this.seats) if (!s.out) net[s.id] = (won.get(s.id) ?? 0) - (contributed.get(s.id) ?? 0);
    const result: HandResult = { pots: results, shown: showdown ? live.map((i) => ({ id: this.seats[i]!.id, hand: hands.get(i)! })) : [], net };
    for (const s of this.seats) {
      s.bet = 0;
      s.total = 0;
    }
    this.street = 'done';
    this.current = -1;
    this.lastResult = result;
    this.events.push({ type: 'end', result });
  }

  private distFromDealer(i: number): number {
    const n = this.seats.length;
    return (((i - this.dealer - 1) % n) + n) % n;
  }

  /** A player who left: folds now if it is their turn, and is skipped (folded) otherwise. */
  forceFold(id: string): void {
    const s = this.seat(id);
    if (!s || this.street === 'done' || !this.inHand(s)) return;
    if (this.currentId === id) {
      this.act(id, { type: 'fold' });
      return;
    }
    s.folded = true;
    this.events.push({ type: 'action', id, action: 'fold', amount: 0 });
    // The player to act is still pending, so only a lone survivor can end the hand here.
    if (this.seats.filter((o) => this.inHand(o)).length === 1) this.finish();
  }
}
