import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '../shared/protocol';
import type { Logger } from './logger';

/** Console settings persisted as JSON on the USB drive (falls back to memory if read-only). */
export class SettingsStore {
  private current: Settings = DEFAULT_SETTINGS;
  private readonly file: string;

  constructor(dataDir: string, private readonly log: Logger) {
    this.file = path.join(dataDir, 'settings.json');
  }

  async load(): Promise<Settings> {
    try {
      const parsed = SettingsSchema.safeParse(JSON.parse(await fs.readFile(this.file, 'utf8')));
      if (parsed.success) this.current = parsed.data;
      else this.log.warn('settings_invalid_using_defaults');
    } catch {
      // first run or unreadable: defaults
    }
    return this.current;
  }

  get(): Settings {
    return this.current;
  }

  async update(patch: unknown): Promise<Settings> {
    const next = SettingsSchema.parse({ ...this.current, ...(typeof patch === 'object' && patch ? patch : {}) });
    this.current = next;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(tmp, this.file);
    } catch {
      this.log.warn('settings_not_persisted');
    }
    return next;
  }
}
