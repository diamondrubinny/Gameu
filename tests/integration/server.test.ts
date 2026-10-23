import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { loadGames } from '../../src/server/games';
import { silentLogger } from '../../src/server/logger';
import { SettingsStore } from '../../src/server/settings';

let app: App;
let base: string;
let port: number;
let tmp: string;

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gameu-test-'));
  const appRoot = path.join(tmp, 'app');
  await write(path.join(appRoot, 'public/host/index.html'), '<!doctype html><title>host</title>');
  await write(path.join(appRoot, 'public/c/index.html'), '<!doctype html><title>controller</title>');
  await write(path.join(appRoot, 'public/404.html'), '<!doctype html><title>404</title>');
  await write(path.join(appRoot, 'games/demo/index.html'), '<!doctype html><title>demo</title>');
  await write(
    path.join(appRoot, 'games/demo/manifest.json'),
    JSON.stringify({ id: 'demo', version: '1.0.0', name: { he: 'דמו', en: 'Demo' }, description: { he: 'ד', en: 'd' }, minPlayers: 1, maxPlayers: 4, controller: 'dpad' }),
  );
  await write(path.join(appRoot, 'games/broken/manifest.json'), '{"id": "../evil"}');
  const config = loadConfig({ GAMEU_APP_ROOT: appRoot, GAMEU_DATA_DIR: path.join(tmp, 'data'), PORT: '0' }, []);
  const settings = new SettingsStore(config.dataDir, silentLogger);
  await settings.load();
  const games = await loadGames(path.join(appRoot, 'games'), silentLogger);
  app = createApp({ config, logger: silentLogger, settings, games, lanIps: () => ['192.168.50.10'] });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  port = (app.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

function openWs(pathname: string, origin = base): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, { headers: { Origin: origin } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

/** Collects messages so tests can await a specific type without races. */
function inbox(ws: WebSocket) {
  const msgs: { type: string; [k: string]: unknown }[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    msgs.push(JSON.parse(String(d)));
    waiters.splice(0).forEach((w) => w());
  });
  return {
    msgs,
    async next<T = Record<string, unknown>>(type: string, pred: (m: T) => boolean = () => true, timeout = 3000): Promise<T> {
      const deadline = Date.now() + timeout;
      for (;;) {
        const idx = msgs.findIndex((m) => m.type === type && pred(m as T));
        if (idx >= 0) return msgs.splice(idx, 1)[0] as T;
        if (Date.now() > deadline) throw new Error(`timeout waiting for ${type}; got ${msgs.map((m) => m.type).join(',')}`);
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 50);
        });
      }
    },
  };
}

