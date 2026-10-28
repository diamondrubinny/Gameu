import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { LIMITS, type GameManifest, type ServerToHost } from '../shared/protocol';
import { ConnectionGate, ControllerSession } from '../core/controller-session';
import { HostSession } from '../core/host-session';
import { randomToken, safeEqual } from '../core/random';
import { Room, type Peer } from '../core/room';
import { buildRoomInfo } from '../core/room-info';
import type { TextTransport } from '../core/transport';
import type { AppConfig } from './config';
import type { Logger } from './logger';
import { lanAddresses, isLoopback } from './network';
import { applySecurityHeaders, clientIp, isAllowedHostHeader, isSameOrigin } from './security';
import type { SettingsStore } from './settings';
import { safeResolve, serveFile } from './static';

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
const HEARTBEAT_MS = 15_000;

export function createApp(deps: AppDeps): App {
  const { config, logger: log, settings, games } = deps;
  const room = deps.room ?? new Room({ logger: log, reconnectGraceMs: config.reconnectGraceMs });
  const hostSecret = randomToken();
  const gate = new ConnectionGate();
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
      if (!gate.admit(ip)) return reject(429);
      // Release the reserved slot if the handshake fails before a session exists.
      let upgraded = false;
      socket.once('close', () => {
        if (!upgraded) gate.release(ip);
      });
      wss.handleUpgrade(req, socket, head, (ws) => {
        upgraded = true;
        onController(ws, ip);
      });
      return;
    }
    reject(404);
  });

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

  function transportOf(ws: WebSocket): TextTransport {
    return {
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      close: (code, reason) => ws.close(code, reason),
    };
  }

  function sendRoom(peer: Peer<ServerToHost>): void {
    void buildRoomInfo(room, getLanIps(), boundPort).then((info) => peer.send(info));
  }

  function onHost(ws: WebSocket): void {
    track(ws);
    const session = new HostSession(room, transportOf(ws), hostSecret, sendRoom);
    ws.on('message', (data: RawData, isBinary: boolean) => session.handleText(isBinary ? null : rawToText(data)));
    ws.on('close', () => session.handleClose());
    ws.on('error', () => ws.terminate());
  }

  function onController(ws: WebSocket, ip: string): void {
    track(ws);
    const session = new ControllerSession(room, transportOf(ws), ip, gate);
    ws.on('message', (data: RawData, isBinary: boolean) => session.handleText(isBinary ? null : rawToText(data)));
    ws.on('close', () => session.handleClose());
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

function rawToText(data: RawData): string {
  return Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
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
