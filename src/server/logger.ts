import type { LogLevel } from './config';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Minimal structured logger. Callers must never pass secrets, tokens,
 * nicknames, IP addresses or raw message payloads.
 */
export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel, sink: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const min = ORDER[level];
  const log = (lvl: LogLevel) => (event: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[lvl] < min) return;
    sink(JSON.stringify({ t: new Date().toISOString(), level: lvl, event, ...fields }));
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
