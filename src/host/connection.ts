import type { HostToServer, ServerToHost } from '../shared/protocol';
import type { HostConnectionState } from './platform';

/**
 * TV-side connection: obtains the per-run host secret (loopback or host key only),
 * authenticates over WebSocket and reconnects with backoff.
 */
export class HostConnection {
  private ws: WebSocket | null = null;
  private secret: string | null = null;
  private retry = 0;
  private stopped = false;

  constructor(
    private readonly onMessage: (msg: ServerToHost) => void,
    private readonly onState: (s: HostConnectionState) => void,
  ) {}

  get hostSecret(): string | null {
    return this.secret;
  }

  /** Optional host key from `/?key=` (remote TV browser mode). Removed from the address bar after reading. */
  private hostKey(): string | null {
    const url = new URL(location.href);
    const key = url.searchParams.get('key');
    if (key) {
      try {
        sessionStorage.setItem('gameu.hostKey', key);
      } catch {
        /* ignore */
      }
      url.searchParams.delete('key');
      history.replaceState(null, '', url.pathname + url.search);
      return key;
    }
    try {
      return sessionStorage.getItem('gameu.hostKey');
    } catch {
      return null;
    }
  }

  async start(): Promise<void> {
    this.onState('connecting');
    try {
      const key = this.hostKey();
      const res = await fetch('/api/host-session', { headers: key ? { 'X-Gameu-Key': key } : {}, cache: 'no-store' });
      if (res.status === 403) {
        this.stopped = true;
        this.onState('forbidden');
        return;
      }
      const body = (await res.json()) as { secret: string };
      this.secret = body.secret;
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.connect();
  }

  send(msg: HostToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/host`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      ws.send(JSON.stringify({ type: 'auth', secret: this.secret ?? '' } satisfies HostToServer));
      this.onState('open');
    });
    ws.addEventListener('message', (ev) => {
      try {
        this.onMessage(JSON.parse(String(ev.data)) as ServerToHost);
      } catch {
        /* ignore malformed */
      }
    });
    ws.addEventListener('close', (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev.code === 4001) {
        this.stopped = true;
        this.onState('replaced');
        return;
      }
      if (ev.code === 4401) {
        // Server restarted with a new secret: fetch it again.
        this.secret = null;
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.onState('connecting');
    const delay = Math.min(5000, 500 * 2 ** this.retry++);
    setTimeout(() => {
      if (this.secret) this.connect();
      else void this.start();
    }, delay);
  }
}
