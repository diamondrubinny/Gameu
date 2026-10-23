import type { IncomingMessage, ServerResponse } from 'node:http';
import net from 'node:net';

const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

const COMMON_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";

/** Game assets and the SDK omit CORP: sandboxed games have an opaque origin and load them cross-origin. */
export type PageKind = 'host' | 'controller' | 'game' | 'static' | 'api';

export function applySecurityHeaders(res: ServerResponse, kind: PageKind): void {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  switch (kind) {
    case 'host':
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Content-Security-Policy', `${COMMON_CSP}; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'`);
      res.setHeader('X-Frame-Options', 'DENY');
      break;
    case 'controller':
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Content-Security-Policy', `${COMMON_CSP}; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'`);
      res.setHeader('X-Frame-Options', 'DENY');
      break;
    case 'game':
      // Games run sandboxed (opaque origin) even when opened directly, and may not open network connections.
      res.setHeader('Content-Security-Policy', `sandbox allow-scripts; ${COMMON_CSP}; connect-src 'none'; frame-src 'none'; frame-ancestors 'self'`);
      break;
    case 'static':
      res.setHeader('Content-Security-Policy', `${COMMON_CSP}; connect-src 'none'; frame-ancestors 'self'`);
      break;
    case 'api':
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      res.setHeader('Cache-Control', 'no-store');
      break;
  }
}

/**
 * DNS-rebinding guard: only accept requests addressed to localhost or an IP literal.
 * A hostile website cannot make a browser send such a Host header from its own origin.
 */
export function isAllowedHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  if (hostname === 'localhost') return true;
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return net.isIP(bare) !== 0;
}

/** Cross-site WebSocket hijacking guard: Origin must match the Host the browser connected to. */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}
