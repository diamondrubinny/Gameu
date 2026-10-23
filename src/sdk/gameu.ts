/**
 * Gameu Game SDK — runs inside the sandboxed game iframe and talks to the TV host via postMessage.
 * The host validates every message; games never get network access.
 */
import type { ControllerLayout, GamePlayer, HostToGame, Input, Settings } from '../shared/protocol';

export type { ControllerLayout, GamePlayer, Input, Settings };

export interface GameContext {
  players: GamePlayer[];
  settings: Settings;
}

type Target = 'all' | string;

export interface GameuSdk {
  /** Called once with the initial players and console settings. */
  onInit(cb: (ctx: GameContext) => void): void;
  onInput(cb: (playerId: string, input: Input) => void): void;
  /** Called whenever players join, leave, reconnect or disconnect. */
  onPlayers(cb: (players: GamePlayer[]) => void): void;
  setLayout(layout: ControllerLayout, target?: Target): void;
  haptic(pattern: number[], target?: Target): void;
  /** Ends the game; the console shows the results and returns to the menu. */
  end(results: { playerId: string; score: number }[]): void;
  readonly players: GamePlayer[];
  readonly settings: Settings | null;
  /** Picks the string for the console language. */
  t(he: string, en: string): string;
}

export function createSdk(win: Window = window): GameuSdk {
  const parent = win.parent;
  let players: GamePlayer[] = [];
  let settings: Settings | null = null;
  const initCbs: ((ctx: GameContext) => void)[] = [];
  const inputCbs: ((id: string, input: Input) => void)[] = [];
  const playerCbs: ((p: GamePlayer[]) => void)[] = [];
  let initialized = false;
  let ended = false;

  // Origin is opaque inside the sandbox, so '*' is required. Only the parent window is trusted.
  const post = (msg: object) => parent.postMessage({ gameu: 1, ...msg }, '*');

  win.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== parent) return;
    const msg = ev.data as HostToGame;
    if (!msg || msg.gameu !== 1) return;
    switch (msg.type) {
      case 'init':
        players = msg.players;
        settings = msg.settings;
        if (!initialized) {
          initialized = true;
          for (const cb of initCbs) cb({ players, settings });
        }
        break;
      case 'players':
        players = msg.players;
        for (const cb of playerCbs) cb(players);
        break;
      case 'input':
        if (!ended) for (const cb of inputCbs) cb(msg.playerId, msg.input);
        break;
    }
  });

  const sdk: GameuSdk = {
    onInit(cb) {
      initCbs.push(cb);
      if (initialized && settings) cb({ players, settings });
    },
    onInput(cb) {
      inputCbs.push(cb);
    },
    onPlayers(cb) {
      playerCbs.push(cb);
    },
    setLayout(layout, target = 'all') {
      post({ type: 'layout', target, layout });
    },
    haptic(pattern, target = 'all') {
      post({ type: 'haptic', target, pattern });
    },
    end(results) {
      if (ended) return;
      ended = true;
      post({ type: 'end', results: results.map((r) => ({ playerId: r.playerId, score: Math.round(r.score) })) });
    },
    get players() {
      return players;
    },
    get settings() {
      return settings;
    },
    t(he, en) {
      return settings?.language === 'en' ? en : he;
    },
  };

  // Announce readiness after the current task so games can register callbacks first.
  setTimeout(() => post({ type: 'ready' }), 0);
  return sdk;
}
