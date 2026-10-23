import { describe, expect, it } from 'vitest';
import { CONTROLLER_LIMITS, ConnectionGate, ControllerSession } from '../../src/core/controller-session';
import { HOST_AUTH_TIMEOUT_MS, HostSession } from '../../src/core/host-session';
import { silentLogger } from '../../src/core/logger';
import { randomInt, randomRoomCode, randomToken, safeEqual, uuid } from '../../src/core/random';
import { Room, type Clock } from '../../src/core/room';
import { buildRoomInfo } from '../../src/core/room-info';
import type { TextTransport } from '../../src/core/transport';

class FakeTransport implements TextTransport {
  sent: { type: string; [k: string]: unknown }[] = [];
  closed: { code: number; reason: string } | null = null;
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  last(type: string) {
    return [...this.sent].reverse().find((m) => m.type === type);
  }
}

class FakeClock implements Clock {
  t = 0;
  timers: { at: number; fn: () => void; id: number }[] = [];
  seq = 0;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    this.timers.push({ at: this.t + ms, fn, id: ++this.seq });
    return this.seq;
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

describe('random (Web Crypto)', () => {
  it('produces well-formed values', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(new Set(Array.from({ length: 50 }, () => randomToken())).size).toBe(50);
  });
  it('randomInt stays in range and covers it', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = randomInt(32);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(32);
      seen.add(v);
    }
    expect(seen.size).toBe(32);
    expect(() => randomInt(0)).toThrow();
  });
  it('safeEqual compares correctly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('ConnectionGate', () => {
  it('limits connections per IP and releases them', () => {
    const gate = new ConnectionGate();
    for (let i = 0; i < CONTROLLER_LIMITS.maxConnectionsPerIp; i++) expect(gate.admit('1.1.1.1')).toBe(true);
    expect(gate.admit('1.1.1.1')).toBe(false);
    gate.release('1.1.1.1');
    expect(gate.admit('1.1.1.1')).toBe(true);
  });
});

describe('ControllerSession', () => {
  const setup = () => {
    const clock = new FakeClock();
    const room = new Room({ logger: silentLogger, clock });
    const gate = new ConnectionGate(clock);
    const t = new FakeTransport();
    gate.admit('10.0.0.9');
    const session = new ControllerSession(room, t, '10.0.0.9', gate, clock);
    return { clock, room, gate, t, session };
  };

  it('joins, relays input and disconnects on close', () => {
    const { room, t, session } = setup();
    session.handleText(JSON.stringify({ type: 'input', input: { kind: 'button', id: 'ok', pressed: true } }));
    expect(t.last('error')?.code).toBe('not_joined');
    session.handleText(JSON.stringify({ type: 'join', room: room.code, nickname: 'Noa', avatar: 0 }));
    expect(t.last('welcome')?.nickname).toBe('Noa');
    session.handleClose();
    expect(room.playerInfos()[0]?.connected).toBe(false);
  });

  it('rejects binary/garbage and closes after too many invalid messages', () => {
    const { t, session } = setup();
    session.handleText(null);
    session.handleText('{not json');
    expect(t.sent.filter((m) => m.code === 'invalid')).toHaveLength(2);
    for (let i = 0; i < CONTROLLER_LIMITS.maxInvalidMessages; i++) session.handleText('x');
    expect(t.closed?.code).toBe(1008);
  });

  it('blocks an IP after repeated wrong room codes', () => {
    const { room, gate, t, session } = setup();
    const wrong = room.code === 'AAAA' ? 'BBBB' : 'AAAA';
    for (let i = 0; i < CONTROLLER_LIMITS.joinFailures; i++) session.handleText(JSON.stringify({ type: 'join', room: wrong, nickname: 'x', avatar: 0 }));
    expect(gate.joinLimiter.isBlocked('10.0.0.9')).toBe(true);
    session.handleText(JSON.stringify({ type: 'join', room: room.code, nickname: 'x', avatar: 0 }));
    expect(t.closed?.code).toBe(4029);
  });

  it('enforces the message budget', () => {
    const { t, session } = setup();
    for (let i = 0; i < 200; i++) session.handleText(JSON.stringify({ type: 'ping', t: i }));
    expect(t.sent.filter((m) => m.type === 'pong').length).toBe(120);
    expect(t.last('error')?.code).toBe('rate_limited');
  });
});

describe('HostSession', () => {
  const secret = 'S'.repeat(32);
  it('requires auth within the timeout', () => {
    const clock = new FakeClock();
    const t = new FakeTransport();
    new HostSession(new Room({ logger: silentLogger, clock }), t, secret, () => {}, clock);
    clock.advance(HOST_AUTH_TIMEOUT_MS + 1);
    expect(t.closed?.code).toBe(4401);
  });
  it('rejects a wrong secret and accepts the right one, refreshing room info on new_code', () => {
    const clock = new FakeClock();
    const room = new Room({ logger: silentLogger, clock });
    const bad = new FakeTransport();
    new HostSession(room, bad, secret, () => {}, clock).handleText(JSON.stringify({ type: 'auth', secret: 'X'.repeat(32) }));
    expect(bad.closed?.code).toBe(4401);
    expect(room.hostOnline).toBe(false);

    const t = new FakeTransport();
    let infos = 0;
    const s = new HostSession(room, t, secret, () => infos++, clock);
    s.handleText(JSON.stringify({ type: 'auth', secret }));
    expect(room.hostOnline).toBe(true);
    expect(infos).toBe(1);
    s.handleText(JSON.stringify({ type: 'new_code' }));
    expect(infos).toBe(2);
    clock.advance(HOST_AUTH_TIMEOUT_MS + 1);
    expect(t.closed).toBeNull();
    s.handleClose();
    expect(room.hostOnline).toBe(false);
  });
});

describe('buildRoomInfo', () => {
  it('builds the join URL and an SVG QR code', async () => {
    const room = new Room({ logger: silentLogger });
    const info = await buildRoomInfo(room, ['192.168.1.5', '10.0.0.2'], 8080);
    expect(info.joinUrl).toBe(`http://192.168.1.5:8080/c?r=${room.code}`);
    expect(info.urls).toEqual(['http://192.168.1.5:8080/c', 'http://10.0.0.2:8080/c']);
    expect(info.qrSvg.startsWith('<svg')).toBe(true);
  });
});
