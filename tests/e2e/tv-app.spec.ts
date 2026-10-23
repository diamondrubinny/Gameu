import fs from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Simulates the Android TV app in Chromium: the bundled assets are served at
 * https://appassets.androidplatform.net with the same headers as AssetPolicy.kt,
 * and a fake `gameuNative` bridge stands in for the WebMessageListener.
 */
const ORIGIN = 'https://appassets.androidplatform.net';
const DIST = path.resolve('dist');
const COMMON_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function headersFor(p: string): Record<string, string> {
  const h: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  if (p.startsWith('/games/') && p.endsWith('.html')) h['Content-Security-Policy'] = `sandbox allow-scripts; ${COMMON_CSP}; connect-src 'none'; frame-src 'none'; frame-ancestors 'self'`;
  else if (p.startsWith('/tv/')) h['Content-Security-Policy'] = `${COMMON_CSP}; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'`;
  else if (p.endsWith('.html')) h['Content-Security-Policy'] = `${COMMON_CSP}; connect-src 'none'; frame-ancestors 'self'`;
  return h;
}

async function serveAsset(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const p = decodeURIComponent(url.pathname);
  if (p.includes('..')) return route.fulfill({ status: 404, body: 'Not found' });
  const file = p.startsWith('/games/') ? path.join(DIST, p) : path.join(DIST, 'public', p);
  try {
    const body = await fs.readFile(file);
    return route.fulfill({ status: 200, body, headers: { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', ...headersFor(p) } });
  } catch {
    return route.fulfill({ status: 404, body: 'Not found' });
  }
}

async function openTvApp(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, serveAsset);
  await page.addInitScript(() => {
    if (!location.pathname.startsWith('/tv/')) return; // the real bridge is main-frame/origin only
    const listeners: ((e: { data: string }) => void)[] = [];
    const w = window as unknown as Record<string, unknown>;
    w.__nativeOut = [] as string[];
    w.__nativeSend = (obj: unknown) => listeners.forEach((l) => l({ data: JSON.stringify(obj) }));
    w.gameuNative = {
      postMessage(m: string) {
        (w.__nativeOut as string[]).push(m);
        if (JSON.parse(m).t === 'hello') setTimeout(() => (w.__nativeSend as (o: unknown) => void)({ t: 'info', lanIps: ['192.168.1.44'], port: 8080, version: '0.2.0' }), 10);
      },
      addEventListener(_type: string, l: (e: { data: string }) => void) {
        listeners.push(l);
      },
    };
  });
  await page.goto(`${ORIGIN}/tv/index.html`);
}

const nativeOut = (page: Page) => page.evaluate(() => ((window as unknown as { __nativeOut: string[] }).__nativeOut ?? []).map((m) => JSON.parse(m).t as string));
const sendNative = (page: Page, msg: unknown) => page.evaluate((m) => (window as unknown as { __nativeSend: (o: unknown) => void }).__nativeSend(m), msg);

test.describe('Android TV app (simulated WebView)', () => {
  test('shows the console with the TV IP in the QR link and the bundled games', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openTvApp(page);
    await expect(page.locator('.code')).toHaveText(/^[A-HJ-NP-Z2-9]{4}$/);
    await expect(page.locator('.url bdi')).toHaveText('http://192.168.1.44:8080/c');
    await expect(page.locator('.qr svg')).toBeVisible();
    await expect(page.locator('.card[data-id^="game:"]')).toHaveCount(3);
    expect(await nativeOut(page)).toContain('hello');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('remote Back: settings → home, and exits the app from home', async ({ page }) => {
    await openTvApp(page);
    await expect(page.locator('.code')).toHaveText(/^[A-Z2-9]{4}$/);
    await page.locator('[data-id="settings"]').click();
    await expect(page.locator('[data-id="lang"]')).toBeVisible();
    await sendNative(page, { t: 'back' });
    await expect(page.locator('[data-id="settings"]')).toBeVisible();
    expect(await nativeOut(page)).not.toContain('exit');
    await sendNative(page, { t: 'back' });
    await expect.poll(() => nativeOut(page)).toContain('exit');
  });

  test('settings persist in the app storage', async ({ page }) => {
    await openTvApp(page);
    await page.locator('[data-id="settings"]').click();
    await page.locator('[data-id="lang"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Games' })).toBeVisible();
  });

  test('a sandboxed game starts with a player from the in-process room and cannot see the native bridge', async ({ page }) => {
    await openTvApp(page);
    await expect(page.locator('.code')).toHaveText(/^[A-Z2-9]{4}$/);
    // Stand-in for a phone until the native socket server lands (T3): join the in-process room directly.
    const playerId = await page.evaluate(() => {
      const tv = (window as unknown as { gameuTv: { platform: { room: { code: string; join: (p: unknown, m: unknown) => { ok: boolean; playerId: string }; handleInput: (id: string, i: unknown) => void } } } }).gameuTv;
      const room = tv.platform.room;
      const out = room.join({ send() {}, close() {} }, { type: 'join', room: room.code, nickname: 'Remote', avatar: 4 });
      (window as unknown as { __pid: string }).__pid = out.playerId;
      return out.playerId;
    });
    expect(playerId).toBeTruthy();
    await expect(page.locator('#players .player')).toHaveCount(1);
    await page.locator('[data-id="game:snake"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.game-loading')).toHaveCount(0, { timeout: 10_000 });
    const frame = page.frameLocator('.game-frame');
    await expect(frame.locator('#scores li')).toHaveCount(1);
    // The sandboxed game must not see the native bridge.
    const gameFrame = page.frames().find((f) => f.url().includes('/games/snake/'))!;
    expect(await gameFrame.evaluate(() => typeof (window as unknown as { gameuNative?: unknown }).gameuNative)).toBe('undefined');
    expect(await gameFrame.evaluate(() => String(window.origin))).toBe('null');
  });

  test('TV page has no WCAG 2.1 AA violations (axe)', async ({ page }) => {
    await openTvApp(page);
    await expect(page.locator('.code')).toHaveText(/^[A-Z2-9]{4}$/);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
