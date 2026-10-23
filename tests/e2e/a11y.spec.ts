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
