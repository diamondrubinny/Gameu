import { createSdk, type GamePlayer, type Input } from '../../src/sdk/gameu';
import { AVATARS } from '../../src/shared/constants';
import { $, announce, applyDocumentSettings, clear, h, sleep } from '../../src/sdk/game-utils';

const COLS = 48;
const ROWS = 27;
const GAME_SECONDS = 120;
const RESPAWN_MS = 3000;
const START_LENGTH = 4;

type Dir = 'up' | 'down' | 'left' | 'right';
type Cell = { x: number; y: number };

interface Snake {
  player: GamePlayer;
  body: Cell[];
  dir: Dir;
  queue: Dir[];
  alive: boolean;
  respawnAt: number;
  score: number;
  grow: number;
}

const VEC: Record<Dir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const sdk = createSdk();
const canvas = $('#board') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const snakes = new Map<string, Snake>();
let food: Cell[] = [];
let running = false;
let tickMs = 120;
let endsAt = 0;
let highContrast = false;

sdk.onInit(async ({ players, settings }) => {
  applyDocumentSettings(settings);
  highContrast = settings.highContrast;
  tickMs = settings.extendedTime ? 170 : 120;
  $('#title').textContent = `🐍 ${sdk.t('נחשים', 'Snakes')}`;
  canvas.setAttribute('aria-label', sdk.t('לוח המשחק', 'Game board'));
  sdk.setLayout({ type: 'dpad', title: sdk.t('🐍 נחשים — כוונו עם החצים', '🐍 Snakes — steer with the arrows'), buttons: [] });
  for (const p of players) if (p.connected) addSnake(p);
  placeFood();
  fit();
  window.addEventListener('resize', fit);
  draw();
  await countdown();
  running = true;
  endsAt = performance.now() + GAME_SECONDS * 1000;
  loop();
});

sdk.onPlayers((players) => {
  for (const p of players) {
    const s = snakes.get(p.id);
    if (p.connected && !s) addSnake(p);
    if (s) s.player = p;
  }
  renderScores();
});

sdk.onInput((playerId: string, input: Input) => {
  if (input.kind !== 'button' || !input.pressed) return;
  const s = snakes.get(playerId);
  if (!s || !(input.id in VEC)) return;
  const d = input.id as Dir;
  const last = s.queue[s.queue.length - 1] ?? s.dir;
  if (d !== last && d !== OPPOSITE[last] && s.queue.length < 2) s.queue.push(d);
});

function addSnake(p: GamePlayer): void {
  const s: Snake = { player: p, body: [], dir: 'right', queue: [], alive: false, respawnAt: 0, score: 0, grow: 0 };
  snakes.set(p.id, s);
  spawn(s);
  renderScores();
}

function occupied(): Set<string> {
  const set = new Set<string>();
  for (const s of snakes.values()) for (const c of s.body) set.add(`${c.x},${c.y}`);
  return set;
}

function spawn(s: Snake): void {
  const occ = occupied();
  for (let attempt = 0; attempt < 200; attempt++) {
    const dir = (['up', 'down', 'left', 'right'] as Dir[])[Math.floor(Math.random() * 4)] as Dir;
    const head = { x: 4 + Math.floor(Math.random() * (COLS - 8)), y: 4 + Math.floor(Math.random() * (ROWS - 8)) };
    const body: Cell[] = [];
    for (let i = 0; i < START_LENGTH; i++) body.push(wrap({ x: head.x - VEC[dir].x * i, y: head.y - VEC[dir].y * i }));
    // keep a few free cells ahead
    const ahead = [1, 2, 3, 4].map((k) => wrap({ x: head.x + VEC[dir].x * k, y: head.y + VEC[dir].y * k }));
    if ([...body, ...ahead].some((c) => occ.has(`${c.x},${c.y}`))) continue;
    s.body = body;
    s.dir = dir;
    s.queue = [];
    s.alive = true;
    s.grow = 0;
    return;
  }
  s.alive = false;
  s.respawnAt = performance.now() + 500;
}

function wrap(c: Cell): Cell {
  return { x: (c.x + COLS) % COLS, y: (c.y + ROWS) % ROWS };
}

function placeFood(): void {
  const want = Math.max(3, snakes.size + 2);
  const occ = occupied();
  for (const f of food) occ.add(`${f.x},${f.y}`);
  while (food.length < want) {
    const c = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    const key = `${c.x},${c.y}`;
    if (occ.has(key)) continue;
    occ.add(key);
    food.push(c);
  }
}

