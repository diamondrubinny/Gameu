import path from 'node:path';

export interface AppConfig {
  port: number;
  bindAddress: string;
  hostKey: string | null;
  dataDir: string;
  appRoot: string;
  logLevel: LogLevel;
  kiosk: boolean;
  /** How long a disconnected phone keeps its slot (reconnect window). */
  reconnectGraceMs: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Resolves the app root (folder that contains `public/` and `games/`). */
export function resolveAppRoot(): string {
  // Bundled: dist/server/server.cjs -> dist/
  return path.resolve(__dirname, '..');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): AppConfig {
  const appRoot = env.GAMEU_APP_ROOT ? path.resolve(env.GAMEU_APP_ROOT) : resolveAppRoot();
  const port = parsePort(env.PORT ?? '8080');
  const hostKey = (env.GAMEU_HOST_KEY ?? '').trim();
  if (hostKey && hostKey.length < 16) {
    throw new Error('GAMEU_HOST_KEY must be at least 16 characters long');
  }
  const level = (env.LOG_LEVEL ?? 'info') as LogLevel;
  return {
    port,
    bindAddress: env.BIND_ADDRESS?.trim() || '0.0.0.0',
    hostKey: hostKey || null,
    dataDir: env.GAMEU_DATA_DIR?.trim() ? path.resolve(env.GAMEU_DATA_DIR) : path.resolve(appRoot, '..', 'data'),
    appRoot,
    logLevel: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
    kiosk: argv.includes('--kiosk'),
    reconnectGraceMs: parseGrace(env.GAMEU_RECONNECT_GRACE_MS),
  };
}

function parseGrace(raw: string | undefined): number {
  if (!raw?.trim()) return 120_000;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 1000 || ms > 600_000) throw new Error(`Invalid GAMEU_RECONNECT_GRACE_MS: ${raw} (1000..600000)`);
  return ms;
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}
