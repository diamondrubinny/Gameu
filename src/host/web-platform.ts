import { DEFAULT_SETTINGS, type GameManifest, type HostToServer, type Settings } from '../shared/protocol';
import { HostConnection } from './connection';
import type { HostPlatform } from './platform';

/** TV screen in a browser, served by the Node console server (USB / computer mode). */
export class WebHostPlatform implements HostPlatform {
  private conn: HostConnection | null = null;

  async start(onMessage: Parameters<HostPlatform['start']>[0], onState: Parameters<HostPlatform['start']>[1]): Promise<void> {
    this.conn = new HostConnection(onMessage, onState);
    await this.conn.start();
  }

  send(msg: HostToServer): void {
    this.conn?.send(msg);
  }

  async loadSettings(): Promise<Settings> {
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      return ((await res.json()) as { settings: Settings }).settings;
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings | null> {
    const secret = this.conn?.hostSecret;
    if (!secret) return null;
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Gameu-Host': secret },
        body: JSON.stringify(patch),
      });
      return res.ok ? ((await res.json()) as { settings: Settings }).settings : null;
    } catch {
      return null;
    }
  }

  async loadGames(): Promise<GameManifest[]> {
    try {
      const res = await fetch('/api/games', { cache: 'no-store' });
      return ((await res.json()) as { games: GameManifest[] }).games;
    } catch {
      return [];
    }
  }
}
