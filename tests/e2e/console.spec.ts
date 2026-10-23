import { expect, test, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';

// The console server is shared by all tests: close phone contexts after each test so they disconnect.
const phoneContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(phoneContexts.splice(0).map((c) => c.close()));
});

/** Opens a phone controller in its own browser context (separate localStorage = separate device). */
async function openPhone(browser: Browser, baseURL: string, code: string, nickname: string): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', baseURL });
  phoneContexts.push(ctx);
  const phone = await ctx.newPage();
  await phone.goto(`/c?r=${code}`);
  await phone.getByLabel('כינוי').fill(nickname);
  await phone.getByRole('button', { name: 'הצטרפות' }).click();
  await expect(phone.locator('.bar .me-name')).toHaveText(nickname);
  return phone;
}

async function press(phone: Page, name: string): Promise<void> {
  await phone.getByRole('button', { name, exact: true }).click();
}

async function activeId(host: Page): Promise<string | undefined> {
  return host.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.id);
}

test('TV host + two phones: join, navigate, play trivia, exit, play snake', async ({ page: host, browser, baseURL }) => {
  const errors: string[] = [];
  host.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  host.on('pageerror', (e) => errors.push(e.message));

  await host.goto('/');
  const codeEl = host.locator('.code');
  await expect(codeEl).toHaveText(/^[A-HJ-NP-Z2-9]{4}$/);
  const code = (await codeEl.textContent())!;
  await expect(host.locator('.qr svg')).toBeVisible();
  await expect(host.getByRole('heading', { name: 'משחקים' })).toBeVisible();

  const admin = await openPhone(browser, baseURL!, code, 'Noa');
  await expect(admin.locator('.bar .tag')).toContainText('מנהל/ת');
  const guest = await openPhone(browser, baseURL!, code, 'Dan');
  await expect(guest.locator('.message-text')).toContainText('Noa בוחר/ת משחק');
  await expect(host.locator('#players .player:not(.offline)')).toHaveCount(2);

  // Admin navigates the TV menu with the phone d-pad until Trivia is focused.
  await expect.poll(() => activeId(host)).toMatch(/^game:/);
  for (let i = 0; i < 6 && (await activeId(host)) !== 'game:trivia'; i++) await press(admin, 'שמאלה');
  expect(await activeId(host)).toBe('game:trivia');
  await press(admin, 'אישור');

  const game = host.frameLocator('.game-frame');
  await expect(host.locator('.game-loading')).toHaveCount(0, { timeout: 10_000 });
  await expect(game.locator('.question')).toBeVisible({ timeout: 10_000 });

  // Both phones receive the 4 answers and answer.
  await expect(admin.locator('.choice')).toHaveCount(4);
  await expect(guest.locator('.choice')).toHaveCount(4);
  await admin.locator('.choice').first().click();
  await guest.locator('.choice').nth(1).click();
  await expect(game.locator('#reveal')).not.toBeEmpty();
  await expect(game.locator('.answer.right')).toHaveCount(1);

  // Home button on the admin phone → confirm dialog on TV → quit.
  await press(admin, 'בית');
  const dialog = host.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(admin.locator('.dir')).toHaveCount(4); // admin got the menu pad back
  await press(admin, 'שמאלה');
  await expect.poll(() => host.evaluate(() => document.activeElement?.textContent)).toBe('כן, לצאת');
  await press(admin, 'אישור');
  await expect(dialog).toHaveCount(0);
  await expect(host.getByRole('heading', { name: 'משחקים' })).toBeVisible();

  // Snake: sandboxed game boots under the strict CSP and steers from the phone.
  for (let i = 0; i < 6 && (await activeId(host)) !== 'game:snake'; i++) await press(admin, 'ימינה');
  expect(await activeId(host)).toBe('game:snake');
  await press(admin, 'אישור');
  await expect(host.locator('.game-loading')).toHaveCount(0, { timeout: 10_000 });
  await expect(game.locator('#scores li')).toHaveCount(2);
  await expect(guest.locator('.dir')).toHaveCount(4);
  await press(guest, 'למעלה');

  // Game end → results dialog on the TV → admin returns to the menu.
  const gameFrame = host.frames().find((f) => f.url().includes('/games/snake/'))!;
  await gameFrame.evaluate(() => window.parent.postMessage({ gameu: 1, type: 'end', results: [] }, '*'));
  const results = host.getByRole('dialog', { name: /תוצאות/ });
  await expect(results).toBeVisible();
  await press(admin, 'אישור');
  await expect(results).toHaveCount(0);
  await expect(host.getByRole('heading', { name: 'משחקים' })).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('settings persist and switch the TV to English', async ({ page: host }) => {
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-Z2-9]{4}$/);
  await host.locator('[data-id="settings"]').click();
  await host.locator('[data-id="lang"]').click();
  await expect(host.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(host.locator('html')).toHaveAttribute('dir', 'ltr');
  await host.reload();
  await expect(host.getByRole('heading', { name: 'Games' })).toBeVisible();
  // restore
  await host.locator('[data-id="settings"]').click();
  await host.locator('[data-id="lang"]').click();
  await expect(host.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('controller shows a clear error for a wrong room code', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', baseURL });
  phoneContexts.push(ctx);
  const phone = await ctx.newPage();
  await phone.goto('/c?r=ZZZZ');
  await phone.getByLabel('כינוי').fill('Test');
  await phone.getByRole('button', { name: 'הצטרפות' }).click();
  await expect(phone.getByRole('alert')).toContainText('קוד החדר שגוי');
});

test('draw & guess: drawer draws on the phone, guesser guesses the word', async ({ page: host, browser, baseURL }) => {
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-HJ-NP-Z2-9]{4}$/);
  const code = (await host.locator('.code').textContent())!;
  const a = await openPhone(browser, baseURL!, code, 'Ava');
  const b = await openPhone(browser, baseURL!, code, 'Ben');
  await expect.poll(() => activeId(host)).toMatch(/^game:/);
  for (let i = 0; i < 6 && (await activeId(host)) !== 'game:draw-guess'; i++) await press(a, 'ימינה');
  expect(await activeId(host)).toBe('game:draw-guess');
  await press(a, 'אישור');

  // One of the two phones becomes the drawer.
  await expect.poll(async () => (await a.locator('.draw-canvas').count()) + (await b.locator('.draw-canvas').count()), { timeout: 15_000 }).toBe(1);
  const drawer = (await a.locator('.draw-canvas').count()) ? a : b;
  const guesser = drawer === a ? b : a;
  const prompt = (await drawer.locator('.layout-title').textContent())!;
  const word = prompt.replace(/^ציירו:\s*/, '').trim();
  expect(word.length).toBeGreaterThan(0);

  const box = (await drawer.locator('.draw-canvas').boundingBox())!;
  await drawer.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await drawer.mouse.down();
  for (let i = 1; i <= 10; i++) await drawer.mouse.move(box.x + box.width * (0.2 + i * 0.06), box.y + box.height * (0.5 - Math.sin(i / 2) * 0.2));
  await drawer.mouse.up();

  const input = guesser.getByRole('textbox');
  await input.fill('לא נכון');
  await input.press('Enter');
  await expect(host.frameLocator('.game-frame').locator('#feed li')).toContainText('לא נכון');
  await input.fill(word);
  await input.press('Enter');
  await expect(guesser.locator('.message-text')).toContainText('ניחשת');
  await host.screenshot({ path: 'test-results/screens/draw-guess-tv.png' });
  await drawer.screenshot({ path: 'test-results/screens/draw-guess-phone.png' });
});

test('screenshots of the main screens', async ({ page: host, browser, baseURL }) => {
  await host.setViewportSize({ width: 1920, height: 1080 });
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-HJ-NP-Z2-9]{4}$/);
  const code = (await host.locator('.code').textContent())!;
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', baseURL });
  phoneContexts.push(ctx);
  const join = await ctx.newPage();
  await join.goto(`/c?r=${code}`);
  await join.screenshot({ path: 'test-results/screens/phone-join.png' });
  const p = await openPhone(browser, baseURL!, code, 'נועה');
  await openPhone(browser, baseURL!, code, 'דני');
  await expect(host.locator('#players .player:not(.offline)')).toHaveCount(2);
  await host.screenshot({ path: 'test-results/screens/tv-home.png' });
  await p.screenshot({ path: 'test-results/screens/phone-menu.png' });
});
