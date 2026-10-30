import { CATEGORIES } from '../../games/trivia/categories';
import { expect, test, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';

// The console server is shared by all tests: close phone contexts after each test so they disconnect.
const phoneContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(phoneContexts.splice(0).map((c) => c.close()));
  // The e2e server keeps disconnected players for 1s (GAMEU_RECONNECT_GRACE_MS); let them expire.
  await new Promise((r) => setTimeout(r, 1500));
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
  // Contest setup: the admin picks a topic with the phone d-pad, then starts.
  await expect(game.locator('.setup')).toBeVisible({ timeout: 10_000 });
  await expect(guest.locator('.message-text')).toContainText('בוחר/ת נושאים');
  await expect(game.locator('#opt-start')).toHaveClass(/focused/);
  await expect(game.locator('#setup-hint')).toContainText('Noa');
  for (let i = 0; i < 12 && !(await game.locator('.cat.focused').count()); i++) await press(admin, 'למעלה');
  const topic = game.locator('.cat.focused');
  await expect(topic).toHaveCount(1);
  if ((await topic.getAttribute('data-cat')) === 'all') await press(admin, 'ימינה');
  const chosen = (await game.locator('.cat.focused').getAttribute('data-cat'))!;
  await press(admin, 'בחירה');
  await expect(game.locator(`.cat[data-cat="${chosen}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(game.locator('.cat[data-cat="all"]')).toHaveAttribute('aria-pressed', 'false');
  for (let i = 0; i < 12 && !(await game.locator('#opt-start.focused').count()); i++) await press(admin, 'למטה');
  for (let i = 0; i < 6 && !(await game.locator('#opt-start.focused').count()); i++) await press(admin, 'שמאלה');
  await expect(game.locator('#opt-start')).toHaveClass(/focused/);
  await press(admin, 'בחירה');
  await expect(game.locator('.question')).toBeVisible({ timeout: 12_000 });
  // The question belongs to the chosen topic.
  const topicInfo = CATEGORIES.find((c) => c.id === chosen)!;
  await expect(game.locator('.meta .badge').first()).toHaveText(`${topicInfo.icon} ${topicInfo.he}`);

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

test('TV language cycles through all 6 languages, persists, and sets direction', async ({ page: host }) => {
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-Z2-9]{4}$/);
  await host.locator('[data-id="settings"]').click();
  const html = host.locator('html');
  const expected: [string, 'rtl' | 'ltr'][] = [['en', 'ltr'], ['ar', 'rtl'], ['ru', 'ltr'], ['es', 'ltr'], ['fr', 'ltr'], ['he', 'rtl']];
  for (const [code, dir] of expected) {
    await host.locator('[data-id="lang"]').click();
    await expect(html).toHaveAttribute('lang', code);
    await expect(html).toHaveAttribute('dir', dir);
    // The settings heading is translated (not left in another language).
    if (code === 'en') await expect(host.getByRole('heading', { name: 'Settings' })).toBeVisible();
    if (code === 'he') await expect(host.getByRole('heading', { name: 'הגדרות' })).toBeVisible();
    if (code === 'en') {
      await host.reload();
      await expect(host.getByRole('heading', { name: 'Games' })).toBeVisible();
      await host.locator('[data-id="settings"]').click();
    }
  }
});

test('the TV selection mark is always drawn and survives re-renders', async ({ page: host, browser, baseURL }) => {
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-HJ-NP-Z2-9]{4}$/);
  const code = (await host.locator('.code').textContent())!;
  const marked = host.locator('[data-nav].nav-focus');
  await expect(marked).toHaveCount(1);
  const admin = await openPhone(browser, baseURL!, code, 'Mia');
  // Move off the first item, then make the TV re-render (a second player joins).
  await press(admin, 'שמאלה');
  const before = await marked.getAttribute('data-id');
  await openPhone(browser, baseURL!, code, 'Ori');
  await expect(host.locator('#players .player:not(.offline)')).toHaveCount(2);
  await expect(marked).toHaveCount(1);
  expect(await marked.getAttribute('data-id')).toBe(before);
  // Even when DOM focus is lost (window not focused), the mark stays and OK still works.
  await host.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(marked).toHaveCount(1);
  await expect(marked).not.toHaveCSS('box-shadow', 'none');
  await press(admin, 'ימינה');
  await expect(marked).toHaveCount(1);
});

test('each phone gets trivia in its own language while the TV stays in Hebrew', async ({ page: host, browser, baseURL }) => {
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-HJ-NP-Z2-9]{4}$/);
  const code = (await host.locator('.code').textContent())!;
  const he = await openPhone(browser, baseURL!, code, 'Noa');
  // Second phone switches to English on the join screen before joining.
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', baseURL });
  phoneContexts.push(ctx);
  const en = await ctx.newPage();
  await en.goto(`/c?r=${code}`);
  await en.locator('#lang-select').selectOption('en');
  await expect(en.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(en.getByLabel('Nickname')).toBeVisible();
  await en.getByLabel('Nickname').fill('Sam');
  await en.getByRole('button', { name: 'Join' }).click();
  await expect(en.locator('.bar .me-name')).toHaveText('Sam');
  await expect(en.locator('.message-text')).toContainText('is choosing');

  for (let i = 0; i < 6 && (await activeId(host)) !== 'game:trivia'; i++) await press(he, 'שמאלה');
  await press(he, 'אישור');
  const game = host.frameLocator('.game-frame');
  await expect(game.locator('#opt-start')).toHaveClass(/focused/, { timeout: 10_000 });
  await expect(en.locator('.message-text')).toContainText('is choosing topics');
  await press(he, 'בחירה');
  await expect(game.locator('.question')).toBeVisible({ timeout: 12_000 });

  // TV in Hebrew, English phone gets the English text with the same answer order.
  const tvQuestion = (await game.locator('.question').textContent())!;
  expect(tvQuestion).toMatch(/[\u0590-\u05FF]/);
  await expect(en.locator('.choice')).toHaveCount(4);
  const enPrompt = (await en.locator('.layout-title').textContent())!;
  expect(enPrompt).not.toMatch(/[\u0590-\u05FF]/);
  expect(enPrompt).toMatch(/[A-Za-z]/);
  await expect(he.locator('.layout-title')).toHaveText(tvQuestion);

  // Both pick the same position → both get the same result (correct or not).
  await he.locator('.choice').nth(2).click();
  await en.locator('.choice').nth(2).click();
  await expect(he.locator('.message-text')).toBeVisible();
  const heResult = (await he.locator('.message-text').textContent())!;
  const enResult = (await en.locator('.message-text').textContent())!;
  expect(heResult.startsWith('נכון')).toBe(enResult.startsWith('Correct'));
  await press(he, 'בית');
  await press(he, 'שמאלה');
  await press(he, 'אישור');
});

test('a phone can switch language mid-game from its settings', async ({ page: host, browser, baseURL }) => {
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-HJ-NP-Z2-9]{4}$/);
  const code = (await host.locator('.code').textContent())!;
  const phone = await openPhone(browser, baseURL!, code, 'Lea');
  await phone.getByRole('button', { name: 'הגדרות שלט' }).click();
  await phone.locator('#lang-select').selectOption('en');
  await expect(phone.locator('html')).toHaveAttribute('lang', 'en');
  // The TV re-sends the menu in the phone's new language.
  await expect(phone.locator('.layout-title')).toHaveText('Choose a game');
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
