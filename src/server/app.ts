import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import QRCode from 'qrcode';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import {
  ControllerToServerSchema,
  HostToServerSchema,
  LIMITS,
  type GameManifest,
  type ServerToController,
  type ServerToHost,
} from '../shared/protocol';
import type { AppConfig } from './config';
import type { Logger } from './logger';
import { lanAddresses, isLoopback } from './network';
import { FailureLimiter } from './rate-limit';
import { createMessageBudget, Room, type Peer } from './room';
import { applySecurityHeaders, clientIp, isAllowedHostHeader, isSameOrigin } from './security';
import type { SettingsStore } from './settings';
import { safeResolve, serveFile } from './static';
import { randomToken, safeEqual } from './tokens';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  settings: SettingsStore;
  games: GameManifest[];
  room?: Room;
  /** Overrides LAN detection (tests). */
  lanIps?: () => string[];
}

export interface App {
  server: http.Server;
  room: Room;
  hostSecret: string;
  joinUrl(): string;
  close(): Promise<void>;
}

const MAX_BODY = 4 * 1024;
const MAX_CONTROLLER_CONNECTIONS = 32;
const MAX_CONNECTIONS_PER_IP = 6;
const MAX_INVALID_MESSAGES = 20;
const HEARTBEAT_MS = 15_000;
const HOST_AUTH_TIMEOUT_MS = 5_000;

