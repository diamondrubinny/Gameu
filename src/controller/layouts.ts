import type { ButtonDef, Input, ParsedLayout } from '../shared/protocol';
import { LIMITS } from '../shared/constants';
import { h } from '../ui/dom';
import { layoutText, t } from './i18n';

export interface LayoutContext {
  send(input: Input): void;
  isAdmin: boolean;
  haptic(ms: number): void;
}

/** Renders a layout and returns a cleanup function. */
export function renderLayout(container: HTMLElement, layout: ParsedLayout, ctx: LayoutContext): () => void {
  switch (layout.type) {
    case 'menu':
      return renderPad(container, layout.title ?? t.menu, menuButtons(ctx.isAdmin), ctx, true);
    case 'dpad':
      return renderPad(container, layout.title, layout.buttons, ctx, true);
    case 'joystick':
      return renderJoystick(container, layout.title, layout.buttons, ctx);
    case 'choices':
      return renderChoices(container, layout, ctx);
    case 'text':
      return renderText(container, layout, ctx);
    case 'draw':
      return renderDraw(container, layout, ctx);
    case 'cards':
      return renderCards(container, layout, ctx);
    case 'letters':
      return renderLetters(container, layout, ctx);
    case 'message':
      container.append(
        h('div', { class: 'message', role: 'status' }, h('p', { class: 'message-text' }, layoutText(layout.text)), layout.subtext ? h('p', { class: 'message-sub' }, layout.subtext) : null),
      );
      return () => {};
  }
}

function menuButtons(isAdmin: boolean): ButtonDef[] {
  const b: ButtonDef[] = [
    { id: 'ok', label: t.ok, color: 'primary' },
    { id: 'back', label: t.back, color: 'secondary' },
  ];
  if (isAdmin) b.push({ id: 'home', label: `🏠 ${t.home}`, color: 'secondary' });
  return b;
}

/** Press/release button wired with pointer events (works for multi-touch). */
/** Minimum time the pressed look stays visible, so quick taps are still seen. */
const PRESS_VISIBLE_MS = 160;

function pressButton(el: HTMLButtonElement, id: string, ctx: LayoutContext): void {
  let down = false;
  let downAt = 0;
  let unpressTimer = 0;
  const showPressed = () => {
    window.clearTimeout(unpressTimer);
    el.classList.add('pressed');
    downAt = performance.now();
  };
  const hidePressed = () => {
    const left = PRESS_VISIBLE_MS - (performance.now() - downAt);
    window.clearTimeout(unpressTimer);
    unpressTimer = window.setTimeout(() => el.classList.remove('pressed'), Math.max(0, left));
  };
  const press = (e: PointerEvent) => {
    e.preventDefault();
    if (down) return;
    down = true;
    // Keep receiving this finger's events even if it slides a little off the button.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
    showPressed();
    ctx.haptic(15);
    ctx.send({ kind: 'button', id, pressed: true });
  };
  const release = (e: Event) => {
    e.preventDefault();
    if (!down) return;
    down = false;
    hidePressed();
    ctx.send({ kind: 'button', id, pressed: false });
  };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  // Keyboard / switch access / screen readers: click = press + release.
  el.addEventListener('click', (e) => {
    if ((e as PointerEvent).pointerType) return; // already handled by pointer events
    showPressed();
    hidePressed();
    ctx.send({ kind: 'button', id, pressed: true });
    ctx.send({ kind: 'button', id, pressed: false });
  });
}

function renderPad(container: HTMLElement, title: string | undefined, buttons: ButtonDef[], ctx: LayoutContext, dpad: boolean): () => void {
  const wrap = h('div', { class: 'pad' });
  if (title) wrap.append(h('h2', { class: 'layout-title' }, title));
  const row = h('div', { class: 'pad-row', dir: 'ltr' });
  if (dpad) {
    const cross = h('div', { class: 'dpad', role: 'group', 'aria-label': t.menu });
    const dirs: [string, string, string][] = [
      ['up', '▲', t.up],
      ['left', '◀', t.left],
      ['right', '▶', t.right],
      ['down', '▼', t.down],
    ];
    for (const [id, glyph, label] of dirs) {
      const b = h('button', { class: `dir dir-${id}`, 'aria-label': label, type: 'button' }, glyph);
      pressButton(b, id, ctx);
      cross.append(b);
    }
    row.append(cross);
  }
  if (buttons.length) {
    const actions = h('div', { class: 'actions' });
    for (const def of buttons) {
      const b = h('button', { class: `action ${def.color ?? 'primary'}`, 'aria-label': def.aria ?? def.label, type: 'button' }, def.label);
      pressButton(b, def.id, ctx);
      actions.append(b);
    }
    row.append(actions);
  }
  wrap.append(row);
  container.append(wrap);
  return () => {};
}

