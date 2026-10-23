import path from 'node:path';
import QRCode from 'qrcode';
import { createApp } from './app';
import { loadConfig } from './config';
import { loadGames } from './games';
import { openKiosk } from './launcher';
import { createLogger } from './logger';
import { SettingsStore } from './settings';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const settings = new SettingsStore(config.dataDir, log);
  await settings.load();
  const games = await loadGames(path.join(config.appRoot, 'games'), log);
  const app = createApp({ config, logger: log, settings, games });

  app.server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`\nPort ${config.port} is already in use. Is Gameu already running? Set PORT=<other> to change it.\n`);
    } else {
      log.error('server_error', { code: err.code });
    }
    process.exit(1);
  });

  app.server.listen(config.port, config.bindAddress, async () => {
    const tvUrl = `http://localhost:${config.port}/`;
    const joinUrl = app.joinUrl();
    log.info('listening', { port: config.port });
    const qr = await QRCode.toString(joinUrl, { type: 'terminal', small: true });
    process.stdout.write(
      [
        '',
        '  ███ Gameu console is running ███',
        `  TV screen : ${tvUrl}`,
        `  Phones    : ${joinUrl}`,
        config.hostKey ? '  Remote TV : http://<this-ip>:' + config.port + '/?key=<GAMEU_HOST_KEY>' : '',
        '',
        qr,
        '  Press Ctrl+C to stop.',
        '',
      ]
        .filter((l) => l !== '')
        .join('\n') + '\n',
    );
    if (config.kiosk) openKiosk(tvUrl, config.dataDir, log);
  });

  const shutdown = (signal: string) => {
    log.info('shutdown', { signal });
    void app.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}\n`);
});

main().catch((err: unknown) => {
  process.stderr.write(`Failed to start Gameu: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
