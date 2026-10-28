import {
  ControllerLayoutSchema,
  LIMITS,
  type ControllerToServerMsg,
  type ErrorCode,
  type HostToServerMsg,
  type Input,
  type ParsedLayout,
  type PlayerInfo,
  type ServerToController,
  type ServerToHost,
} from '../shared/protocol';
import type { Lang } from '../shared/i18n';
import type { Logger } from './logger';
import { TokenBucket } from './rate-limit';
import { randomRoomCode, randomToken, safeEqual, uuid } from './random';

/** Transport-agnostic connection (a WebSocket in production, a fake in tests). */
export interface Peer<T> {
  send(msg: T): void;
  close(code: number, reason: string): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface Player {
  id: string;
  nickname: string;
  avatar: number;
  lang: Lang;
  reconnectToken: string;
  peer: Peer<ServerToController> | null;
  joinedAt: number;
  removalTimer: unknown;
  layout: ParsedLayout;
}

export interface RoomOptions {
  clock?: Clock;
  logger: Logger;
  /** How long a disconnected player keeps their slot. */
  reconnectGraceMs?: number;
}

const MENU_LAYOUT: ParsedLayout = ControllerLayoutSchema.parse({ type: 'menu' });
const WAITING_FOR_HOST: ParsedLayout = { type: 'message', text: 'host_offline' };

/**
 * One console = one room. Holds players, relays controller input to the TV host
 * and layouts/haptics from the host to controllers. All inputs arrive pre-validated.
 */
export class Room {
  code: string = randomRoomCode();
  locked = false;
  private host: Peer<ServerToHost> | null = null;
  private readonly players = new Map<string, Player>();
  private adminId: string | null = null;
  private defaultLayout: ParsedLayout = MENU_LAYOUT;
  private readonly clock: Clock;
  private readonly grace: number;
  private readonly log: Logger;

  constructor(opts: RoomOptions) {
    this.clock = opts.clock ?? realClock;
    this.grace = opts.reconnectGraceMs ?? 120_000;
    this.log = opts.logger;
  }

  // ---------------- host ----------------

  get hostOnline(): boolean {
    return this.host !== null;
  }

  /** A newer host connection (e.g. page reload) replaces the old one. */
  attachHost(peer: Peer<ServerToHost>): void {
    if (this.host && this.host !== peer) {
      this.host.send({ type: 'error', code: 'replaced' });
      this.host.close(4001, 'replaced');
    }
    this.host = peer;
    this.log.info('host_attached');
    this.broadcast({ type: 'host_status', online: true });
    for (const p of this.players.values()) p.peer?.send({ type: 'layout', layout: p.layout });
    this.emitPlayers();
  }

  detachHost(peer: Peer<ServerToHost>): void {
    if (this.host !== peer) return;
    this.host = null;
    this.log.info('host_detached');
    this.broadcast({ type: 'host_status', online: false });
    this.broadcast({ type: 'layout', layout: WAITING_FOR_HOST });
  }

  handleHostMessage(msg: Exclude<HostToServerMsg, { type: 'auth' }>): void {
    switch (msg.type) {
      case 'layout': {
        const layout = msg.layout;
        for (const p of this.targets(msg.target)) {
          p.layout = layout;
          p.peer?.send({ type: 'layout', layout });
        }
        if (msg.target === 'all') this.defaultLayout = layout;
        break;
      }
      case 'haptic':
        for (const p of this.targets(msg.target)) p.peer?.send({ type: 'haptic', pattern: msg.pattern });
        break;
      case 'kick':
        this.kick(msg.playerId);
        break;
      case 'lock':
        this.locked = msg.locked;
        this.log.info('room_lock', { locked: msg.locked });
        break;
      case 'new_code':
        this.code = randomRoomCode();
        this.log.info('room_code_rotated');
        break;
    }
  }

  // ---------------- controllers ----------------

