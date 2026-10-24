// The exam timer is realistic by default: the time keeps passing while the page is closed, and the exam is
// submitted if it ran out meanwhile. Settings can pause it instead. (Playwright clock: time is fast-forwarded.)
import { expect, test, type Page } from '@playwright/test';
import { idb } from './helpers';

async function startAndAnswer(page: Page) {
  await page.goto('exams/mock1/');
  await page.getByRole('button', { name: 'Start in exam mode' }).click();
  await page.getByRole('radio').first().check();
  await page.waitForTimeout(400); // the debounced save
}

test('closing the page does not stop the clock; coming back shows the time left', async ({ page, context }) => {
  await page.clock.install();
  await page.goto('exams/mock1/');
  await expect(page.getByText('If you close the page, the time keeps passing, like on the real exam')).toBeVisible();
  await startAndAnswer(page);
  await page.close(); // close the tab

  const back = await context.newPage();
  await back.clock.fastForward('00:30:00');
  await back.goto('exams/mock1/');
  await expect(back.getByText('The timer kept running while the page was closed')).toBeVisible();
  await expect(back.locator('.ex-resume')).toContainText(/1 hour (29|30) minutes left/);
  await back.getByRole('button', { name: 'Resume where you stopped' }).click();
  await expect(back.locator('.ex-timer-value')).toHaveText(/^01:(29|30):\d\d$/);
  await expect(back.getByRole('radio').first()).toBeChecked();
});

test('if the time ran out while the page was closed, the exam is submitted', async ({ page, context }) => {
  await page.clock.install();
  await startAndAnswer(page);
  await page.close();
  const back = await context.newPage();
  await back.clock.fastForward('02:00:30');
  await back.goto('exams/mock1/');
  await expect(back.getByText('The time ran out while the page was closed')).toBeVisible();
  await expect(back.getByRole('heading', { name: 'Mock exam 1: your results' })).toBeVisible();
  const attempts = await idb<{ status: string; timeUp: boolean; elapsedMs: number; durationMs: number }>(back, 'examAttempts');
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ status: 'finished', timeUp: true });
  expect(attempts[0].elapsedMs).toBe(attempts[0].durationMs);
});

test('Settings: "Pause the timer when I close the page"', async ({ page, context }) => {
  await page.clock.install();
  await page.goto('settings/');
  const pause = page.getByLabel(/Pause the timer when I close the page/);
  await pause.click();
  await expect(pause).toBeChecked();
  await page.goto('exams/mock1/');
  await expect(page.getByText('If you close the page, the timer stops (your setting)')).toBeVisible();
  await startAndAnswer(page);
  await page.close();
  const back = await context.newPage();
  await back.clock.fastForward('00:30:00');
  await back.goto('exams/mock1/');
  await expect(back.getByText('The timer was paused while the page was closed')).toBeVisible();
  await expect(back.locator('.ex-resume')).toContainText(/(2 hours|1 hour 59 minutes) left/);
  await back.getByRole('button', { name: 'Resume where you stopped' }).click();
  await expect(back.locator('.ex-timer-value')).toHaveText(/^(02:00:00|01:59:\d\d)$/);
});

test('if the time runs out on the resume screen, the notice says so (review E16)', async ({ page }) => {
  await page.clock.install();
  await startAndAnswer(page);
  await page.goto('exams/');
  await page.clock.fastForward('01:59:50');
  await page.goto('exams/mock1/');
  await expect(page.getByRole('button', { name: 'Resume where you stopped' })).toBeVisible();
  await page.clock.fastForward('00:00:20');
  await expect(page.getByText('The time ran out before you resumed.')).toBeVisible();
});
