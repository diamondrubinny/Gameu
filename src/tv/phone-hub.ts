import { ConnectionGate, ControllerSession } from '../core/controller-session';
import type { Room } from '../core/room';
import type { NativeBridge, NativeToJs } from './bridge';

/** Close code when the page refuses a connection (too many from one IP / blocked). */
const TRY_AGAIN_LATER = 1013;

/**
 * Turns native socket events into ControllerSessions — the same validated,
 * rate-limited code path the Node server uses for WebSockets.
 */
export class PhoneHub {
  private readonly sessions = new Map<number, ControllerSession>();
  private readonly gate = new ConnectionGate();

  constructor(
    private readonly room: Room,
    private readonly bridge: NativeBridge,
  ) {
    bridge.onMessage((msg) => this.onNative(msg));
  }

  get size(): number {
    return this.sessions.size;
  }

  private onNative(msg: NativeToJs): void {
    switch (msg.t) {
      case 'open': {
        if (this.sessions.has(msg.id)) return;
        if (!this.gate.admit(msg.ip)) {
          this.bridge.post({ t: 'close', id: msg.id, code: TRY_AGAIN_LATER, reason: 'busy' });
          return;
        }
        const id = msg.id;
        const session = new ControllerSession(
          this.room,
          {
            send: (data) => this.bridge.post({ t: 'send', id, data }),
            close: (code, reason) => this.bridge.post({ t: 'close', id, code, reason }),
          },
          msg.ip,
          this.gate,
        );
        this.sessions.set(id, session);
        return;
      }
      case 'msg':
        this.sessions.get(msg.id)?.handleText(typeof msg.data === 'string' ? msg.data : null);
        return;
      case 'bad':
        this.sessions.get(msg.id)?.handleText(null);
        return;
      case 'closed': {
        const s = this.sessions.get(msg.id);
        if (!s) return;
        this.sessions.delete(msg.id);
        s.handleClose();
        return;
      }
      default:
        return;
    }
  }
}
