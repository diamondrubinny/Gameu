import AxeBuilder from '@axe-core/playwright';
import { expect, test, devices, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = result.violations.map((v) => `${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, summary.join('\n')).toEqual([]);
}

test('TV home and settings have no WCAG 2.1 AA violations (axe)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.code')).toHaveText(/^[A-Z2-9]{4}$/);
  await audit(page, 'tv-home');
  await page.locator('[data-id="settings"]').click();
  await expect(page.locator('[data-id="lang"]')).toBeVisible();
  await audit(page, 'tv-settings');
});

test('phone controller join + menu have no WCAG 2.1 AA violations (axe)', async ({ browser, baseURL, page: host }) => {
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-Z2-9]{4}$/);
  const code = (await host.locator('.code').textContent())!;
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', baseURL });
  const phone = await ctx.newPage();
  await phone.goto(`/c?r=${code}`);
  await audit(phone, 'phone-join');
  await phone.getByLabel('כינוי').fill('Axe');
  await phone.getByRole('button', { name: 'הצטרפות' }).click();
  await expect(phone.locator('.bar')).toBeVisible();
  await audit(phone, 'phone-play');
  await ctx.close();
});

test('legal pages have no WCAG 2.1 AA violations (axe)', async ({ page }) => {
  for (const p of ['/legal/accessibility.html', '/legal/privacy.html', '/nope']) {
    await page.goto(p);
    await audit(page, p);
  }
});

test('poker and word-game phone screens + TV boards have no WCAG 2.1 AA violations (axe)', async ({ browser, baseURL, page: host }) => {
  await host.goto('/');
  await expect(host.locator('.code')).toHaveText(/^[A-Z2-9]{4}$/);
  const code = (await host.locator('.code').textContent())!;
  const phones: Page[] = [];
  const contexts = [];
  for (const name of ['Ax1', 'Ax2']) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', baseURL });
    contexts.push(ctx);
    const phone = await ctx.newPage();
    await phone.goto(`/c?r=${code}`);
    await phone.getByLabel('כינוי').fill(name);
    await phone.getByRole('button', { name: 'הצטרפות' }).click();
    await expect(phone.locator('.bar')).toBeVisible();
    phones.push(phone);
  }
  await host.locator('[data-id="game:poker"]').click();
  for (const p of phones) await expect(p.locator('.hand .pcard')).toHaveCount(2, { timeout: 15_000 });
  const actor = (await phones[0]!.locator('.card-actions button').count()) ? phones[0]! : phones[1]!;
  await expect(actor.locator('.card-actions button').first()).toBeVisible();
  await audit(actor, 'phone-poker');
  const pokerFrame = host.frames().find((f) => f.url().includes('/games/poker/'))!;
  const pokerResult = await new AxeBuilder({ page: host }).include('.game-frame').withTags(WCAG).analyze();
  expect(pokerResult.violations.map((v) => v.id), 'tv-poker').toEqual([]);
  expect(pokerFrame).toBeTruthy();
  for (const c of contexts) await c.close();
  await new Promise((r) => setTimeout(r, 1500));

  // Word game: one phone is enough.
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL', baseURL });
  const phone = await ctx.newPage();
  await host.locator('[data-id="game:word-guess"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
  await phone.goto(`/c?r=${code}`);
  await phone.getByLabel('כינוי').fill('Ax3');
  await phone.getByRole('button', { name: 'הצטרפות' }).click();
  await expect(phone.locator('.bar')).toBeVisible();
  await host.locator('[data-id="game:word-guess"]').click();
  await expect(phone.locator('.letter-grid .letter')).toHaveCount(22, { timeout: 20_000 });
  await audit(phone, 'phone-letters');
  const wordResult = await new AxeBuilder({ page: host }).include('.game-frame').withTags(WCAG).analyze();
  expect(wordResult.violations.map((v) => v.id), 'tv-word').toEqual([]);
  await ctx.close();
});
