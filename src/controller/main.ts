import { AVATARS, LIMITS, colorFor } from '../shared/constants';
import { LANGUAGES, isLang } from '../shared/i18n';
import type { ControllerToServer, ErrorCode, Input, ParsedLayout, ServerToController } from '../shared/protocol';
import { $, clear, h, storage } from '../ui/dom';
import { applyDocumentLang, lang, setLang, t } from './i18n';
import { renderLayout } from './layouts';

const KEYS = { nick: 'gameu.nick', avatar: 'gameu.avatar', token: 'gameu.rt', prefs: 'gameu.prefs' } as const;
const FATAL: ErrorCode[] = ['kicked', 'replaced', 'bad_room', 'room_full', 'room_locked', 'rate_limited'];

interface Prefs {
  vibration: boolean;
  leftHand: boolean;
}

class ControllerApp {
  private readonly root = $('#app');
  private ws: WebSocket | null = null;
  private retry = 0;
  private joined = false;
  private wantConnection = false;
  private isAdmin = false;
  private nickname = '';
  private avatar = 0;
  private room = '';
  private layout: ParsedLayout | null = null;
  private cleanup: () => void = () => {};
  private prefs: Prefs = loadPrefs();
  private statusEl: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private retryTimer = 0;
  private draftNick: string | null = null;

