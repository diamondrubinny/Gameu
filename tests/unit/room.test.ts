import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerToController, ServerToHost } from '../../src/shared/protocol';
import { silentLogger } from '../../src/server/logger';
import { Room, type Clock, type Peer } from '../../src/server/room';

class FakePeer<T> implements Peer<T> {
  sent: T[] = [];
  closed: { code: number; reason: string } | null = null;
  send(msg: T) {
    this.sent.push(msg);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  last<K extends string>(type: K): Extract<T, { type: K }> | undefined {
    return [...this.sent].reverse().find((m) => (m as { type: string }).type === type) as Extract<T, { type: K }> | undefined;
  }
}

class FakeClock implements Clock {
  t = 0;
  timers: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(id: unknown) {
    this.timers = this.timers.filter((x) => x.id !== id);
  }
  advance(ms: number) {
    this.t += ms;
    const due = this.timers.filter((x) => x.at <= this.t);
    this.timers = this.timers.filter((x) => x.at > this.t);
    due.forEach((x) => x.fn());
  }
}

const join = (room: Room, peer: FakePeer<ServerToController>, nickname = 'Noa', extra: Partial<{ reconnectToken: string; room: string }> = {}) =>
  room.join(peer, { type: 'join', room: extra.room ?? room.code, nickname, avatar: 1, reconnectToken: extra.reconnectToken });

describe('Room', () => {
  let clock: FakeClock;
  let room: Room;
  let host: FakePeer<ServerToHost>;

  beforeEach(() => {
    clock = new FakeClock();
    room = new Room({ logger: silentLogger, clock, reconnectGraceMs: 1000 });
    host = new FakePeer();
    room.attachHost(host);
  });

  it('first player becomes admin and gets the default menu layout', () => {
    const p = new FakePeer<ServerToController>();
    const r = join(room, p);
    expect(r.ok).toBe(true);
    expect(p.last('welcome')?.isAdmin).toBe(true);
    expect(p.last('layout')?.layout.type).toBe('menu');
    expect(host.last('players')?.players).toHaveLength(1);
  });

  it('rejects a wrong room code, a locked room and a full room', () => {
    expect(join(room, new FakePeer(), 'x', { room: room.code === 'AAAA' ? 'BBBB' : 'AAAA' })).toEqual({ ok: false, code: 'bad_room' });
    room.handleHostMessage({ type: 'lock', locked: true });
    expect(join(room, new FakePeer())).toEqual({ ok: false, code: 'room_locked' });
    room.handleHostMessage({ type: 'lock', locked: false });
    for (let i = 0; i < 8; i++) expect(join(room, new FakePeer(), `p${i}`).ok).toBe(true);
    expect(join(room, new FakePeer(), 'p9')).toEqual({ ok: false, code: 'room_full' });
  });

  it('deduplicates nicknames', () => {
    const a = new FakePeer<ServerToController>();
    const b = new FakePeer<ServerToController>();
    join(room, a, 'Dan');
    join(room, b, 'dan');
    expect(b.last('welcome')?.nickname).toBe('dan 2');
  });

  it('relays input only from joined players to the host', () => {
    const p = new FakePeer<ServerToController>();
    const r = join(room, p);
    if (!r.ok) throw new Error('join failed');
    room.handleInput(r.playerId, { kind: 'button', id: 'ok', pressed: true });
    room.handleInput('not-a-player-id', { kind: 'button', id: 'ok', pressed: true });
    const inputs = host.sent.filter((m) => m.type === 'input');
    expect(inputs).toHaveLength(1);
  });

  it('keeps the slot during the grace period and restores it with the reconnect token', () => {
    const p1 = new FakePeer<ServerToController>();
    const r = join(room, p1);
    if (!r.ok) throw new Error('join failed');
    const token = p1.last('welcome')!.reconnectToken;
    room.disconnect(r.playerId, p1);
    expect(room.playerInfos()[0]?.connected).toBe(false);
    clock.advance(500);
    const p2 = new FakePeer<ServerToController>();
    // Reconnect works even after the room code changed.
    room.handleHostMessage({ type: 'new_code' });
    const r2 = join(room, p2, 'Noa', { reconnectToken: token, room: 'ZZZZ' });
    expect(r2).toEqual({ ok: true, playerId: r.playerId });
    expect(room.playerInfos()[0]?.connected).toBe(true);
    clock.advance(5000);
    expect(room.playerInfos()).toHaveLength(1); // removal timer was cancelled
  });

  it('removes a player after the grace period and hands admin to the next player', () => {
    const a = new FakePeer<ServerToController>();
    const b = new FakePeer<ServerToController>();
    const ra = join(room, a, 'A');
    clock.advance(10);
    join(room, b, 'B');
    if (!ra.ok) throw new Error();
    room.disconnect(ra.playerId, a);
    expect(b.last('admin')?.isAdmin).toBe(true);
    clock.advance(1000);
    expect(room.playerInfos().map((p) => p.nickname)).toEqual(['B']);
  });

  it('ignores a stale socket disconnect after reconnect', () => {
    const p1 = new FakePeer<ServerToController>();
    const r = join(room, p1);
    if (!r.ok) throw new Error();
    const token = p1.last('welcome')!.reconnectToken;
    const p2 = new FakePeer<ServerToController>();
    join(room, p2, 'Noa', { reconnectToken: token });
    expect(p1.closed?.code).toBe(4002);
    room.disconnect(r.playerId, p1);
    expect(room.playerInfos()[0]?.connected).toBe(true);
  });

  it('kicks a player', () => {
    const p = new FakePeer<ServerToController>();
    const r = join(room, p);
    if (!r.ok) throw new Error();
    room.handleHostMessage({ type: 'kick', playerId: r.playerId });
    expect(p.last('error')?.code).toBe('kicked');
    expect(p.closed?.code).toBe(4003);
    expect(room.playerInfos()).toHaveLength(0);
  });

  it('targets layouts and uses the last "all" layout for new joiners', () => {
    const a = new FakePeer<ServerToController>();
    const ra = join(room, a, 'A');
    if (!ra.ok) throw new Error();
    room.handleHostMessage({ type: 'layout', target: 'all', layout: { type: 'message', text: 'hi' } });
    room.handleHostMessage({ type: 'layout', target: ra.playerId, layout: { type: 'dpad', buttons: [] } });
    expect(a.last('layout')?.layout.type).toBe('dpad');
    const b = new FakePeer<ServerToController>();
    join(room, b, 'B');
    expect(b.last('layout')?.layout).toEqual({ type: 'message', text: 'hi' });
  });

  it('tells controllers when the host goes away and replaces an older host', () => {
    const p = new FakePeer<ServerToController>();
    join(room, p);
    room.detachHost(host);
    expect(p.last('host_status')?.online).toBe(false);
    expect(p.last('layout')?.layout).toEqual({ type: 'message', text: 'host_offline' });
    const h2 = new FakePeer<ServerToHost>();
    const h3 = new FakePeer<ServerToHost>();
    room.attachHost(h2);
    room.attachHost(h3);
    expect(h2.closed?.code).toBe(4001);
    expect(p.last('host_status')?.online).toBe(true);
  });
});
