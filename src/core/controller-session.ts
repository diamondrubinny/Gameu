import { ControllerToServerSchema, type ServerToController } from '../shared/protocol';
import { FailureLimiter } from './rate-limit';
import { createMessageBudget, realClock, type Clock, type Peer, type Room } from './room';
import type { TextTransport } from './transport';

export const CONTROLLER_LIMITS = {
  maxConnectionsPerIp: 6,
  maxConnections: 32,
  maxInvalidMessages: 20,
  /** Failed joins (wrong room code) before an IP is blocked. */
  joinFailures: 8,
  joinWindowMs: 60_000,
  joinBlockMs: 60_000,
} as const;

/** Admission control for controller connections, shared by all transports. */
export class ConnectionGate {
  private readonly perIp = new Map<string, number>();
  readonly joinLimiter: FailureLimiter;

  constructor(clock: Clock = realClock) {
    this.joinLimiter = new FailureLimiter(CONTROLLER_LIMITS.joinFailures, CONTROLLER_LIMITS.joinWindowMs, CONTROLLER_LIMITS.joinBlockMs, () => clock.now());
  }

  /** Reserves a slot for `ip`; returns false if the connection must be refused (HTTP 429). */
  admit(ip: string): boolean {
    const count = this.perIp.get(ip) ?? 0;
    if (count >= CONTROLLER_LIMITS.maxConnectionsPerIp || this.total() >= CONTROLLER_LIMITS.maxConnections) return false;
    if (this.joinLimiter.isBlocked(ip)) return false;
    this.perIp.set(ip, count + 1);
    return true;
  }

  release(ip: string): void {
    const n = (this.perIp.get(ip) ?? 1) - 1;
    if (n <= 0) this.perIp.delete(ip);
    else this.perIp.set(ip, n);
  }

  private total(): number {
    let n = 0;
    for (const v of this.perIp.values()) n += v;
    return n;
  }
}

/**
 * One phone connection: validates every message, enforces the message budget,
 * joins the room and relays input. Transport-agnostic.
 */
export class ControllerSession {
  readonly peer: Peer<ServerToController>;
  private playerId: string | null = null;
  private invalid = 0;
  private lastRateNotice = -Infinity;
  private readonly budget;
  private closed = false;

  constructor(
    private readonly room: Room,
    private readonly transport: TextTransport,
    private readonly ip: string,
    private readonly gate: ConnectionGate,
    private readonly clock: Clock = realClock,
  ) {
    this.budget = createMessageBudget(clock);
    this.peer = {
      send: (msg) => {
        if (!this.closed) transport.send(JSON.stringify(msg));
      },
      close: (code, reason) => transport.close(code, reason),
    };
  }

  /** `text` is null for binary frames, which are always invalid. */
  handleText(text: string | null): void {
    if (!this.budget.take()) {
      const t = this.clock.now();
      if (t - this.lastRateNotice > 1000) {
        this.peer.send({ type: 'error', code: 'rate_limited' });
        this.lastRateNotice = t;
      }
      return;
    }
    let parsed: unknown = null;
    if (text !== null) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }
    const result = parsed === null ? null : ControllerToServerSchema.safeParse(parsed);
    if (!result || !result.success) {
      this.invalid += 1;
      this.peer.send({ type: 'error', code: 'invalid' });
      if (this.invalid > CONTROLLER_LIMITS.maxInvalidMessages) this.transport.close(1008, 'too many invalid messages');
      return;
    }
    const msg = result.data;
    switch (msg.type) {
      case 'ping':
        this.peer.send({ type: 'pong', t: msg.t });
        return;
      case 'join': {
        if (this.playerId) return;
        if (this.gate.joinLimiter.isBlocked(this.ip)) {
          this.peer.send({ type: 'error', code: 'rate_limited' });
          this.transport.close(4029, 'rate limited');
          return;
        }
        const out = this.room.join(this.peer, msg);
        if (out.ok) {
          this.playerId = out.playerId;
        } else {
          if (out.code === 'bad_room') this.gate.joinLimiter.fail(this.ip);
          this.peer.send({ type: 'error', code: out.code });
        }
        return;
      }
      case 'lang':
        if (this.playerId) this.room.setLang(this.playerId, msg.lang);
        return;
      case 'input':
        if (!this.playerId) {
          this.peer.send({ type: 'error', code: 'not_joined' });
          return;
        }
        this.room.handleInput(this.playerId, msg.input);
        return;
    }
  }

  handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.gate.release(this.ip);
    if (this.playerId) this.room.disconnect(this.playerId, this.peer);
  }
}