describe('HTTP', () => {
  it('serves health, games (skipping invalid ones) and settings', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    const games = (await (await fetch(`${base}/api/games`)).json()) as { games: { id: string }[] };
    expect(games.games.map((g) => g.id)).toEqual(['demo']);
    const s = (await (await fetch(`${base}/api/settings`)).json()) as { settings: { language: string } };
    expect(s.settings.language).toBe('he');
  });

  it('sends security headers', async () => {
    const res = await fetch(`${base}/c`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const game = await fetch(`${base}/games/demo/index.html`);
    expect(game.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
    expect(game.headers.get('content-security-policy')).toContain("connect-src 'none'");
  });

  it('rejects DNS-rebinding Host headers', async () => {
    const http = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/api/health', headers: { Host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(421);
  });

  it('blocks path traversal and returns 404', async () => {
    expect((await fetch(`${base}/games/%2e%2e/%2e%2e/package.json`)).status).toBe(404);
    expect((await fetch(`${base}/nope.html`)).status).toBe(404);
  });

  it('protects settings writes with the host secret', async () => {
    const put = (headers: Record<string, string>, body: string) => fetch(`${base}/api/settings`, { method: 'PUT', headers, body });
    expect((await put({ 'Content-Type': 'application/json' }, '{"language":"en"}')).status).toBe(403);
    expect((await put({ 'Content-Type': 'text/plain', 'X-Gameu-Host': app.hostSecret }, '{}')).status).toBe(415);
    expect((await put({ 'Content-Type': 'application/json', 'X-Gameu-Host': app.hostSecret }, '{"language":"fr"}')).status).toBe(400);
    expect((await put({ 'Content-Type': 'application/json', 'X-Gameu-Host': app.hostSecret }, 'x'.repeat(5000))).status).toBe(413);
    const ok = await put({ 'Content-Type': 'application/json', 'X-Gameu-Host': app.hostSecret }, '{"language":"en","textScale":1.5}');
    expect(ok.status).toBe(200);
    const saved = JSON.parse(await fs.readFile(path.join(tmp, 'data', 'settings.json'), 'utf8'));
    expect(saved).toMatchObject({ language: 'en', textScale: 1.5 });
    await put({ 'Content-Type': 'application/json', 'X-Gameu-Host': app.hostSecret }, '{"language":"he","textScale":1}');
  });

  it('gives the host secret to loopback only', async () => {
    const res = await fetch(`${base}/api/host-session`);
    expect(((await res.json()) as { secret: string }).secret).toBe(app.hostSecret);
  });
});

describe('WebSocket flow', () => {
  it('rejects cross-origin WebSocket connections', async () => {
    await expect(openWs('/ws/controller', 'http://evil.example')).rejects.toThrow('HTTP 403');
  });

  it('requires host auth', async () => {
    const ws = await openWs('/ws/host');
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
    ws.send(JSON.stringify({ type: 'auth', secret: 'x'.repeat(32) }));
    expect(await closed).toBe(4401);
  });

  it('host ↔ controller end to end: join, layout, input relay, reconnect', async () => {
    const host = await openWs('/ws/host');
    const hostIn = inbox(host);
    host.send(JSON.stringify({ type: 'auth', secret: app.hostSecret }));
    const room = await hostIn.next<{ code: string; joinUrl: string; qrSvg: string }>('room');
    expect(room.joinUrl).toBe(`http://192.168.50.10:${port}/c?r=${room.code}`);
    expect(room.qrSvg).toContain('<svg');

    // wrong code
    const bad = await openWs('/ws/controller');
    const badIn = inbox(bad);
    bad.send(JSON.stringify({ type: 'join', room: room.code === 'AAAA' ? 'BBBB' : 'AAAA', nickname: 'X', avatar: 0 }));
    expect((await badIn.next<{ code: string }>('error')).code).toBe('bad_room');
    bad.close();

    const phone = await openWs('/ws/controller');
    const phoneIn = inbox(phone);
    phone.send(JSON.stringify({ type: 'input', input: { kind: 'button', id: 'ok', pressed: true } }));
    expect((await phoneIn.next<{ code: string }>('error')).code).toBe('not_joined');
    phone.send(JSON.stringify({ type: 'join', room: room.code.toLowerCase(), nickname: ' Noa ', avatar: 2 }));
    const welcome = await phoneIn.next<{ playerId: string; reconnectToken: string; isAdmin: boolean; nickname: string }>('welcome');
    expect(welcome).toMatchObject({ isAdmin: true, nickname: 'Noa' });
    await hostIn.next<{ players: unknown[] }>('players', (m) => m.players.length === 1);

    host.send(JSON.stringify({ type: 'layout', target: welcome.playerId, layout: { type: 'choices', id: 'answer', options: ['A', 'B'] } }));
    const layout = await phoneIn.next<{ layout: { type: string } }>('layout', (m) => m.layout.type === 'choices');
    expect(layout.layout.type).toBe('choices');

    phone.send(JSON.stringify({ type: 'input', input: { kind: 'choice', id: 'answer', index: 1 } }));
    const input = await hostIn.next<{ playerId: string; input: { index: number } }>('input');
    expect(input).toMatchObject({ playerId: welcome.playerId, input: { index: 1 } });

    // invalid payloads are rejected, not relayed
    phone.send(JSON.stringify({ type: 'input', input: { kind: 'text', id: 't', value: '<img src=x onerror=alert(1)>' } }));
    expect((await phoneIn.next<{ code: string }>('error')).code).toBe('invalid');
    phone.send('not json');
    expect((await phoneIn.next<{ code: string }>('error')).code).toBe('invalid');

    // reconnect with the token keeps the same player id
    phone.close();
    await hostIn.next<{ players: { connected: boolean }[] }>('players', (m) => m.players[0]?.connected === false);
    const phone2 = await openWs('/ws/controller');
    const phone2In = inbox(phone2);
    phone2.send(JSON.stringify({ type: 'join', room: 'AAAA', nickname: 'Noa', avatar: 2, reconnectToken: welcome.reconnectToken }));
    expect((await phone2In.next<{ playerId: string }>('welcome')).playerId).toBe(welcome.playerId);

    // kick
    host.send(JSON.stringify({ type: 'kick', playerId: welcome.playerId }));
    expect((await phone2In.next<{ code: string }>('error')).code).toBe('kicked');
    host.close();
  });

  it('rate-limits floods from a controller', async () => {
    const ws = await openWs('/ws/controller');
    const box = inbox(ws);
    for (let i = 0; i < 400; i++) ws.send(JSON.stringify({ type: 'ping', t: i }));
    expect((await box.next<{ code: string }>('error', (m) => m.code === 'rate_limited')).code).toBe('rate_limited');
    const pongs = box.msgs.filter((m) => m.type === 'pong').length;
    expect(pongs).toBeLessThan(400);
    ws.close();
  });
});