function renderJoystick(container: HTMLElement, title: string | undefined, buttons: ButtonDef[], ctx: LayoutContext): () => void {
  const wrap = h('div', { class: 'pad' });
  if (title) wrap.append(h('h2', { class: 'layout-title' }, title));
  const row = h('div', { class: 'pad-row', dir: 'ltr' });
  const base = h('div', { class: 'stick', role: 'application', 'aria-label': t.joystick });
  const knob = h('div', { class: 'knob' });
  base.append(knob);
  row.append(base);

  let pointer: number | null = null;
  let last = 0;
  let pending: { x: number; y: number } | null = null;
  let flushTimer = 0;
  const flush = () => {
    if (!pending) return;
    ctx.send({ kind: 'stick', id: 'stick', x: round(pending.x), y: round(pending.y) });
    pending = null;
    last = performance.now();
  };
  const update = (e: PointerEvent) => {
    const r = base.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
    pending = { x: dx, y: -dy }; // y up is positive
    const wait = 33 - (performance.now() - last); // ~30Hz
    if (wait <= 0) flush();
    else if (!flushTimer) flushTimer = window.setTimeout(() => ((flushTimer = 0), flush()), wait);
  };
  base.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pointer = e.pointerId;
    base.setPointerCapture(e.pointerId);
    update(e);
  });
  base.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) update(e);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    knob.style.transform = '';
    clearTimeout(flushTimer);
    flushTimer = 0;
    pending = null;
    ctx.send({ kind: 'stick', id: 'stick', x: 0, y: 0 });
  };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);

  if (buttons.length) {
    const actions = h('div', { class: 'actions' });
    for (const def of buttons) {
      const b = h('button', { class: `action ${def.color ?? 'primary'}`, 'aria-label': def.aria ?? def.label, type: 'button' }, def.label);
      pressButton(b, def.id, ctx);
      actions.append(b);
    }
    row.append(actions);
  }
  wrap.append(row);
  container.append(wrap);
  return () => clearTimeout(flushTimer);
}

const CHOICE_SHAPES = ['▲', '◆', '●', '■', '★', '⬟'];

function renderChoices(container: HTMLElement, layout: Extract<ParsedLayout, { type: 'choices' }>, ctx: LayoutContext): () => void {
  const wrap = h('div', { class: 'choices' });
  if (layout.prompt) wrap.append(h('h2', { class: 'layout-title' }, layout.prompt));
  const list = h('div', { class: 'choice-list', role: 'group', 'aria-label': layout.prompt ?? t.options });
  const status = h('p', { class: 'choice-status', role: 'status' });
  const buttons = layout.options.map((opt, index) => {
    const b = h(
      'button',
      { class: `choice c${index}`, type: 'button' },
      h('span', { class: 'shape', 'aria-hidden': 'true' }, CHOICE_SHAPES[index] ?? ''),
      h('span', { class: 'choice-label' }, opt),
    );
    b.addEventListener('click', () => {
      for (const other of buttons) {
        other.disabled = true;
        other.setAttribute('aria-pressed', String(other === b));
      }
      b.classList.add('chosen');
      ctx.haptic(30);
      ctx.send({ kind: 'choice', id: layout.id, index });
      status.textContent = t.chosen;
    });
    list.append(b);
    return b;
  });
  wrap.append(list, status);
  container.append(wrap);
  return () => {};
}

function renderText(container: HTMLElement, layout: Extract<ParsedLayout, { type: 'text' }>, ctx: LayoutContext): () => void {
  const inputId = 'text-input';
  const form = h('form', { class: 'text-form', novalidate: true });
  const input = h('input', {
    id: inputId,
    type: 'text',
    maxlength: Math.min(layout.maxLength, LIMITS.textMax),
    placeholder: layout.placeholder ?? '',
    autocomplete: 'off',
    enterkeyhint: 'send',
    dir: 'auto',
  });
  const status = h('p', { class: 'text-status', role: 'status' });
  form.append(h('label', { for: inputId, class: 'layout-title' }, layout.prompt), input, h('button', { type: 'submit', class: 'action primary wide' }, t.send), status);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    ctx.send({ kind: 'text', id: layout.id, value });
    ctx.haptic(20);
    input.value = '';
    status.textContent = `${t.sent}: ${value}`;
    input.focus();
  });
  container.append(form);
  setTimeout(() => input.focus(), 50);
  return () => {};
}