  /** Returns the player id on success, or an error code. */
  join(peer: Peer<ServerToController>, msg: Extract<ControllerToServerMsg, { type: 'join' }>): { ok: true; playerId: string } | { ok: false; code: ErrorCode } {
    // Reconnect: the reconnect token alone identifies the slot, even if the room code rotated.
    if (msg.reconnectToken) {
      for (const p of this.players.values()) {
        if (safeEqual(p.reconnectToken, msg.reconnectToken)) {
          if (p.peer && p.peer !== peer) {
            p.peer.send({ type: 'error', code: 'replaced' });
            p.peer.close(4002, 'replaced');
          }
          if (p.removalTimer !== null) this.clock.clearTimeout(p.removalTimer);
          p.removalTimer = null;
          p.peer = peer;
          if (msg.lang) p.lang = msg.lang; // the player may have switched language on the phone
          if (this.adminId === null) this.adminId = p.id;
          this.welcome(p);
          this.log.info('player_reconnected', { playerId: p.id });
          this.emitPlayers();
          return { ok: true, playerId: p.id };
        }
      }
    }

    if (msg.room !== this.code) return { ok: false, code: 'bad_room' };
    if (this.locked) return { ok: false, code: 'room_locked' };
    if (this.players.size >= LIMITS.maxPlayers) return { ok: false, code: 'room_full' };

    const player: Player = {
      id: uuid(),
      nickname: this.uniqueNickname(msg.nickname),
      avatar: msg.avatar,
      lang: msg.lang ?? 'he',
      reconnectToken: randomToken(),
      peer,
      joinedAt: this.clock.now(),
      removalTimer: null,
      layout: this.host ? this.defaultLayout : WAITING_FOR_HOST,
    };
    this.players.set(player.id, player);
    if (this.adminId === null) this.adminId = player.id;
    this.welcome(player);
    this.log.info('player_joined', { playerId: player.id, count: this.players.size });
    this.emitPlayers();
    return { ok: true, playerId: player.id };
  }

  handleInput(playerId: string, input: Input): void {
    const p = this.players.get(playerId);
    if (!p || !p.peer) return;
    this.host?.send({ type: 'input', playerId, input });
  }

  setLang(playerId: string, lang: Lang): void {
    const p = this.players.get(playerId);
    if (!p || p.lang === lang) return;
    p.lang = lang;
    this.emitPlayers();
  }

  disconnect(playerId: string, peer: Peer<ServerToController>): void {
    const p = this.players.get(playerId);
    if (!p || p.peer !== peer) return; // stale socket after a reconnect
    p.peer = null;
    p.removalTimer = this.clock.setTimeout(() => this.remove(playerId), this.grace);
    if (this.adminId === playerId) this.reassignAdmin();
    this.log.info('player_disconnected', { playerId });
    this.emitPlayers();
  }

  playerInfos(): PlayerInfo[] {
    return [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, isAdmin: p.id === this.adminId, connected: p.peer !== null, lang: p.lang }));
  }

  // ---------------- internals ----------------

  private kick(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.peer?.send({ type: 'error', code: 'kicked' });
    p.peer?.close(4003, 'kicked');
    p.peer = null;
    this.remove(playerId);
    this.log.info('player_kicked', { playerId });
  }

  private remove(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.removalTimer !== null) this.clock.clearTimeout(p.removalTimer);
    this.players.delete(playerId);
    if (this.adminId === playerId) this.reassignAdmin();
    this.emitPlayers();
  }

  private reassignAdmin(): void {
    const previous = this.adminId;
    const next = [...this.players.values()].filter((p) => p.peer).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    this.adminId = next?.id ?? null;
    if (previous && previous !== this.adminId) this.players.get(previous)?.peer?.send({ type: 'admin', isAdmin: false });
    if (next && next.id !== previous) next.peer?.send({ type: 'admin', isAdmin: true });
  }

  private welcome(p: Player): void {
    p.peer?.send({
      type: 'welcome',
      playerId: p.id,
      reconnectToken: p.reconnectToken,
      nickname: p.nickname,
      avatar: p.avatar,
      isAdmin: p.id === this.adminId,
    });
    p.peer?.send({ type: 'host_status', online: this.hostOnline });
    p.peer?.send({ type: 'layout', layout: this.host ? p.layout : WAITING_FOR_HOST });
  }

  private uniqueNickname(base: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.nickname.toLocaleLowerCase()));
    if (!taken.has(base.toLocaleLowerCase())) return base;
    for (let i = 2; i <= LIMITS.maxPlayers + 1; i++) {
      const candidate = `${base.slice(0, LIMITS.nicknameMax - 3)} ${i}`;
      if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return base;
  }

  private targets(target: string): Player[] {
    if (target === 'all') return [...this.players.values()];
    const p = this.players.get(target);
    return p ? [p] : [];
  }

  private broadcast(msg: ServerToController): void {
    for (const p of this.players.values()) p.peer?.send(msg);
  }

  private emitPlayers(): void {
    this.host?.send({ type: 'players', players: this.playerInfos() });
  }
}

/** Per-connection message budget: stick input at ~30Hz plus bursts. */
export function createMessageBudget(clock: Clock = realClock): TokenBucket {
  return new TokenBucket(120, 60, () => clock.now());
}
