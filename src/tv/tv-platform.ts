import { applyHostMessage } from '../core/host-session';
import { silentLogger, type Logger } from '../core/logger';
import { Room, type Peer } from '../core/room';
import { buildRoomInfo } from '../core/room-info';
import {
  DEFAULT_SETTINGS,
  GameManifestSchema,
  HostToServerSchema,
  SettingsSchema,
  type GameManifest,
  type HostToServer,
  type ServerToHost,
  type Settings,
} from '../shared/protocol';
import type { HostConnectionState, HostPlatform } from '../host/platform';
import type { NativeBridge } from './bridge';
import { PhoneHub } from './phone-hub';

const SETTINGS_KEY = 'gameu.settings';
const INFO_TIMEOUT_MS = 3000;

/**
 * Android TV: the room lives in this page (in-process host, no network host channel).
 * Phones connect to the app's native server, which forwards their sockets to PhoneHub.
 */
export class TvHostPlatform implements HostPlatform {
  readonly room: Room;
  readonly phones: PhoneHub;
  private onMessage: (msg: ServerToHost) => void = () => {};
  private lanIps: string[] = [];
  private port = 8080;
  private readonly hostPeer: Peer<ServerToHost>;
  appVersion: string | undefined;
  private serverError = false;

  constructor(
    private readonly bridge: NativeBridge,
    logger: Logger = silentLogger,
  ) {
    this.room = new Room({ logger });
    this.phones = new PhoneHub(this.room, bridge);
    this.hostPeer = { send: (msg) => this.onMessage(msg), close: () => {} };
  }

  async start(onMessage: (msg: ServerToHost) => void, onState: (s: HostConnectionState) => void): Promise<void> {
    this.onMessage = onMessage;
    const firstInfo = new Promise<void>((resolve) => {
      this.bridge.onMessage((msg) => {
        if (msg.t !== 'info') return;
        this.lanIps = msg.lanIps;
        this.port = msg.port;
        // Phone server could not start (e.g. no free port): show the "connecting" banner instead of a dead QR.
        this.appVersion = msg.version;
        this.serverError = !!msg.serverError;
        if (this.room.hostOnline) onState(msg.serverError ? 'unavailable' : 'open');
        resolve();
        void this.refreshRoomInfo();
      });
      setTimeout(resolve, this.bridge.available ? INFO_TIMEOUT_MS : 0);
    });
    this.bridge.post({ t: 'hello' });
    await firstInfo;
    this.room.attachHost(this.hostPeer);
    onState(this.serverError ? 'unavailable' : 'open');
    await this.refreshRoomInfo();
  }

  exitApp(): void {
    this.bridge.post({ t: 'exit' });
  }

  send(msg: HostToServer): void {
    const parsed = HostToServerSchema.safeParse(msg);
    if (!parsed.success) return;
    applyHostMessage(this.room, parsed.data, () => void this.refreshRoomInfo());
  }

  async loadSettings(): Promise<Settings> {
    try {
      const parsed = SettingsSchema.safeParse(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'));
      return parsed.success ? parsed.data : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings | null> {
    const next = SettingsSchema.safeParse({ ...(await this.loadSettings()), ...patch });
    if (!next.success) return null;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next.data));
    } catch {
      return null;
    }
    return next.data;
  }

  /** Games are bundled in the APK; the index is generated at build time and validated here. */
  async loadGames(): Promise<GameManifest[]> {
    try {
      const res = await fetch('/games/index.json', { cache: 'no-store' });
      const raw = (await res.json()) as unknown[];
      return raw.flatMap((m) => {
        const r = GameManifestSchema.safeParse(m);
        return r.success ? [r.data] : [];
      });
    } catch {
      return [];
    }
  }

  private async refreshRoomInfo(): Promise<void> {
    if (!this.room.hostOnline) return;
    this.hostPeer.send(await buildRoomInfo(this.room, this.lanIps, this.port));
  }
}
