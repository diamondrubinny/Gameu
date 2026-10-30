import {
  AVATARS,
  DEFAULT_SETTINGS,
  GameToHostSchema,
  colorFor,
  type ControllerLayout,
  type GameManifest,
  type GamePlayer,
  type HostToGame,
  type Input,
  type PlayerInfo,
  type ServerToHost,
  type Settings,
} from '../shared/protocol';
import { $, clear, h } from '../ui/dom';
import type { HostConnectionState, HostPlatform } from './platform';
import { LANG_CODES, languageName, pick } from '../shared/i18n';
import { lang, setLang, t, tFor } from './i18n';
import { play, setMusic, setMusicEnabled, setVolume, sfx, unlockOnGesture } from './audio';
import { nextInDirection, type Direction } from './spatial';

type Action = Direction | 'ok' | 'back' | 'home';
type Screen = 'home' | 'settings' | 'game';

interface RoomInfo {
  code: string;
  urls: string[];
  joinUrl: string;
  qrSvg: string;
  locked: boolean;
}

interface Overlay {
  el: HTMLElement;
  handle(action: Action): void;
  close(): void;
}

const GAME_READY_TIMEOUT_MS = 10_000;
const RESULTS_AUTO_CLOSE_MS = 20_000;

export class HostApp {
  private readonly root = $('#app');
  private readonly live = $('#live');
  private readonly toastEl = $('#toast');
  private room: RoomInfo | null = null;
  private players: PlayerInfo[] = [];
  private games: GameManifest[] = [];
  private settings: Settings = DEFAULT_SETTINGS;
  private screen: Screen = 'home';
  private overlay: Overlay | null = null;
  private focusMemory = new Map<Screen, string>();
  private game: { manifest: GameManifest; iframe: HTMLIFrameElement; ready: boolean; timer: number } | null = null;
  private toastTimer = 0;
  private connState: HostConnectionState = 'connecting';