function step(now: number): void {
  // respawns + leaving players
  for (const s of snakes.values()) {
    if (!s.player.connected) {
      s.alive = false;
      s.body = [];
      continue;
    }
    if (!s.alive && now >= s.respawnAt) spawn(s);
  }
  const live = [...snakes.values()].filter((s) => s.alive);
  // advance heads
  const heads = new Map<Snake, Cell>();
  for (const s of live) {
    s.dir = s.queue.shift() ?? s.dir;
    const head = s.body[0]!;
    heads.set(s, wrap({ x: head.x + VEC[s.dir].x, y: head.y + VEC[s.dir].y }));
  }
  // move bodies (tail leaves before collision check)
  for (const s of live) {
    s.body.unshift(heads.get(s)!);
    if (s.grow > 0) s.grow--;
    else s.body.pop();
  }
  // collisions
  const dead = new Set<Snake>();
  for (const s of live) {
    const head = s.body[0]!;
    for (const other of live) {
      const cells = other === s ? other.body.slice(1) : other.body;
      if (cells.some((c) => c.x === head.x && c.y === head.y)) {
        dead.add(s);
        break;
      }
    }
  }
  for (const s of dead) {
    s.alive = false;
    s.respawnAt = now + RESPAWN_MS;
    // dropped body becomes food (every 3rd cell)
    s.body.forEach((c, i) => i % 3 === 1 && food.push(c));
    s.body = [];
    sdk.haptic([200, 80, 200], s.player.id);
  }
  // food
  for (const s of live) {
    if (!s.alive) continue;
    const head = s.body[0]!;
    const idx = food.findIndex((f) => f.x === head.x && f.y === head.y);
    if (idx >= 0) {
      food.splice(idx, 1);
      s.grow += 2;
      s.score += 10;
      sdk.haptic([30], s.player.id);
    }
  }
  if (food.length > snakes.size * 6 + 10) food = food.slice(-(snakes.size * 6 + 10));
  placeFood();
}

let lastTick = 0;
let lastScoreRender = 0;
function loop(): void {
  if (!running) return;
  const now = performance.now();
  if (now - lastTick >= tickMs) {
    lastTick = now;
    step(now);
    draw();
    if (now - lastScoreRender > 500) {
      lastScoreRender = now;
      renderScores();
    }
  }
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  $('#clock').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  if (left <= 0) {
    finish();
    return;
  }
  requestAnimationFrame(loop);
}

function finish(): void {
  running = false;
  renderScores();
  const overlay = $('#overlay');
  clear(overlay);
  overlay.append(h('div', { class: 'big pop' }, sdk.t('נגמר הזמן!', "Time's up!")));
  announce(sdk.t('נגמר הזמן', "Time's up"));
  setTimeout(() => sdk.end([...snakes.values()].map((s) => ({ playerId: s.player.id, score: s.score }))), 2000);
}

async function countdown(): Promise<void> {
  const overlay = $('#overlay');
  for (const n of ['3', '2', '1', sdk.t('צאו!', 'Go!')]) {
    clear(overlay);
    overlay.append(h('div', { class: 'big pop' }, n));
    announce(n);
    await sleep(800);
  }
  clear(overlay);
}

function fit(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  draw();
}

function draw(): void {
  const cell = Math.min(canvas.width / COLS, canvas.height / ROWS);
  const ox = (canvas.width - cell * COLS) / 2;
  const oy = (canvas.height - cell * ROWS) / 2;
  g.clearRect(0, 0, canvas.width, canvas.height);
  // grid
  g.fillStyle = highContrast ? '#000' : '#0f1226';
  g.fillRect(ox, oy, cell * COLS, cell * ROWS);
  if (!highContrast) {
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < COLS; x++) for (let y = (x % 2); y < ROWS; y += 2) g.fillRect(ox + x * cell, oy + y * cell, cell, cell);
  }
  // food
  for (const f of food) {
    g.fillStyle = '#ff5d73';
    g.beginPath();
    g.arc(ox + (f.x + 0.5) * cell, oy + (f.y + 0.5) * cell, cell * 0.38, 0, Math.PI * 2);
    g.fill();
  }
  // snakes
  for (const s of snakes.values()) {
    if (!s.alive) continue;
    g.fillStyle = s.player.color;
    s.body.forEach((c, i) => {
      const pad = i === 0 ? 0 : cell * 0.1;
      g.fillRect(ox + c.x * cell + pad, oy + c.y * cell + pad, cell - pad * 2, cell - pad * 2);
    });
    // Avatar on the head: players can tell snakes apart without relying on color.
    const head = s.body[0]!;
    g.font = `${cell * 1.3}px system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(AVATARS[s.player.avatar] ?? '', ox + (head.x + 0.5) * cell, oy + (head.y + 0.5) * cell);
  }
}

function renderScores(): void {
  const list = $('#scores');
  clear(list);
  const sorted = [...snakes.values()].sort((a, b) => b.score - a.score);
  for (const s of sorted) {
    const li = h(
      'li',
      { class: s.alive ? '' : 'dead' },
      h('span', { 'aria-hidden': 'true' }, AVATARS[s.player.avatar] ?? ''),
      h('span', { class: 'n' }, s.player.nickname),
      h('span', { class: 's' }, s.score),
    );
    li.style.setProperty('--c', s.player.color);
    list.append(li);
  }
}
