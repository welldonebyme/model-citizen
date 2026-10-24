import { expect, test } from '@playwright/test';
import { sqlReady, trackErrors } from './helpers';

// Phone layout (Pixel 7 viewport, touch): the workspace stacks above the examples; "Run in workspace" on an
// example far down the page brings the workspace back into view with the result.
test('phone: the workspace stacks and follows "Run in workspace"', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('labs/sql/');
  await sqlReady(page);
  const ws = page.getByTestId('sql-workspace');
  const wsBox = await ws.boundingBox();
  const listBox = await page.locator('.sqlp-list').boundingBox();
  expect(wsBox!.y).toBeLessThan(listBox!.y); // stacked: workspace first
  expect(wsBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); // no horizontal page scroll

  const btn = page.locator('[data-send-to-workspace="ch04-c59"]');
  await btn.scrollIntoViewIfNeeded();
  await btn.tap();
  await expect(ws.getByTestId('match-status')).toHaveAttribute('data-match', 'true');
  await expect(page.locator('#workspace-h')).toBeInViewport({ timeout: 5000 });
  await expect(ws.getByTestId('result-error')).toContainText('Binder Error');
  expect(errors).toEqual([]);
});

test('phone: on a lesson page the workspace stacks under the lesson and comes into view', async ({ page }) => {
  await page.goto('labs/sql/lesson-test/');
  const ws = page.getByTestId('sql-workspace');
  const read = await page.locator('.tl-read').boundingBox();
  const wsBox = await ws.boundingBox();
  expect(wsBox!.y).toBeGreaterThan(read!.y + read!.height - 1); // under the lesson
  const btn = page.locator('[data-send-to-workspace="ch04-c27"]');
  await btn.tap();
  await expect(page.locator('#workspace-h')).toBeInViewport({ timeout: 5000 });
  await expect(ws.getByTestId('match-status')).toHaveAttribute('data-match', 'true', { timeout: 60_000 });
});
