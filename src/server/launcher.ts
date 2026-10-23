import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';

/** Known Chromium-family browser locations; first existing one wins. */
function candidates(): string[] {
  const env = process.env;
  switch (process.platform) {
    case 'win32': {
      const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter((r): r is string => !!r);
      return roots.flatMap((r) => [
        path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(r, 'Chromium', 'Application', 'chrome.exe'),
      ]);
    }
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ];
    default:
      return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
  }
}

export function findBrowser(): string | null {
  const override = process.env.GAMEU_BROWSER;
  if (override && fs.existsSync(override)) return override;
  return candidates().find((c) => fs.existsSync(c)) ?? null;
}

/**
 * Opens the TV screen full-screen. Uses an isolated browser profile on the USB drive
 * so nothing is written to the host computer's own browser profile.
 * Arguments are passed as an array (no shell), so nothing here is shell-interpreted.
 */
export function openKiosk(url: string, dataDir: string, log: Logger): void {
  const browser = findBrowser();
  if (browser) {
    const profile = path.join(dataDir, 'browser-profile');
    const args = [
      `--app=${url}`,
      '--kiosk',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-translate',
      '--disable-features=Translate',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-pinch',
      '--overscroll-history-navigation=0',
    ];
    const child = spawn(browser, args, { stdio: 'ignore', detached: true });
    child.on('error', () => log.warn('kiosk_launch_failed'));
    child.on('spawn', () => log.info('kiosk_opened', { browser: path.basename(browser) }));
    child.unref();
    return;
  }
  // Fallback: system default browser (user presses F11 for full screen).
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
  child.on('error', () => log.warn('browser_open_failed', { hint: 'open the TV screen URL manually' }));
  child.on('spawn', () => log.info('default_browser_opened'));
  child.unref();
}
