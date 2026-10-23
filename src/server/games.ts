import fs from 'node:fs/promises';
import path from 'node:path';
import { GameManifestSchema, type GameManifest } from '../shared/protocol';
import type { Logger } from './logger';

/** Loads and validates every `games/<id>/manifest.json`. Invalid games are skipped, not fatal. */
export async function loadGames(gamesDir: string, log: Logger): Promise<GameManifest[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(gamesDir);
  } catch {
    log.warn('games_dir_missing', { gamesDir });
    return [];
  }
  const games: GameManifest[] = [];
  for (const dir of entries.sort()) {
    const manifestPath = path.join(gamesDir, dir, 'manifest.json');
    try {
      const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
      const manifest = GameManifestSchema.parse(raw);
      if (manifest.id !== dir) throw new Error('manifest id must match folder name');
      if (manifest.minPlayers > manifest.maxPlayers) throw new Error('minPlayers > maxPlayers');
      await fs.access(path.join(gamesDir, dir, manifest.entry));
      games.push(manifest);
    } catch (err) {
      log.warn('game_skipped', { game: dir, reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
    }
  }
  log.info('games_loaded', { count: games.length });
  return games;
}