  constructor(private readonly platform: HostPlatform) {
    window.addEventListener('keydown', (e) => this.onKey(e));
    unlockOnGesture();
    // Tab / screen-reader navigation moves DOM focus: the mark follows it.
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.matches('[data-nav]') && !el.classList.contains('nav-focus')) this.setFocus(el);
    });
    // Mouse/touch (e.g. a TV remote with a pointer) moves the selection mark too.
    document.addEventListener('pointerover', (e) => {
      const el = (e.target as Element | null)?.closest?.('[data-nav]');
      if (el instanceof HTMLElement && !el.hasAttribute('disabled')) this.setFocus(el);
    });
    window.addEventListener('message', (e) => this.onGameMessage(e));
  }

  async start(): Promise<void> {
    await Promise.all([this.loadSettings(), this.loadGames()]);
    this.render();
    await this.platform.start(
      (m) => this.onServer(m),
      (s) => this.onConnState(s),
    );
  }

  /**
   * Hardware Back (e.g. Android TV remote). Returns false when there is nothing
   * left to go back to, so the app may exit.
   */
  handleBack(): boolean {
    if (this.overlay) {
      this.overlay.handle('back');
      return true;
    }
    if (this.screen === 'game') {
      this.confirmExitGame();
      return true;
    }
    if (this.screen === 'settings') {
      this.go('home');
      return true;
    }
    if (!this.platform.exitApp) return false;
    // Home screen of the TV app: confirm before disconnecting everyone.
    const connected = this.players.filter((p) => p.connected).length;
    if (connected > 0) this.confirmExitApp(connected);
    else this.platform.exitApp();
    return true;
  }

  private confirmExitApp(connected: number): void {
    this.openOverlay((close) => {
      const no = h('button', { class: 'btn', 'data-nav': true }, t.exitAppNo);
      const yes = h('button', { class: 'btn danger', 'data-nav': true }, t.exitAppYes);
      no.addEventListener('click', close);
      yes.addEventListener('click', () => {
        close();
        this.platform.exitApp?.();
      });
      return {
        el: h(
          'div',
          { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'exit-app-title', 'aria-describedby': 'exit-app-body' },
          h('h2', { id: 'exit-app-title' }, t.exitAppTitle),
          h('p', { id: 'exit-app-body' }, t.exitAppBody(connected)),
          h('div', { class: 'actions' }, no, yes),
        ),
      };
    });
  }

  // ---------------- data ----------------

  private async loadSettings(): Promise<void> {
    this.applySettings(await this.platform.loadSettings());
    setMusic('menu');
  }

  private async loadGames(): Promise<void> {
    this.games = await this.platform.loadGames();
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    setLang(s.language);
    setVolume(s.volume);
    setMusicEnabled(s.music);
    const html = document.documentElement;
    html.style.setProperty('--text-scale', String(s.textScale));
    html.classList.toggle('high-contrast', s.highContrast);
    html.classList.toggle('reduce-motion', s.reduceMotion);
  }

  private async saveSettings(patch: Partial<Settings>): Promise<void> {
    this.applySettings({ ...this.settings, ...patch }); // optimistic
    const saved = await this.platform.saveSettings(patch);
    if (saved) this.applySettings(saved);
  }

  // ---------------- server events ----------------

  private onConnState(s: HostConnectionState): void {
    const changed = s !== this.connState;
    this.connState = s;
    if (s !== 'open' || (changed && this.screen !== 'game')) this.render();
  }

  private onServer(msg: ServerToHost): void {
    switch (msg.type) {
      case 'room':
        this.room = msg;
        if (this.screen !== 'game') this.render();
        break;
      case 'players': {
        const before = new Map(this.players.map((p) => [p.id, p]));
        this.players = msg.players;
        for (const p of msg.players) {
          const prev = before.get(p.id);
          if (!prev || (!prev.connected && p.connected)) {
            this.announce(t.joined(p.nickname));
            sfx.join();
          } else if (prev.connected && !p.connected) {
            this.announce(t.left(p.nickname));
          }
        }
        if (this.screen === 'game') this.postToGame({ gameu: 1, type: 'players', players: this.gamePlayers() });
        else {
          this.renderPlayers();
          this.renderCardMeta();
          this.renderHint();
          this.syncMenuLayouts();
        }
        break;
      }
      case 'input':
        this.onPlayerInput(msg.playerId, msg.input);
        break;
      case 'error':
        break;
    }
  }

  private get admin(): PlayerInfo | undefined {
    return this.players.find((p) => p.isAdmin);
  }

  private onPlayerInput(playerId: string, input: Input): void {
    const isAdmin = this.admin?.id === playerId;
    if (this.screen === 'game' && !this.overlay) {
      if (input.kind === 'button' && input.id === 'home' && input.pressed) {
        if (isAdmin) this.confirmExitGame();
        return;
      }
      this.postToGame({ gameu: 1, type: 'input', playerId, input });
      return;
    }
    if (!isAdmin || input.kind !== 'button' || !input.pressed) return;
    const action = input.id as Action;
    if (['up', 'down', 'left', 'right', 'ok', 'back', 'home'].includes(action)) this.dispatch(action);
  }

  private onKey(e: KeyboardEvent): void {
    const map: Record<string, Action> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Enter: 'ok',
      ' ': 'ok',
      Escape: 'back',
      Backspace: 'back',
      Home: 'home',
    };
    // TV remotes: older TV browsers report legacy key names / codes (webOS Back = 461, Tizen Back = 10009).
    const legacy: Record<number, Action> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 461: 'back', 10009: 'back', 8: 'back', 27: 'back' };
    const action = map[e.key] ?? map[{ Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Esc: 'Escape', XF86Back: 'Escape', GoBack: 'Escape', BrowserBack: 'Escape' }[e.key] ?? ''] ?? legacy[e.keyCode];
    if (!action) return;
    if (this.screen === 'game' && !this.overlay) {
      if (action === 'back' || action === 'home') {
        e.preventDefault();
        this.confirmExitGame();
      }
      return;
    }
    e.preventDefault();
    this.dispatch(action);
  }

  // ---------------- navigation ----------------

  private dispatch(action: Action): void {
    if (this.overlay) {
      this.overlay.handle(action);
      return;
    }
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.moveFocus(action, this.root);
        break;
      case 'ok':
        this.activate(this.root);
        break;
      case 'back':
      case 'home':
        if (this.screen === 'settings') {
          sfx.back();
          this.go('home');
        }
        break;
    }
  }

  /**
   * The selected item is tracked with a class, not only DOM focus: CSS :focus is not painted
   * while the TV window itself is unfocused (kiosk browser, Android WebView, after a game iframe),
   * which made the highlight disappear even though navigation worked.
   */
  private current(scope: HTMLElement): HTMLElement | null {
    const marked = scope.querySelector<HTMLElement>('[data-nav].nav-focus');
    if (marked && !marked.hasAttribute('disabled')) return marked;
    const active = document.activeElement;
    return active instanceof HTMLElement && active.matches('[data-nav]') && scope.contains(active) ? active : null;
  }

  private setFocus(el: HTMLElement): void {
    for (const old of document.querySelectorAll('.nav-focus')) if (old !== el) old.classList.remove('nav-focus');
    el.classList.add('nav-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (el.dataset.id && this.root.contains(el)) this.focusMemory.set(this.screen, el.dataset.id);
  }

  private navItems(scope: HTMLElement): HTMLElement[] {
    return [...scope.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])')];
  }

  private moveFocus(dir: Direction, scope: HTMLElement): void {
    const from = this.current(scope);
    const next = nextInDirection(from, dir, this.navItems(scope));
    if (next instanceof HTMLElement && next !== from) {
      sfx.move();
      this.setFocus(next);
    } else if (from) {
      // Edge of the screen: show that the press arrived.
      this.flash(from, 'nav-bump');
    }
  }

  /** OK: activates the selected item; with nothing selected, selects the first item instead. */
  private activate(scope: HTMLElement): void {
    const el = this.current(scope);
    if (!el) {
      const first = this.navItems(scope)[0];
      if (first) this.setFocus(first);
      return;
    }
    sfx.select();
    this.flash(el, 'nav-press');
    el.click();
  }

  private flash(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), 300);
  }

  private go(screen: Screen): void {
    const cur = this.current(this.root);
    if (cur?.dataset.id) this.focusMemory.set(this.screen, cur.dataset.id);
    this.screen = screen;
    this.render();
  }

  private restoreFocus(): void {
    if (this.overlay) return;
    const id = this.focusMemory.get(this.screen);
    const target = (id && this.root.querySelector<HTMLElement>(`[data-nav][data-id="${CSS.escape(id)}"]`)) || this.root.querySelector<HTMLElement>('[data-nav]');
    if (target) this.setFocus(target);
  }

  // ---------------- controller layouts ----------------

  private sendLayout(layout: ControllerLayout, target: 'all' | string = 'all'): void {
    this.platform.send({ type: 'layout', target, layout });
  }

  /** Admin phone gets the d-pad; everyone else waits. */
  private syncMenuLayouts(): void {
    const admin = this.admin;
    this.sendLayout({ type: 'message', text: admin ? t.waitingForAdmin(admin.nickname) : t.menuTitle });
    // Each phone in its own language.
    for (const p of this.players) {
      if (!p.connected) continue;
      const pt = tFor(p.lang);
      if (admin && p.id === admin.id) this.sendLayout({ type: 'menu', title: pt.menuTitle }, p.id);
      else this.sendLayout({ type: 'message', text: admin ? pt.waitingForAdmin(admin.nickname) : pt.menuTitle }, p.id);
    }
  }

  // ---------------- rendering ----------------

  private render(): void {
    // Re-renders (players joining, room code changes) must keep the selection where it was.
    const cur = this.current(this.root);
    if (cur?.dataset.id) this.focusMemory.set(this.screen, cur.dataset.id);
    clear(this.root);
    if (this.connState === 'forbidden' || this.connState === 'replaced') {
      this.root.append(h('div', { class: 'center-message', role: 'alert' }, this.connState === 'forbidden' ? t.hostForbidden : t.hostReplaced));
      return;
    }
    if (this.screen === 'game') return; // game screen is built once in startGame()
    this.root.append(this.renderHeader());
    const main = h('main', { class: 'layout', id: 'main' });
    main.append(this.screen === 'home' ? this.renderHome() : this.renderSettings(), this.renderJoinPanel());
    this.root.append(main, h('footer', { class: 'hint', id: 'hint' }));
    this.renderPlayers();
    this.renderCardMeta();
    this.renderHint();
    if (this.connState === 'connecting' || this.connState === 'unavailable') {
      this.root.append(h('div', { class: 'conn-banner', role: 'status' }, this.connState === 'connecting' ? t.connecting : t.phoneServerDown));
    }
    this.restoreFocus();
    this.syncMenuLayouts();
  }

  private renderHeader(): HTMLElement {
    return h(
      'header',
      { class: 'topbar' },
      h('img', { class: 'logo', src: '/brand/logo.svg', alt: 'Rubinny Gameu', width: 300, height: 82 }),
      this.room?.locked ? h('div', { class: 'badge' }, '🔒 ', t.locked) : null,
    );
  }

  private renderHome(): HTMLElement {
    const grid = h('div', { class: 'grid', role: 'list' });
    for (const g of this.games) {
      const name = pick(g.name, lang());
      const card = h(
        'button',
        { class: 'card', 'data-nav': true, 'data-id': `game:${g.id}`, role: 'listitem', 'aria-describedby': `desc-${g.id}` },
        g.icon ? h('img', { src: `/games/${g.id}/${g.icon}`, alt: '', class: 'card-icon', width: 96, height: 96 }) : h('span', { class: 'card-icon', 'aria-hidden': 'true' }, '🎲'),
        h('span', { class: 'card-title', dir: 'auto' }, name),
        h('span', { class: 'card-desc', id: `desc-${g.id}`, dir: 'auto' }, pick(g.description, lang())),
        h('span', { class: 'card-meta', 'data-game': g.id }),
      );
      card.addEventListener('click', () => this.startGame(g));
      grid.append(card);
    }
    const settingsCard = h(
      'button',
      { class: 'card card-settings', 'data-nav': true, 'data-id': 'settings', role: 'listitem' },
      h('span', { class: 'card-icon', 'aria-hidden': 'true' }, '⚙️'),
      h('span', { class: 'card-title' }, t.settings),
      h('span', { class: 'card-desc' }, t.settingsDesc),
    );
    settingsCard.addEventListener('click', () => this.go('settings'));
    grid.append(settingsCard);
    return h('section', { class: 'panel games', 'aria-labelledby': 'games-title' }, h('h1', { id: 'games-title' }, t.games), grid);
  }

  private renderSettings(): HTMLElement {
    const s = this.settings;
    const list = h('div', { class: 'settings-list' });
    const onOff = (v: boolean) => (v ? t.on : t.off);

    const row = (id: string, label: string, value: string | null, onClick: () => void, pressed?: boolean) => {
      const btn = h(
        'button',
        { class: 'setting', 'data-nav': true, 'data-id': id, 'aria-pressed': pressed === undefined ? null : String(pressed) },
        h('span', { class: 'setting-label' }, label),
        value !== null ? h('span', { class: 'setting-value' }, value) : null,
      );
      btn.addEventListener('click', onClick);
      list.append(btn);
    };

    row('lang', t.language, languageName(s.language), () => {
      const next = LANG_CODES[(LANG_CODES.indexOf(s.language) + 1) % LANG_CODES.length] ?? 'he';
      void this.saveSettings({ language: next }).then(() => this.render());
    });
    row('text', t.textSize, `${Math.round(s.textScale * 100)}%`, () => {
      const steps = [1, 1.25, 1.5, 1.75];
      const next = steps[(steps.indexOf(s.textScale) + 1) % steps.length] ?? 1;
      void this.saveSettings({ textScale: next }).then(() => this.render());
    });
    row('contrast', t.highContrast, onOff(s.highContrast), () => void this.saveSettings({ highContrast: !s.highContrast }).then(() => this.render()), s.highContrast);
    row('motion', t.reduceMotion, onOff(s.reduceMotion), () => void this.saveSettings({ reduceMotion: !s.reduceMotion }).then(() => this.render()), s.reduceMotion);
    row('time', t.extendedTime, onOff(s.extendedTime), () => void this.saveSettings({ extendedTime: !s.extendedTime }).then(() => this.render()), s.extendedTime);
    row('volume', t.volume, `${Math.round(s.volume * 100)}%`, () => {
      const steps = [0, 0.3, 0.7, 1];
      const idx = steps.findIndex((v) => Math.abs(v - s.volume) < 0.01);
      void this.saveSettings({ volume: steps[(idx + 1) % steps.length] ?? 0.7 }).then(() => {
        sfx.select();
        this.render();
      });
    });
    row('music', t.music, onOff(s.music), () => void this.saveSettings({ music: !s.music }).then(() => this.render()), s.music);
    const locked = this.room?.locked ?? false;
    row('lock', t.roomLock, onOff(locked), () => this.platform.send({ type: 'lock', locked: !locked }), locked);
    row('code', t.newCode, this.room?.code ?? '', () => {
      this.platform.send({ type: 'new_code' });
      this.announce(t.codeChanged);
    });
    for (const p of this.players) {
      if (p.isAdmin) continue;
      row(`kick:${p.id}`, t.kick(p.nickname), null, () => this.platform.send({ type: 'kick', playerId: p.id }));
    }
    row('a11y', t.accessibility, null, () => this.openDocument('/legal/accessibility.html', t.accessibility));
    row('privacy', t.privacy, null, () => this.openDocument('/legal/privacy.html', t.privacy));
    row('back', t.back, null, () => this.go('home'));

    const version = this.platform.appVersion ? h('p', { class: 'version' }, t.version(this.platform.appVersion)) : null;
    return h('section', { class: 'panel settings', 'aria-labelledby': 'settings-title' }, h('h1', { id: 'settings-title' }, t.settings), list, version);
  }

  private renderJoinPanel(): HTMLElement {
    const qr = h('div', { class: 'qr', role: 'img', 'aria-label': t.joinScan });
    if (this.room) {
      // Server-generated SVG (from the `qrcode` library), never player input.
      const doc = new DOMParser().parseFromString(this.room.qrSvg, 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.nodeName.toLowerCase() === 'svg') qr.append(document.importNode(svg, true));
    }
    const url = this.room?.urls[0] ?? '';
    if (this.room && this.room.urls.length === 0) {
      // No LAN address: a QR pointing at "localhost" would only confuse phones.
      return h(
        'aside',
        { class: 'panel join', 'aria-labelledby': 'join-title' },
        h('h2', { id: 'join-title' }, t.joinTitle),
        h('div', { class: 'no-network', role: 'alert' }, h('p', { class: 'no-network-title' }, '📶 ', t.noNetworkTitle), h('p', {}, t.noNetworkBody)),
        h('h2', { class: 'players-title', id: 'players-title' }),
        h('ul', { class: 'players', id: 'players', 'aria-labelledby': 'players-title' }),
      );
    }
    return h(
      'aside',
      { class: 'panel join', 'aria-labelledby': 'join-title' },
      h('h2', { id: 'join-title' }, t.joinTitle),
      qr,
      h('p', { class: 'scan' }, t.joinScan),
      h('p', { class: 'code-line' }, t.roomCode, ': ', h('strong', { class: 'code', dir: 'ltr' }, this.room?.code ?? '····')),
      url ? h('p', { class: 'url' }, t.orBrowse, ' ', h('bdi', { dir: 'ltr' }, url)) : null,
      h('h2', { class: 'players-title', id: 'players-title' }),
      h('ul', { class: 'players', id: 'players', 'aria-labelledby': 'players-title' }),
    );
  }

  private renderPlayers(): void {
    const list = document.getElementById('players');
    const title = document.getElementById('players-title');
    if (!list || !title) return;
    title.textContent = `${t.players} (${this.players.length}/8)`;
    clear(list);
    if (this.players.length === 0) {
      list.append(h('li', { class: 'empty' }, t.noPlayers));
      return;
    }
    const names = t.avatarNames;
    for (const p of this.players) {
      const li = h(
        'li',
        { class: p.connected ? 'player' : 'player offline' },
        h('span', { class: 'avatar', role: 'img', 'aria-label': names[p.avatar] ?? '' }, AVATARS[p.avatar] ?? '🙂'),
        h('span', { class: 'name' }, p.nickname),
        p.isAdmin ? h('span', { class: 'tag' }, '👑 ', t.admin) : null,
        p.connected ? null : h('span', { class: 'tag muted' }, t.disconnected),
      );
      li.style.setProperty('--player-color', colorFor(p.avatar));
      list.append(li);
    }
  }

  /** Updates "needs N players" hints in place (keeps focus on the grid). */
  private renderCardMeta(): void {
    const connected = this.players.filter((p) => p.connected).length;
    for (const el of this.root.querySelectorAll<HTMLElement>('.card-meta[data-game]')) {
      const g = this.games.find((x) => x.id === el.dataset.game);
      if (!g) continue;
      const enough = connected >= g.minPlayers;
      el.textContent = enough ? t.playersRange(g.minPlayers, g.maxPlayers) : t.needPlayers(g.minPlayers);
      el.classList.toggle('warn', !enough);
    }
  }

  private renderHint(): void {
    const hint = document.getElementById('hint');
    if (!hint) return;
    const admin = this.admin;
    hint.textContent = admin ? t.hintAdmin(admin.nickname) : t.hintNoAdmin;
  }

  // ---------------- overlays ----------------

  private openOverlay(build: (close: () => void) => { el: HTMLElement; handle?: (a: Action) => boolean }): void {
    this.overlay?.close();
    const backdrop = h('div', { class: 'overlay' });
    const close = () => {
      backdrop.remove();
      if (this.overlay?.el === backdrop) this.overlay = null;
      if (this.screen !== 'game') this.restoreFocus();
    };
    const built = build(close);
    backdrop.append(built.el);
    document.body.append(backdrop);
    const overlay: Overlay = {
      el: backdrop,
      close,
      handle: (action) => {
        if (built.handle?.(action)) return;
        if (action === 'ok') {
          this.activate(backdrop);
        } else if (action === 'back') {
          sfx.back();
          close();
        } else if (action !== 'home') {
          this.moveFocus(action, backdrop);
        }
      },
    };
    this.overlay = overlay;
    const first = backdrop.querySelector<HTMLElement>('[data-nav]');
    if (first) this.setFocus(first);
  }

  private openDocument(src: string, title: string): void {
    this.openOverlay((close) => {
      const frame = h('iframe', { src, title, class: 'doc-frame' });
      const closeBtn = h('button', { class: 'btn', 'data-nav': true }, t.close);
      closeBtn.addEventListener('click', close);
      const dialog = h('div', { class: 'dialog doc', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), frame, closeBtn);
      return {
        el: dialog,
        handle: (a) => {
          if (a === 'up' || a === 'down') {
            frame.contentWindow?.scrollBy({ top: a === 'down' ? 200 : -200, behavior: this.settings.reduceMotion ? 'auto' : 'smooth' });
            return true;
          }
          return false;
        },
      };
    });
  }

  private confirmExitGame(): void {
    if (this.overlay || !this.game) return;
    this.openOverlay((close) => {
      const no = h('button', { class: 'btn', 'data-nav': true }, t.no);
      const yes = h('button', { class: 'btn danger', 'data-nav': true }, t.yes);
      no.addEventListener('click', close);
      yes.addEventListener('click', () => {
        close();
        this.stopGame();
      });
      return {
        el: h(
          'div',
          { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'exit-title', 'aria-describedby': 'exit-body' },
          h('h2', { id: 'exit-title' }, t.exitTitle),
          h('p', { id: 'exit-body' }, t.exitBody),
          h('div', { class: 'actions' }, no, yes),
        ),
      };
    });
    const admin = this.admin;
    if (admin) this.sendLayout({ type: 'menu', title: tFor(admin.lang).exitTitle }, admin.id);
  }

  private showResults(results: { playerId: string; score: number }[]): void {
    const byId = new Map(this.players.map((p) => [p.id, p]));
    const ranked = [...results].sort((a, b) => b.score - a.score);
    this.stopGame();
    if (ranked.length) play('fanfare');
    this.openOverlay((close) => {
      const list = h('ol', { class: 'results' });
      ranked.forEach((r, i) => {
        const p = byId.get(r.playerId);
        if (!p) return;
        const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
        list.append(
          h(
            'li',
            {},
            h('span', { class: 'medal', 'aria-hidden': 'true' }, medal),
            h('span', { class: 'avatar', 'aria-hidden': 'true' }, AVATARS[p.avatar] ?? ''),
            h('span', { class: 'name' }, p.nickname),
            h('span', { class: 'score' }, `${r.score} ${t.points}`),
          ),
        );
      });
      const btn = h('button', { class: 'btn', 'data-nav': true }, t.backToMenu);
      const timer = window.setTimeout(() => btn.click(), RESULTS_AUTO_CLOSE_MS);
      btn.addEventListener('click', () => {
        clearTimeout(timer);
        close();
      });
      return { el: h('div', { class: 'dialog results-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'res-title' }, h('h2', { id: 'res-title' }, '🏆 ', t.results), list, btn) };
    });
    const admin = this.admin;
    if (admin) this.sendLayout({ type: 'menu', title: tFor(admin.lang).results }, admin.id);
  }

  // ---------------- games ----------------

  private gamePlayers(): GamePlayer[] {
    return this.players.map((p) => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, color: colorFor(p.avatar), connected: p.connected, isAdmin: p.isAdmin, lang: p.lang }));
  }

  private startGame(manifest: GameManifest): void {
    const connected = this.players.filter((p) => p.connected).length;
    if (connected < manifest.minPlayers) {
      sfx.error();
      this.announce(t.needPlayers(manifest.minPlayers));
      return;
    }
    const cur = this.current(this.root);
    if (cur?.dataset.id) this.focusMemory.set('home', cur.dataset.id);
    this.screen = 'game';
    clear(this.root);
    const iframe = h('iframe', {
      class: 'game-frame',
      src: `/games/${manifest.id}/${manifest.entry}`,
      title: pick(manifest.name, lang()),
      // No allow-same-origin: the game gets an opaque origin and cannot touch the console or its storage.
      sandbox: 'allow-scripts',
      allow: 'autoplay',
      referrerpolicy: 'no-referrer',
    });
    const badge = h('div', { class: 'game-badge', 'aria-hidden': 'true' }, t.exitHint);
    const loading = h('div', { class: 'game-loading', role: 'status' }, t.loadingGame);
    this.root.append(h('main', { class: 'game-screen' }, iframe, loading, badge));
    const timer = window.setTimeout(() => {
      if (this.game && !this.game.ready) {
        this.announce(t.gameFailed);
        this.stopGame();
      }
    }, GAME_READY_TIMEOUT_MS);
    this.game = { manifest, iframe, ready: false, timer };
    this.sendLayout({ type: 'message', text: t.loadingGame });
    for (const p of this.players) if (p.connected && p.lang !== lang()) this.sendLayout({ type: 'message', text: tFor(p.lang).loadingGame }, p.id);
  }

  private stopGame(): void {
    if (this.game) clearTimeout(this.game.timer);
    this.game = null;
    this.screen = 'home';
    setMusic('menu');
    this.render();
  }

  private postToGame(msg: HostToGame): void {
    if (this.game?.ready) this.game.iframe.contentWindow?.postMessage(msg, '*');
  }

  private gameMsgBudget = { tokens: 100, last: performance.now() };

  private onGameMessage(e: MessageEvent): void {
    const game = this.game;
    if (!game || e.source !== game.iframe.contentWindow) return;
    // Simple budget so a runaway game loop can't flood phones.
    const now = performance.now();
    const b = this.gameMsgBudget;
    b.tokens = Math.min(100, b.tokens + ((now - b.last) / 1000) * 60);
    b.last = now;
    if (b.tokens < 1) return;
    b.tokens -= 1;

    const parsed = GameToHostSchema.safeParse(e.data);
    if (!parsed.success) return;
    const msg = parsed.data;
    const knownTarget = (target: string) => target === 'all' || this.players.some((p) => p.id === target);
    switch (msg.type) {
      case 'ready':
        game.ready = true;
        clearTimeout(game.timer);
        setMusic('game'); // default mood; the game may change it
        this.root.querySelector('.game-loading')?.remove();
        this.postToGame({ gameu: 1, type: 'init', players: this.gamePlayers(), settings: this.settings });
        break;
      case 'layout':
        if (knownTarget(msg.target)) this.platform.send({ type: 'layout', target: msg.target, layout: msg.layout });
        break;
      case 'haptic':
        if (knownTarget(msg.target)) this.platform.send({ type: 'haptic', target: msg.target, pattern: msg.pattern });
        break;
      case 'sound':
        play(msg.name);
        break;
      case 'music':
        setMusic(msg.mood);
        break;
      case 'end':
        this.showResults(msg.results);
        break;
    }
  }

  // ---------------- feedback ----------------

  private announce(text: string): void {
    this.live.textContent = text;
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 3500);
  }
}