  start(): void {
    applyDocumentLang();
    const params = new URLSearchParams(location.search);
    this.room = (params.get('r') ?? '').toUpperCase().slice(0, LIMITS.roomCodeLength);
    // Remove the room code from the address bar so screenshots/shares don't leak it.
    if (params.has('r')) history.replaceState(null, '', location.pathname);
    document.documentElement.classList.toggle('left-hand', this.prefs.leftHand);

    const token = storage.get(KEYS.token);
    const nick = storage.get(KEYS.nick);
    if (token && nick) {
      // Returning player (e.g. phone was locked or page reloaded): try silent reconnect.
      this.nickname = nick;
      this.avatar = Number(storage.get(KEYS.avatar) ?? 0) || 0;
      this.connect();
      this.renderPlay();
    } else {
      this.renderJoin();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wantConnection && !this.ws) {
        clearTimeout(this.retryTimer);
        this.connect();
      }
    });
  }

  // ---------------- join screen ----------------

  private renderJoin(error?: string): void {
    this.cleanup();
    this.joined = false;
    clear(this.root);
    const savedNick = this.draftNick ?? storage.get(KEYS.nick) ?? '';
    this.draftNick = null;
    const savedAvatar = Number(storage.get(KEYS.avatar) ?? Math.floor(Math.random() * AVATARS.length)) || 0;
    const names = t.avatarNames;

    const errorEl = h('p', { class: 'form-error', role: 'alert', id: 'join-error' }, error ?? '');
    const code = h('input', {
      id: 'room',
      name: 'room',
      required: true,
      inputmode: 'text',
      autocapitalize: 'characters',
      autocomplete: 'off',
      maxlength: LIMITS.roomCodeLength,
      pattern: '[A-Za-z2-9]{4}',
      dir: 'ltr',
      'aria-describedby': 'room-help join-error',
      value: this.room,
      class: 'code-input',
    });
    const nick = h('input', {
      id: 'nick',
      name: 'nick',
      required: true,
      maxlength: LIMITS.nicknameMax,
      autocomplete: 'nickname',
      dir: 'auto',
      'aria-describedby': 'nick-help join-error',
      value: savedNick,
    });
    const avatars = h('div', { class: 'avatars', role: 'radiogroup', 'aria-labelledby': 'avatar-label' });
    AVATARS.forEach((emoji, i) => {
      const id = `av-${i}`;
      const input = h('input', { type: 'radio', name: 'avatar', id, value: i, checked: i === savedAvatar });
      const label = h('label', { for: id, class: 'avatar-option', title: names[i] ?? '' }, h('span', { 'aria-hidden': 'true' }, emoji), h('span', { class: 'sr-only' }, names[i] ?? ''));
      label.style.setProperty('--player-color', colorFor(i));
      avatars.append(input, label);
    });
    const submit = h('button', { type: 'submit', class: 'action primary wide' }, t.join);
    const langSelect = this.languageSelect(() => {
      // Keep what was typed while re-rendering in the new language.
      this.room = code.value.trim().toUpperCase();
      this.draftNick = nick.value;
      this.renderJoin(errorEl.textContent || undefined);
    });
    const form = h(
      'form',
      { class: 'join-form', novalidate: true },
      langSelect,
      h('h1', {}, '🎮 ', t.joinTitle),
      h('label', { for: 'room' }, t.roomCode),
      code,
      h('p', { class: 'help', id: 'room-help' }, t.roomCodeHelp),
      h('label', { for: 'nick' }, t.nickname),
      nick,
      h('p', { class: 'help', id: 'nick-help' }, t.nicknameHelp),
      h('p', { class: 'label', id: 'avatar-label' }, t.avatar),
      avatars,
      errorEl,
      submit,
      h('p', { class: 'privacy-note' }, t.privacyNote),
      h('p', { class: 'links' }, h('a', { href: '/legal/privacy.html' }, t.privacyLink), ' · ', h('a', { href: '/legal/accessibility.html' }, t.a11yLink)),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const room = code.value.trim().toUpperCase();
      const nickname = nick.value.replace(/\s+/g, ' ').trim();
      const checked = form.querySelector<HTMLInputElement>('input[name="avatar"]:checked');
      if (!/^[A-HJ-NP-Z2-9]{4}$/.test(room)) {
        errorEl.textContent = t.errors.bad_room;
        code.setAttribute('aria-invalid', 'true');
        code.focus();
        return;
      }
      code.removeAttribute('aria-invalid');
      if (!nickname || /[<>]/.test(nickname)) {
        errorEl.textContent = t.errors.invalid;
        nick.setAttribute('aria-invalid', 'true');
        nick.focus();
        return;
      }
      nick.removeAttribute('aria-invalid');
      submit.disabled = true;
      submit.textContent = t.joining;
      this.room = room;
      this.nickname = nickname;
      this.avatar = Number(checked?.value ?? 0);
      storage.set(KEYS.nick, nickname);
      storage.set(KEYS.avatar, String(this.avatar));
      storage.remove(KEYS.token);
      this.connect();
    });
    this.root.append(h('main', { class: 'join-screen' }, form));
    (this.room ? nick : code).focus();
  }

  /** Language picker (native names). Changing it re-renders via `onChange`. */
  private languageSelect(onChange: () => void): HTMLElement {
    const select = h('select', { id: 'lang-select', class: 'lang-select' });
    for (const l of LANGUAGES) {
      const opt = h('option', { value: l.code, lang: l.code, selected: l.code === lang() }, l.name);
      select.append(opt);
    }
    select.addEventListener('change', () => {
      if (!isLang(select.value)) return;
      setLang(select.value);
      this.sendRaw({ type: 'lang', lang: select.value });
      onChange();
    });
    return h('div', { class: 'lang-row' }, h('label', { for: 'lang-select' }, '🌐 ', t.language), select);
  }

  // ---------------- play screen ----------------

  private renderPlay(): void {
    clear(this.root);
    const names = t.avatarNames;
    const menuBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t.settings, 'aria-haspopup': 'dialog' }, '⚙');
    menuBtn.addEventListener('click', () => this.openSettings());
    const fsBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t.fullscreen }, '⛶');
    fsBtn.addEventListener('click', () => {
      const el = document.documentElement;
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void el.requestFullscreen?.().catch(() => {});
    });
    // Admins can always leave a game: the TV asks for confirmation before quitting.
    const homeBtn = this.isAdmin ? h('button', { class: 'icon-btn home-btn', type: 'button', 'aria-label': t.home }, '🏠') : null;
    homeBtn?.addEventListener('click', () => {
      this.sendInput({ kind: 'button', id: 'home', pressed: true });
      this.sendInput({ kind: 'button', id: 'home', pressed: false });
    });
    const bar = h(
      'header',
      { class: 'bar' },
      h('span', { class: 'me' }, h('span', { class: 'avatar', role: 'img', 'aria-label': names[this.avatar] ?? '' }, AVATARS[this.avatar] ?? ''), h('span', { class: 'me-name' }, this.nickname)),
      this.isAdmin ? h('span', { class: 'tag' }, '👑 ', t.admin) : null,
      h('span', { class: 'spacer' }),
      homeBtn,
      fsBtn,
      menuBtn,
    );
    bar.style.setProperty('--player-color', colorFor(this.avatar));
    this.statusEl = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    this.stage = h('main', { class: 'stage', id: 'stage' });
    this.root.append(bar, this.statusEl, this.stage);
    this.renderStage();
    this.updateStatus();
  }

  private renderStage(): void {
    if (!this.stage) return;
    this.cleanup();
    clear(this.stage);
    const layout = this.layout ?? ({ type: 'message', text: t.connecting } as ParsedLayout);
    this.stage.dataset.layout = layout.type;
    this.root.classList.toggle('in-menu', layout.type === 'menu');
    this.cleanup = renderLayout(this.stage, layout, {
      send: (input) => this.sendInput(input),
      isAdmin: this.isAdmin,
      haptic: (ms) => this.vibrate([ms]),
    });
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    const connected = this.ws?.readyState === WebSocket.OPEN && this.joined;
    this.statusEl.textContent = connected ? '' : this.retry > 0 ? t.reconnecting : t.connecting;
    this.statusEl.classList.toggle('visible', !connected);
  }

  private openSettings(): void {
    const dialog = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-title' });
    const toggle = (label: string, key: keyof Prefs) => {
      const id = `pref-${key}`;
      const input = h('input', { type: 'checkbox', id, role: 'switch', checked: this.prefs[key] });
      input.addEventListener('change', () => {
        this.prefs[key] = input.checked;
        storage.set(KEYS.prefs, JSON.stringify(this.prefs));
        document.documentElement.classList.toggle('left-hand', this.prefs.leftHand);
      });
      return h('div', { class: 'pref' }, input, h('label', { for: id }, label));
    };
    const leave = h('button', { type: 'button', class: 'action danger wide' }, t.leave);
    leave.addEventListener('click', () => {
      dialog.close();
      this.leave();
    });
    const close = h('button', { type: 'button', class: 'action secondary wide' }, t.close);
    close.addEventListener('click', () => dialog.close());
    dialog.append(
      h('h2', { id: 'sheet-title' }, t.settings),
      this.languageSelect(() => {
        dialog.close();
        this.renderPlay();
      }),
    );
    if ('vibrate' in navigator) dialog.append(toggle(t.vibration, 'vibration'));
    dialog.append(
      toggle(t.leftHand, 'leftHand'),
      h('p', { class: 'links' }, h('a', { href: '/legal/privacy.html' }, t.privacyLink), ' · ', h('a', { href: '/legal/accessibility.html' }, t.a11yLink)),
      leave,
      close,
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  private leave(): void {
    this.wantConnection = false;
    storage.remove(KEYS.token);
    this.ws?.close(1000, 'leave');
    this.ws = null;
    this.layout = null;
    this.renderJoin();
  }

  private vibrate(pattern: number[]): void {
    if (!this.prefs.vibration) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported (e.g. iOS) */
    }
  }

  // ---------------- connection ----------------

  private connect(): void {
    this.wantConnection = true;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws/controller`);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      const token = storage.get(KEYS.token) ?? undefined;
      const join: ControllerToServer = { type: 'join', room: this.room || 'AAAA', nickname: this.nickname, avatar: this.avatar, reconnectToken: token, lang: lang() };
      ws.send(JSON.stringify(join));
    });
    ws.addEventListener('message', (ev) => {
      let msg: ServerToController;
      try {
        msg = JSON.parse(String(ev.data)) as ServerToController;
      } catch {
        return;
      }
      this.onMessage(msg);
    });
    ws.addEventListener('close', (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      const wasJoined = this.joined;
      this.joined = false;
      this.updateStatus();
      if (ev.code === 4003 || ev.code === 4002) return; // kicked / replaced: handled via error message
      if (!wasJoined && !storage.get(KEYS.token) && this.retry >= 2) {
        this.wantConnection = false;
        this.renderJoin(t.errors.network);
        return;
      }
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (!this.wantConnection) return;
    const delay = Math.min(5000, 400 * 2 ** this.retry++);
    this.updateStatus();
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private onMessage(msg: ServerToController): void {
    switch (msg.type) {
      case 'welcome':
        this.joined = true;
        this.retry = 0;
        this.isAdmin = msg.isAdmin;
        this.nickname = msg.nickname;
        this.avatar = msg.avatar;
        storage.set(KEYS.token, msg.reconnectToken);
        this.renderPlay();
        break;
      case 'layout':
        this.layout = msg.layout;
        this.renderStage();
        break;
      case 'admin':
        this.isAdmin = msg.isAdmin;
        this.renderPlay();
        break;
      case 'haptic':
        this.vibrate(msg.pattern);
        break;
      case 'host_status':
        break;
      case 'pong':
        break;
      case 'error':
        this.onError(msg.code);
        break;
    }
  }

  private onError(code: ErrorCode): void {
    if (!FATAL.includes(code)) return;
    const staleSession = code === 'bad_room' && !!storage.get(KEYS.token) && !this.room;
    this.wantConnection = false;
    if (staleSession) {
      // Console restarted since this phone last played: just show the join form.
      storage.remove(KEYS.token);
      this.ws?.close(1000, 'stale');
      this.ws = null;
      this.layout = null;
      this.renderJoin();
      return;
    }
    this.ws?.close(1000, 'error');
    this.ws = null;
    this.layout = null;
    if (code === 'kicked' || code === 'replaced') storage.remove(KEYS.token);
    this.renderJoin(t.errors[code as keyof typeof t.errors] ?? t.errors.invalid);
  }

  private sendRaw(msg: ControllerToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.joined) this.ws.send(JSON.stringify(msg));
  }

  private sendInput(input: Input): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.joined) {
      this.ws.send(JSON.stringify({ type: 'input', input } satisfies ControllerToServer));
    }
  }
}

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(storage.get(KEYS.prefs) ?? '{}') as Partial<Prefs>;
    return { vibration: raw.vibration !== false, leftHand: raw.leftHand === true };
  } catch {
    return { vibration: true, leftHand: false };
  }
}

new ControllerApp().start();
