// Offline reading (Settings): off by default; once saved, lessons, quizzes and the dashboard open without a
// connection; a page never saved shows the offline notice; deleting the copy removes the caches.
import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'service worker + offline emulation: Chromium is enough here');

test('save the course, then study offline', async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.goto('settings/');
  const panel = page.getByRole('region', { name: 'Offline' });
  await expect(panel.getByRole('button', { name: 'Save the course for offline use' })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).not.toContain('mc-offline-on');

  await panel.getByRole('button', { name: 'Save the course for offline use' }).click();
  await expect(panel.getByText('Saved. The course now works in this browser without a connection.')).toBeVisible({ timeout: 200_000 });
  await expect(panel.getByText('An offline copy is saved in this browser.')).toBeVisible();

  await context.setOffline(true);
  await page.goto('learn/ch07/ch07-s2/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sources: declaring the raw data' })).toBeVisible();
  await page.goto('quiz/ch07/');
  await expect(page.locator('h1')).toBeVisible();
  await page.goto('progress/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your progress' })).toBeVisible();
  await page.goto('labs/capstone/');
  await expect(page.locator('.cp-card').first()).toBeVisible();
  await context.setOffline(false);

  await page.goto('settings/');
  await page.getByRole('region', { name: 'Offline' }).getByRole('button', { name: 'Delete the offline copy' }).click();
  await expect(page.getByRole('region', { name: 'Offline' }).getByText('The offline copy is deleted.')).toBeVisible();
  const keys = await page.evaluate(() => caches.keys());
  expect(keys.filter((k) => k.startsWith('mc-offline'))).toEqual([]);

  await context.setOffline(true);
  // after deleting the copy, nothing comes from it any more (a host's normal HTTP cache may still answer:
  // GitHub Pages lets browsers keep pages for 10 minutes)
  const res = await page.goto('learn/ch09/ch09-s3/').catch(() => null);
  expect(res === null || res.status() === 503 || !res.fromServiceWorker()).toBe(true);
  await context.setOffline(false);
});
