import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { applySecurityHeaders, type PageKind } from './security';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Resolves `relPath` inside `root`, rejecting traversal, dotfiles and unknown types.
 * Returns null when the path is not servable.
 */
export function safeResolve(root: string, relPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s.startsWith('.'))) return null;
  const resolved = path.resolve(root, ...segments);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) return null;
  if (!MIME[path.extname(resolved).toLowerCase()]) return null;
  return resolved;
}

export async function serveFile(res: ServerResponse, filePath: string, kind: PageKind, method: string, status = 200): Promise<boolean> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  applySecurityHeaders(res, kind);
  res.statusCode = status;
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=300');
  if (method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise<void>((resolve) => {
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    stream.on('end', () => resolve());
    stream.pipe(res);
  });
  return true;
}
