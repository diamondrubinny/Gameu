import { HostToServerSchema, type HostToServerMsg, type ServerToHost } from '../shared/protocol';
import { safeEqual } from './random';
import { realClock, type Clock, type Peer, type Room } from './room';
import type { TextTransport } from './transport';

export const HOST_AUTH_TIMEOUT_MS = 5_000;

/**
 * TV-screen connection over a network transport: the first message must be
 * `auth` with the per-run secret. (The Android TV app uses an in-process host instead.)
 */
export class HostSession {
  readonly peer: Peer<ServerToHost>;
  private authed = false;
  private closed = false;
  private readonly timer: unknown;

  constructor(
    private readonly room: Room,
    private readonly transport: TextTransport,
    private readonly secret: string,
    /** Called after auth and after lock/new_code so the host gets fresh room info. */
    private readonly sendRoomInfo: (peer: Peer<ServerToHost>) => void,
    private readonly clock: Clock = realClock,
  ) {
    this.peer = {
      send: (msg) => {
        if (!this.closed) transport.send(JSON.stringify(msg));
      },
      close: (code, reason) => transport.close(code, reason),
    };
    this.timer = clock.setTimeout(() => {
      if (!this.authed) transport.close(4401, 'auth timeout');
    }, HOST_AUTH_TIMEOUT_MS);
  }

  handleText(text: string | null): void {
    let parsed: unknown = null;
    if (text !== null) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }
    const result = parsed === null ? null : HostToServerSchema.safeParse(parsed);
    if (!result || !result.success) {
      this.peer.send({ type: 'error', code: 'invalid' });
      if (!this.authed) this.transport.close(4400, 'invalid');
      return;
    }
    const msg = result.data;
    if (!this.authed) {
      if (msg.type !== 'auth' || !safeEqual(msg.secret, this.secret)) {
        this.peer.send({ type: 'error', code: 'unauthorized' });
        this.transport.close(4401, 'unauthorized');
        return;
      }
      this.authed = true;
      this.clock.clearTimeout(this.timer);
      this.room.attachHost(this.peer);
      this.sendRoomInfo(this.peer);
      return;
    }
    applyHostMessage(this.room, msg, () => this.sendRoomInfo(this.peer));
  }

  handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.clock.clearTimeout(this.timer);
    if (this.authed) this.room.detachHost(this.peer);
  }
}

/** Applies an already-validated host message; shared by network and in-process hosts. */
export function applyHostMessage(room: Room, msg: HostToServerMsg, refreshRoomInfo: () => void): void {
  if (msg.type === 'auth') return;
  room.handleHostMessage(msg);
  if (msg.type === 'new_code' || msg.type === 'lock') refreshRoomInfo();
}
