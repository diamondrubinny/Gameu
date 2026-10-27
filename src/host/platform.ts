import type { GameManifest, HostToServer, ServerToHost, Settings } from '../shared/protocol';

/** 'unavailable': the console runs but phones cannot connect (e.g. the TV app's phone server failed). */
export type HostConnectionState = 'connecting' | 'open' | 'forbidden' | 'replaced' | 'unavailable';

/**
 * Where the TV screen runs. The same UI works in a browser talking to the
 * Node server (computer / USB) and inside the Android TV app (in-process room).
 */
export interface HostPlatform {
  start(onMessage: (msg: ServerToHost) => void, onState: (s: HostConnectionState) => void): Promise<void>;
  send(msg: HostToServer): void;
  loadSettings(): Promise<Settings>;
  /** Persists a settings patch; returns the stored settings, or null if not persisted. */
  saveSettings(patch: Partial<Settings>): Promise<Settings | null>;
  loadGames(): Promise<GameManifest[]>;
  /** Present when the console runs as an app that can be closed (Android TV). */
  exitApp?(): void;
  /** App version shown in settings, when known. */
  readonly appVersion?: string;
}
