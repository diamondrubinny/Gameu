import { describe, expect, it } from 'vitest';
import { Cat, HoldemTable, evaluate5, evaluateBest, parseCard, type Card } from '../../games/poker/engine';

const cards = (s: string): Card[] => s.split(' ').map(parseCard);
const best = (s: string) => evaluateBest(cards(s));

/** Deterministic PRNG for reproducible deals. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('hand evaluation', () => {
  it('recognises every category', () => {
    expect(evaluate5(cards('As Ks Qs Js Ts')).cat).toBe(Cat.StraightFlush);
    expect(evaluate5(cards('9c 9d 9h 9s 2c')).cat).toBe(Cat.Quads);
    expect(evaluate5(cards('3c 3d 3h 8s 8c')).cat).toBe(Cat.FullHouse);
    expect(evaluate5(cards('2h 7h 9h Jh Ah')).cat).toBe(Cat.Flush);
    expect(evaluate5(cards('5c 6d 7h 8s 9c')).cat).toBe(Cat.Straight);
    expect(evaluate5(cards('Ac 2d 3h 4s 5c')).cat).toBe(Cat.Straight);
    expect(evaluate5(cards('Qc Qd Qh 4s 2c')).cat).toBe(Cat.Trips);
    expect(evaluate5(cards('Jc Jd 4h 4s 2c')).cat).toBe(Cat.TwoPair);
    expect(evaluate5(cards('Tc Td 6h 4s 2c')).cat).toBe(Cat.Pair);
    expect(evaluate5(cards('Ac Jd 8h 4s 2c')).cat).toBe(Cat.HighCard);
  });

  it('wheel is the lowest straight; steel wheel is a straight flush', () => {
    expect(evaluate5(cards('Ac 2d 3h 4s 5c')).score).toBeLessThan(evaluate5(cards('2c 3d 4h 5s 6c')).score);
    expect(evaluate5(cards('Ah 2h 3h 4h 5h')).cat).toBe(Cat.StraightFlush);
  });

  it('breaks ties by kickers', () => {
    expect(evaluate5(cards('Ac Ad Kh 4s 2c')).score).toBeGreaterThan(evaluate5(cards('As Ah Qh 4c 3c')).score);
    expect(evaluate5(cards('Kc Kd 7h 7s 2c')).score).toBeGreaterThan(evaluate5(cards('Ks Kh 6h 6c Ac')).score);
    expect(evaluate5(cards('2h 7h 9h Jh Ah')).score).toBeLessThan(evaluate5(cards('3d 7d 9d Jd Ad')).score);
    expect(evaluate5(cards('Ac Kd Qh Js 9c')).score).toBe(evaluate5(cards('Ad Kc Qs Jh 9d')).score);
  });

  it('picks the best five of seven', () => {
    expect(best('As Ks 2d 3c Qs Js Ts').cat).toBe(Cat.StraightFlush);
    expect(best('9c 9d 3h 3s 3c 9h 2d').cat).toBe(Cat.FullHouse);
    const v = best('Ah Kd 4c 4d 7s 7h 2c');
    expect(v.cat).toBe(Cat.TwoPair);
    expect(v.ranks).toEqual([7, 4, 14]);
    // Board plays: both hands tie.
    expect(best('2c 3d As Ks Qs Js Ts').score).toBe(best('4h 5h As Ks Qs Js Ts').score);
  });
});

describe('betting', () => {
  it('posts blinds and orders action (3 players)', () => {
    const t = new HoldemTable([{ id: 'a', chips: 1000 }, { id: 'b', chips: 1000 }, { id: 'c', chips: 1000 }], { sb: 10, bb: 20 }, rng(1));
    t.startHand();
    // dealer a, sb b, bb c, a acts first preflop
    expect(t.seats[0]!.hole).toHaveLength(2);
    expect(t.seats[1]!.bet).toBe(10);
    expect(t.seats[2]!.bet).toBe(20);
    expect(t.currentId).toBe('a');
    expect(t.legal('a')).toMatchObject({ check: false, call: 20, canRaise: true, minRaiseTo: 40, maxRaiseTo: 1000 });
    expect(t.act('b', { type: 'call' }).ok).toBe(false); // not b's turn
    expect(t.act('a', { type: 'raise', to: 30 }).ok).toBe(false); // below min raise
    expect(t.act('a', { type: 'raise', to: 60 }).ok).toBe(true);
    expect(t.legal('b')).toMatchObject({ call: 50, minRaiseTo: 100 });
    t.act('b', { type: 'call' });
    t.act('c', { type: 'call' });
    expect(t.street).toBe('flop');
    expect(t.board).toHaveLength(3);
    expect(t.pot).toBe(180);
    // post-flop: first active left of dealer (b)
    expect(t.currentId).toBe('b');
    expect(t.legal('b')).toMatchObject({ check: true, call: 0, minRaiseTo: 20 });
  });

  it('big blind gets the option preflop', () => {
    const t = new HoldemTable([{ id: 'a', chips: 500 }, { id: 'b', chips: 500 }, { id: 'c', chips: 500 }], { sb: 5, bb: 10 }, rng(2));
    t.startHand();
    t.act('a', { type: 'call' });
    t.act('b', { type: 'call' });
    expect(t.street).toBe('preflop');
    expect(t.currentId).toBe('c');
    expect(t.legal('c')!.check).toBe(true);
    t.act('c', { type: 'check' });
    expect(t.street).toBe('flop');
  });

  it('heads-up: dealer posts the small blind, acts first preflop and last after', () => {
    const t = new HoldemTable([{ id: 'a', chips: 500 }, { id: 'b', chips: 500 }], { sb: 5, bb: 10 }, rng(3));
    t.startHand();
    expect(t.dealer).toBe(0);
    expect(t.seats[0]!.bet).toBe(5);
    expect(t.currentId).toBe('a');
    t.act('a', { type: 'call' });
    t.act('b', { type: 'check' });
    expect(t.street).toBe('flop');
    expect(t.currentId).toBe('b');
  });

  it('everyone folds to a raise: raiser wins without showdown', () => {
    const t = new HoldemTable([{ id: 'a', chips: 1000 }, { id: 'b', chips: 1000 }, { id: 'c', chips: 1000 }], { sb: 10, bb: 20 }, rng(4));
    t.startHand();
    t.act('a', { type: 'raise', to: 100 });
    t.act('b', { type: 'fold' });
    t.act('c', { type: 'fold' });
    expect(t.street).toBe('done');
    expect(t.lastResult!.shown).toHaveLength(0);
    expect(t.seat('a')!.chips).toBe(1030);
    expect(t.lastResult!.net).toEqual({ a: 30, b: -10, c: -20 });
  });

  it('incomplete all-in raise does not reopen betting for players who acted', () => {
    const t = new HoldemTable([{ id: 'a', chips: 1000 }, { id: 'b', chips: 1000 }, { id: 'c', chips: 130 }], { sb: 10, bb: 20 }, rng(5));
    t.startHand(); // c is BB with 130
    t.act('a', { type: 'raise', to: 100 });
    t.act('b', { type: 'call' });
    // c shoves 130 total: +30, less than the min raise of 80
    t.act('c', { type: 'allin' });
    expect(t.currentBet).toBe(130);
    const la = t.legal('a')!;
    expect(la.call).toBe(30);
    expect(la.canRaise).toBe(false);
  });

  it('cannot raise when every opponent is all-in', () => {
    const t = new HoldemTable([{ id: 'a', chips: 1000 }, { id: 'b', chips: 50 }], { sb: 10, bb: 20 }, rng(6));
    t.startHand(); // a dealer/sb, b bb
    t.act('a', { type: 'raise', to: 200 });
    t.act('b', { type: 'allin' });
    expect(t.street).toBe('done'); // b's all-in for less: a's excess comes back, board runs out
    expect(t.board).toHaveLength(5);
    expect(t.seat('a')!.chips + t.seat('b')!.chips).toBe(1050);
  });

  it('builds side pots and returns uncalled chips', () => {
    const t = new HoldemTable([{ id: 'a', chips: 100 }, { id: 'b', chips: 300 }, { id: 'c', chips: 1000 }], { sb: 10, bb: 20 }, rng(7));
    t.startHand();
    t.act('a', { type: 'allin' }); // 100
    t.act('b', { type: 'allin' }); // 300
    t.act('c', { type: 'call' }); // 300
    expect(t.street).toBe('done');
    const r = t.lastResult!;
    expect(r.pots.map((p) => p.amount)).toEqual([300, 400]);
    const total = t.seats.reduce((s, x) => s + x.chips, 0);
    expect(total).toBe(1400);
    // Main pot can be won by anyone, the side pot only by b or c.
    expect(r.pots[1]!.winners.every((w) => w !== 'a')).toBe(true);
  });

  it('shows side pots only at all-in levels during a hand', () => {
    const t = new HoldemTable([{ id: 'a', chips: 1000 }, { id: 'b', chips: 1000 }, { id: 'c', chips: 1000 }], { sb: 10, bb: 20 }, rng(10));
    t.startHand();
    expect(t.livePots()).toEqual([30]);
    const u = new HoldemTable([{ id: 'a', chips: 100 }, { id: 'b', chips: 1000 }, { id: 'c', chips: 1000 }], { sb: 10, bb: 20 }, rng(11));
    u.startHand();
    u.act('a', { type: 'allin' }); // 100
    u.act('b', { type: 'raise', to: 300 });
    expect(u.livePots()).toEqual([100 + 100 + 20, 200]);
  });

  it('splits a tied pot and gives the odd chip left of the dealer', () => {
    // Rig the deck: both players get the board as best hand.
    const t = new HoldemTable([{ id: 'a', chips: 101 }, { id: 'b', chips: 100 }, { id: 'c', chips: 100 }], { sb: 1, bb: 2 }, rng(8));
    t.startHand();
    // Deck pops from the end: burn, flop×3, burn, turn, burn, river. The board is a royal flush for everyone.
    (t as unknown as { deck: Card[] }).deck = cards('Ts 8d Js 8c Qs Ks As 8h');
    t.seats[0]!.hole = cards('2c 3d');
    t.seats[2]!.hole = cards('4h 2d');
    t.act('a', { type: 'call' });
    t.act('b', { type: 'fold' });
    t.act('c', { type: 'check' });
    expect(t.board.map((c) => c.r)).toEqual([14, 13, 12]);
    while (t.street !== 'done') t.act(t.currentId!, { type: 'check' });
    const r = t.lastResult!;
    expect(r.pots[0]!.winners.sort()).toEqual(['a', 'c']);
    // pot = 2 + 2 + 1 = 5 → 3 to c (first left of dealer a), 2 to a
    expect(t.seat('c')!.chips).toBe(101);
    expect(t.seat('a')!.chips).toBe(101);
  });

  it('forceFold of an absent player ends the hand when one remains', () => {
    const t = new HoldemTable([{ id: 'a', chips: 100 }, { id: 'b', chips: 100 }], { sb: 1, bb: 2 }, rng(9));
    t.startHand();
    t.forceFold('b'); // not b's turn (a acts first heads-up)
    expect(t.street).toBe('done');
    expect(t.seat('a')!.chips).toBe(102);
  });
});

describe('fuzz', () => {
  it('random play never creates or loses chips and always progresses', () => {
    const r = rng(12345);
    for (let game = 0; game < 60; game++) {
      const n = 2 + Math.floor(r() * 7);
      const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, chips: 50 + Math.floor(r() * 500) }));
      const total = players.reduce((s, p) => s + p.chips, 0);
      const t = new HoldemTable(players, { sb: 5, bb: 10 }, r);
      for (let hand = 0; hand < 40 && t.withChips().length >= 2; hand++) {
        t.startHand();
        let steps = 0;
        while (t.street !== 'done') {
          expect(++steps).toBeLessThan(200);
          const id = t.currentId!;
          const l = t.legal(id)!;
          const x = r();
          if (x < 0.15) t.act(id, { type: 'fold' });
          else if (x < 0.5) expect(t.act(id, l.check ? { type: 'check' } : { type: 'call' }).ok).toBe(true);
          else if (x < 0.85 && l.canRaise) expect(t.act(id, { type: 'raise', to: l.minRaiseTo + Math.floor(r() * (l.maxRaiseTo - l.minRaiseTo + 1)) }).ok).toBe(true);
          else if (l.canRaise) t.act(id, { type: 'allin' });
          else t.act(id, l.check ? { type: 'check' } : { type: 'call' });
          for (const s of t.seats) expect(s.chips).toBeGreaterThanOrEqual(0);
          expect(t.seats.reduce((s, x) => s + x.chips + x.total, 0)).toBe(total);
        }
        expect(t.seats.reduce((s, x) => s + x.chips, 0)).toBe(total);
        const net = t.lastResult!.net;
        expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
      }
    }
  });
});
