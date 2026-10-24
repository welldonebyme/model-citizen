// Capstone hub (/labs/capstone/): the board moves milestones as requirements are ticked, the ticks are the
// same as on the lesson pages, hints open one at a time, checkpoints offer "Check your output", the
// dashboard counts finished milestones, and labs without numbered steps get an "I did this lab" tick.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { idb } from './helpers';

async function axe(page: Page, label: string) {
  await page.waitForTimeout(150);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `${label}\n${bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`).join('\n')}`).toEqual([]);
}

const col = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}`) });

test('board, ticks shared with the lessons, dashboard count', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('labs/capstone/');
  await expect(page.getByRole('heading', { level: 1, name: 'ShopFlow, from raw data to release' })).toBeVisible();
  await expect(col(page, 'To do').locator('.cp-card')).toHaveCount(15);
  await expect(col(page, 'In progress')).toContainText('Nothing started');
  await expect(page.getByRole('heading', { name: '0 of 15 milestones done' })).toBeVisible();

  // tick every requirement of m00, one by one: in progress, then done
  const card = page.locator('#card-m00');
  const boxes = card.getByRole('checkbox');
  const n = await boxes.count();
  expect(n).toBeGreaterThan(2);
  await boxes.first().click();
  await expect(col(page, 'In progress').locator('#card-m00')).toBeVisible();
  await expect(page.locator('#card-m00').getByRole('checkbox').first()).toBeChecked();
  // a card moves to another column when its status changes: click, then read the state again
  for (let i = 1; i < n; i++) {
    await page.locator('#card-m00').getByRole('checkbox').nth(i).click();
    await expect(page.locator('#card-m00').getByRole('checkbox').nth(i)).toBeChecked();
  }
  await expect(page.locator('#card-m00').getByRole('checkbox').nth(n - 1)).toBeFocused();
  await expect(col(page, 'Done').locator('#card-m00')).toBeVisible();
  await expect.poll(async () => (await idb<{ ref: string }>(page, 'progress')).filter((r) => r.ref.startsWith('ch26-lab1:r')).length).toBe(n);
  await expect(page.getByRole('heading', { name: '1 of 15 milestones done' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('capstone.png'), fullPage: true });

  // the lesson page shows the same ticks
  await page.locator('#card-m00').getByRole('link', { name: 'Open the milestone' }).click();
  await expect(page.locator('[data-lab-step^="ch26-lab1:r"]')).toHaveCount(n);
  for (let i = 0; i < n; i++) await expect(page.locator('[data-lab-step^="ch26-lab1:r"]').nth(i)).toBeChecked();

  // the dashboard and Today count the milestone
  await page.goto('progress/');
  await expect(page.locator('.db-gate').filter({ hasText: 'The capstone project finished' })).toContainText('1 of 15 milestones');
  expect(errors).toEqual([]);
});

test('hints one at a time, output check in the checkpoint', async ({ page }) => {
  await page.goto('learn/ch26/ch26-s4/');
  const hints = page.locator('[data-hints]');
  const items = hints.locator('.step-body > ul > li');
  const total = await items.count();
  expect(total).toBeGreaterThan(1);
  await expect(items.first()).toBeHidden();
  await hints.getByRole('button', { name: 'Show the first hint' }).click();
  await expect(items.first()).toBeVisible();
  await expect(items.nth(1)).toBeHidden();
  await hints.getByRole('button', { name: `Show hint 2 of ${total}` }).click();
  await expect(items.nth(1)).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-hints] .step-body > ul > li').nth(1)).toBeVisible();

  const cp = page.locator('[data-checkpoint]');
  await expect(cp.locator('details.mc-verify').first()).toBeAttached();
  await cp.locator('details.mc-verify summary').first().click();
  await cp.locator('details.mc-verify textarea').first().fill('nothing like the book');
  await cp.locator('details.mc-verify').first().getByRole('button', { name: 'Check' }).click();
  await expect(cp.locator('.mc-verify-result').first()).toContainText('Not the same as the book yet.');
});

test('a lab without numbered steps has an "I did this lab" tick that is saved', async ({ page }) => {
  await page.goto('learn/ch05/');
  const first = page.locator('a[href*="/learn/ch05/ch05-s"]').first();
  await first.click();
  // find the lesson that holds ch05-lab1
  for (let i = 0; i < 12 && !(await page.locator('#ch05-lab1').count()); i++) {
    const next = page.locator('.pager .pg.next');
    if (!(await next.count())) break;
    await next.click();
  }
  const tick = page.locator('[data-lab-step="ch05-lab1:done"]');
  await expect(tick).toBeAttached();
  await tick.check();
  await expect.poll(async () => (await idb<{ ref: string }>(page, 'progress')).some((r) => r.ref === 'ch05-lab1:done')).toBe(true);
  await page.reload();
  await expect(page.locator('[data-lab-step="ch05-lab1:done"]')).toBeChecked();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`capstone hub has no serious axe violation, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('labs/capstone/');
    await expect(col(page, 'To do').locator('.cp-card').first()).toBeVisible();
    await page.locator('#card-m00').getByRole('checkbox').first().click();
    await expect(col(page, 'In progress').locator('#card-m00')).toBeVisible();
    await axe(page, `capstone ${scheme}`);
  });
}
