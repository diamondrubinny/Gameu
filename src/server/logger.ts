import type { Logger } from '../core/logger';
import type { LogLevel } from './config';

export type { Logger } from '../core/logger';
export { silentLogger } from '../core/logger';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level: LogLevel, sink: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const min = ORDER[level];
  const log = (lvl: LogLevel) => (event: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[lvl] < min) return;
    sink(JSON.stringify({ t: new Date().toISOString(), level: lvl, event, ...fields }));
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}