function renderDraw(container: HTMLElement, layout: Extract<ParsedLayout, { type: 'draw' }>, ctx: LayoutContext): () => void {
  const wrap = h('div', { class: 'draw' });
  if (layout.prompt) wrap.append(h('h2', { class: 'layout-title' }, layout.prompt));
  const canvas = h('canvas', { class: 'draw-canvas', role: 'img', 'aria-label': t.drawArea });
  const toolbar = h('div', { class: 'draw-tools', dir: 'ltr' });
  wrap.append(canvas, toolbar);
  container.append(wrap);

  let color = 0;
  let size = 2;
  let stroke = 0;
  const swatches = layout.colors.map((hex, i) => {
    const b = h('button', { class: 'swatch', type: 'button', 'aria-label': `${t.color} ${i + 1}`, 'aria-pressed': String(i === 0) });
    b.style.background = hex;
    b.addEventListener('click', () => {
      color = i;
      swatches.forEach((s, j) => s.setAttribute('aria-pressed', String(j === i)));
    });
    toolbar.append(b);
    return b;
  });
  const sizeBtn = h('button', { class: 'tool', type: 'button', 'aria-label': t.brush }, '●');
  sizeBtn.addEventListener('click', () => {
    size = (size % 5) + 1;
    sizeBtn.style.fontSize = `${0.6 + size * 0.25}em`;
  });
  const clearBtn = h('button', { class: 'tool', type: 'button' }, t.clear);
  clearBtn.addEventListener('click', () => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    ctx.send({ kind: 'button', id: 'clear', pressed: true });
    ctx.send({ kind: 'button', id: 'clear', pressed: false });
  });
  toolbar.append(sizeBtn, clearBtn);

  const g = canvas.getContext('2d')!;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    g.lineCap = 'round';
    g.lineJoin = 'round';
  };
  fit();
  window.addEventListener('resize', fit);

  let buffer: [number, number][] = [];
  let lastPt: [number, number] | null = null;
  let flushTimer = 0;
  let pointer: number | null = null;
  const flush = () => {
    flushTimer = 0;
    if (!buffer.length) return;
    ctx.send({ kind: 'draw', id: layout.id, stroke, color, size, points: buffer });
    // Keep continuity: next chunk starts at the last point.
    buffer = lastPt ? [lastPt] : [];
  };
  const point = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    stroke += 1;
    const p = point(e);
    buffer = [p];
    lastPt = p;
    drawDot(p);
    flushTimer = window.setTimeout(flush, 50);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer || !lastPt) return;
    const p = point(e);
    if (Math.hypot(p[0] - lastPt[0], p[1] - lastPt[1]) < 0.004) return;
    drawSegment(lastPt, p);
    lastPt = p;
    buffer.push([round(p[0]), round(p[1])]);
    if (buffer.length >= LIMITS.drawPointsPerMessage) {
      clearTimeout(flushTimer);
      flush();
    } else if (!flushTimer) flushTimer = window.setTimeout(flush, 50);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    clearTimeout(flushTimer);
    flush();
    buffer = [];
    lastPt = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function drawSegment(a: [number, number], b: [number, number]): void {
    g.strokeStyle = layout.colors[color] ?? '#000';
    g.lineWidth = size * 3 * (window.devicePixelRatio || 1);
    g.beginPath();
    g.moveTo(a[0] * canvas.width, a[1] * canvas.height);
    g.lineTo(b[0] * canvas.width, b[1] * canvas.height);
    g.stroke();
  }
  function drawDot(p: [number, number]): void {
    drawSegment(p, [p[0] + 0.0001, p[1]]);
  }

  return () => {
    window.removeEventListener('resize', fit);
    clearTimeout(flushTimer);
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ---------------------------------------------------------------- cards (poker etc.)

const SUIT_SYMBOL: Record<string, string> = { s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663' };
/** Hide-cards toggle survives layout updates (privacy at a shared table). */
let cardsHidden = false;

export function cardName(code: string): string {
  const rank = code[0] ?? '';
  const suit = code[1] ?? '';
  const ranks = t.cards.ranks as Record<string, string>;
  const suits = t.cards.suits as Record<string, string>;
  return t.cards.card(ranks[rank] ?? rank, suits[suit] ?? suit);
}

function cardEl(code: string): HTMLElement {
  const suit = code[1] ?? 's';
  const rank = code[0] === 'T' ? '10' : (code[0] ?? '');
  return h(
    'div',
    { class: `pcard suit-${suit}`, role: 'img', 'aria-label': cardName(code) },
    h('span', { class: 'pcard-rank', 'aria-hidden': 'true' }, rank),
    h('span', { class: 'pcard-suit', 'aria-hidden': 'true' }, SUIT_SYMBOL[suit] ?? ''),
  );
}

function renderCards(container: HTMLElement, layout: Extract<ParsedLayout, { type: 'cards' }>, ctx: LayoutContext): () => void {
  const wrap = h('div', { class: 'cards-layout' });
  if (layout.title) wrap.append(h('h2', { class: 'layout-title', role: 'status' }, layout.title));
  if (layout.cards.length) {
    const hand = h('div', { class: `hand${layout.dim ? ' dim' : ''}`, role: 'group', 'aria-label': t.cards.yours });
    const toggle = h('button', { class: 'action secondary small hide-toggle', type: 'button', 'aria-pressed': String(cardsHidden) });
    const paint = () => {
      hand.replaceChildren(...(cardsHidden ? [h('p', { class: 'hand-hidden' }, t.cards.hidden)] : layout.cards.map(cardEl)));
      toggle.textContent = cardsHidden ? t.cards.show : t.cards.hide;
      toggle.setAttribute('aria-pressed', String(cardsHidden));
    };
    toggle.addEventListener('click', () => {
      cardsHidden = !cardsHidden;
      paint();
    });
    paint();
    wrap.append(hand, toggle);
  }
  if (layout.info.length) wrap.append(h('ul', { class: 'cards-info' }, ...layout.info.map((line) => h('li', { dir: 'auto' }, line))));
  if (layout.actions.length) {
    const grid = h('div', { class: 'card-actions', role: 'group' });
    const buttons = layout.actions.map((a) => {
      const b = h('button', { class: `action ${a.color ?? 'secondary'}`, type: 'button', 'aria-label': a.aria ?? null }, a.label);
      b.addEventListener('click', () => {
        // One decision per turn: lock the buttons until the game sends the next layout.
        for (const other of buttons) other.disabled = true;
        b.classList.add('chosen', 'pressed');
        ctx.haptic(30);
        ctx.send({ kind: 'button', id: a.id, pressed: true });
        ctx.send({ kind: 'button', id: a.id, pressed: false });
      });
      grid.append(b);
      return b;
    });
    wrap.append(grid);
  }
  container.append(wrap);
  return () => {};
}

// ---------------------------------------------------------------- letters (word games)

function renderLetters(container: HTMLElement, layout: Extract<ParsedLayout, { type: 'letters' }>, ctx: LayoutContext): () => void {
  const wrap = h('div', { class: 'letters-layout' });
  if (layout.prompt) wrap.append(h('h2', { class: 'layout-title' }, layout.prompt));
  const used = new Set(layout.used);
  const grid = h('div', { class: 'letter-grid', role: 'group', 'aria-label': t.letters.label, dir: 'auto' });
  const status = h('p', { class: 'choice-status', role: 'status' });
  const buttons: HTMLButtonElement[] = [];
  const lock = () => buttons.forEach((b) => (b.disabled = true));
  for (const letter of layout.letters) {
    const isUsed = used.has(letter);
    const b = h('button', { class: 'letter', type: 'button', disabled: isUsed, 'aria-label': isUsed ? `${letter}, ${t.letters.used}` : letter }, letter);
    b.addEventListener('click', () => {
      lock();
      b.classList.add('chosen');
      ctx.haptic(20);
      ctx.send({ kind: 'text', id: layout.id, value: letter });
      status.textContent = `${t.sent}: ${letter}`;
    });
    buttons.push(b);
    grid.append(b);
  }
  wrap.append(grid, status);
  if (layout.solve) {
    const inputId = 'solve-input';
    const form = h('form', { class: 'text-form solve-form', novalidate: true });
    const input = h('input', { id: inputId, type: 'text', maxlength: 40, placeholder: t.letters.solvePlaceholder, autocomplete: 'off', enterkeyhint: 'send', dir: 'auto' });
    form.append(h('label', { for: inputId, class: 'solve-label' }, t.letters.solve), input, h('button', { type: 'submit', class: 'action primary' }, t.send));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      lock();
      ctx.haptic(20);
      ctx.send({ kind: 'text', id: 'solve', value });
      input.value = '';
      status.textContent = `${t.sent}: ${value}`;
    });
    wrap.append(form);
  }
  container.append(wrap);
  return () => {};
}