export function createApp(deps: AppDeps): App {
  const { config, logger: log, settings, games } = deps;
  const room = deps.room ?? new Room({ logger: log });
  const hostSecret = randomToken();
  const joinLimiter = new FailureLimiter(8, 60_000, 60_000);
  const connectionsPerIp = new Map<string, number>();
  const publicDir = path.join(config.appRoot, 'public');
  const gamesDir = path.join(config.appRoot, 'games');
  const getLanIps = deps.lanIps ?? (() => lanAddresses());

  let boundPort = config.port;

  const joinUrl = (): string => {
    const ip = getLanIps()[0] ?? 'localhost';
    return `http://${ip}:${boundPort}/c?r=${room.code}`;
  };

  /** Host-only HTTP access: the console computer itself, or a request carrying the configured host key. */
  const isHostRequest = (req: IncomingMessage, url: URL): boolean => {
    if (isLoopback(req.socket.remoteAddress)) return true;
    if (!config.hostKey) return false;
    const key = url.searchParams.get('key') ?? headerValue(req, 'x-gameu-key');
    return !!key && safeEqual(key, config.hostKey);
  };

  // ---------------- HTTP ----------------

  const server = http.createServer((req, res) => {
    handleHttp(req, res).catch((err: unknown) => {
      log.error('http_error', { message: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      else res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAllowedHostHeader(req.headers.host)) {
      sendText(res, 421, 'Misdirected request');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const p = url.pathname;

    // --- API ---
    if (p.startsWith('/api/')) {
      if (p === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true });
      if (p === '/api/games' && method === 'GET') return sendJson(res, 200, { games });
      if (p === '/api/settings' && method === 'GET') return sendJson(res, 200, { settings: settings.get() });
      if (p === '/api/host-session' && method === 'GET') {
        if (!isHostRequest(req, url)) return sendJson(res, 403, { error: 'forbidden' });
        return sendJson(res, 200, { secret: hostSecret });
      }
      if (p === '/api/settings' && method === 'PUT') {
        // Custom header + secret: blocks CSRF from other sites (would require a CORS preflight we never grant).
        const secret = headerValue(req, 'x-gameu-host');
        if (!secret || !safeEqual(secret, hostSecret)) return sendJson(res, 403, { error: 'forbidden' });
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return sendJson(res, 415, { error: 'unsupported_media_type' });
        const body = await readBody(req, MAX_BODY);
        if (body === null) return sendJson(res, 413, { error: 'payload_too_large' });
        let patch: unknown;
        try {
          patch = JSON.parse(body);
        } catch {
          return sendJson(res, 400, { error: 'invalid_json' });
        }
        try {
          return sendJson(res, 200, { settings: await settings.update(patch) });
        } catch {
          return sendJson(res, 400, { error: 'invalid_settings' });
        }
      }
      return sendJson(res, 404, { error: 'not_found' });
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendText(res, 405, 'Method not allowed');
    }

    // --- pages & assets ---
    if (p === '/' || p === '/index.html') {
      if (!isHostRequest(req, url)) {
        // A phone opened the console address: send it to the controller.
        res.statusCode = 302;
        res.setHeader('Location', '/c');
        applySecurityHeaders(res, 'api');
        return void res.end();
      }
      if (await serveFile(res, path.join(publicDir, 'host', 'index.html'), 'host', method)) return;
    } else if (p === '/c' || p === '/c/') {
      if (await serveFile(res, path.join(publicDir, 'c', 'index.html'), 'controller', method)) return;
    } else if (p.startsWith('/games/')) {
      const file = safeResolve(gamesDir, p.slice('/games/'.length));
      if (file && (await serveFile(res, file, 'game', method))) return;
    } else if (p === '/favicon.ico') {
      res.statusCode = 204;
      return void res.end();
    } else {
      const file = safeResolve(publicDir, p);
      const kind = p.startsWith('/c/') ? 'controller' : p.startsWith('/host/') ? 'host' : 'static';
      if (file && (await serveFile(res, file, kind, method))) return;
    }
    await serveNotFound(res, method);
  }

  async function serveNotFound(res: ServerResponse, method: string): Promise<void> {
    const file = path.join(publicDir, '404.html');
    if (await serveFile(res, file, 'static', method, 404)) return;
    sendText(res, 404, 'Not found');
  }

  // ---------------- WebSocket ----------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxMessageBytes, perMessageDeflate: false });
  const alive = new WeakMap<WebSocket, boolean>();

  server.on('upgrade', (req, socket, head) => {
    const reject = (status: number) => {
      socket.write(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? ''}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!isAllowedHostHeader(req.headers.host) || !isSameOrigin(req)) return reject(403);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ip = clientIp(req);

    if (url.pathname === '/ws/host') {
      if (!isLoopback(ip) && !config.hostKey) return reject(403);
      wss.handleUpgrade(req, socket, head, (ws) => onHost(ws));
      return;
    }
    if (url.pathname === '/ws/controller') {
      const count = connectionsPerIp.get(ip) ?? 0;
      if (count >= MAX_CONNECTIONS_PER_IP || totalControllers() >= MAX_CONTROLLER_CONNECTIONS) return reject(429);
      if (joinLimiter.isBlocked(ip)) return reject(429);
      connectionsPerIp.set(ip, count + 1);
      wss.handleUpgrade(req, socket, head, (ws) => onController(ws, ip));
      return;
    }
    reject(404);
  });

  function totalControllers(): number {
    let n = 0;
    for (const v of connectionsPerIp.values()) n += v;
    return n;
  }

  function track(ws: WebSocket): void {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
  }

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  function peerOf<T>(ws: WebSocket): Peer<T> {
    return {
      send: (msg: T) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: (code, reason) => ws.close(code, reason),
    };
  }

  function onHost(ws: WebSocket): void {
    track(ws);
    const peer = peerOf<ServerToHost>(ws);
    let authed = false;
    const authTimer = setTimeout(() => {
      if (!authed) ws.close(4401, 'auth timeout');
    }, HOST_AUTH_TIMEOUT_MS);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      const parsed = isBinary ? null : parseJson(data);
      const result = parsed === null ? null : HostToServerSchema.safeParse(parsed);
      if (!result || !result.success) {
        peer.send({ type: 'error', code: 'invalid' });
        if (!authed) ws.close(4400, 'invalid');
        return;
      }
      const msg = result.data;
      if (!authed) {
        if (msg.type !== 'auth' || !safeEqual(msg.secret, hostSecret)) {
          peer.send({ type: 'error', code: 'unauthorized' });
          ws.close(4401, 'unauthorized');
          return;
        }
        authed = true;
        clearTimeout(authTimer);
        room.attachHost(peer);
        void sendRoom(peer);
        return;
      }
      if (msg.type === 'auth') return;
      room.handleHostMessage(msg);
      if (msg.type === 'new_code' || msg.type === 'lock') void sendRoom(peer);
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (authed) room.detachHost(peer);
    });
    ws.on('error', () => ws.terminate());
  }

  async function sendRoom(peer: Peer<ServerToHost>): Promise<void> {
    const url = joinUrl();
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
    const urls = getLanIps().map((ip) => `http://${ip}:${boundPort}/c`);
    peer.send({ type: 'room', code: room.code, urls, joinUrl: url, qrSvg, locked: room.locked });
  }

  function onController(ws: WebSocket, ip: string): void {
    track(ws);
    const peer = peerOf<ServerToController>(ws);
    const budget = createMessageBudget();
    let playerId: string | null = null;
    let invalid = 0;
    let lastRateNotice = 0;

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (!budget.take()) {
        const t = Date.now();
        if (t - lastRateNotice > 1000) {
          peer.send({ type: 'error', code: 'rate_limited' });
          lastRateNotice = t;
        }
        return;
      }
      const parsed = isBinary ? null : parseJson(data);
      const result = parsed === null ? null : ControllerToServerSchema.safeParse(parsed);
      if (!result || !result.success) {
        invalid += 1;
        peer.send({ type: 'error', code: 'invalid' });
        if (invalid > MAX_INVALID_MESSAGES) ws.close(1008, 'too many invalid messages');
        return;
      }
      const msg = result.data;
      switch (msg.type) {
        case 'ping':
          peer.send({ type: 'pong', t: msg.t });
          return;
        case 'join': {
          if (playerId) return;
          if (joinLimiter.isBlocked(ip)) {
            peer.send({ type: 'error', code: 'rate_limited' });
            ws.close(4029, 'rate limited');
            return;
          }
          const out = room.join(peer, msg);
          if (out.ok) {
            playerId = out.playerId;
          } else {
            if (out.code === 'bad_room') joinLimiter.fail(ip);
            peer.send({ type: 'error', code: out.code });
          }
          return;
        }
        case 'input':
          if (!playerId) {
            peer.send({ type: 'error', code: 'not_joined' });
            return;
          }
          room.handleInput(playerId, msg.input);
          return;
      }
    });
    ws.on('close', () => {
      const n = (connectionsPerIp.get(ip) ?? 1) - 1;
      if (n <= 0) connectionsPerIp.delete(ip);
      else connectionsPerIp.set(ip, n);
      if (playerId) room.disconnect(playerId, peer);
    });
    ws.on('error', () => ws.terminate());
  }

  server.on('listening', () => {
    const addr = server.address();
    if (addr && typeof addr === 'object') boundPort = addr.port;
  });

  return {
    server,
    room,
    hostSecret,
    joinUrl,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// ---------------- helpers ----------------

function parseJson(data: RawData): unknown {
  try {
    const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function headerValue(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let tooLarge = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  applySecurityHeaders(res, 'api');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  applySecurityHeaders(res, 'api');
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}
