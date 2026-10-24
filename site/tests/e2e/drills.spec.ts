// Drills: filters, DOMC training, speed round (1:50 per question), "my mistakes".
import { expect, test } from '@playwright/test';
import { feedback } from './helpers';

test('DOMC training: only DOMC questions, exam-like order without letters', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => { if (r.url().endsWith('.json')) requests.push(new URL(r.url()).pathname); });
  await page.goto('practice/drills/');
  await expect(page.getByText(/questions match/)).toBeVisible();
  await page.getByRole('radio', { name: /DOMC training/ }).check();
  await page.getByLabel('Number of questions').selectOption('10');
  await expect(page.locator('#dr-count')).toHaveText(/\d+ questions match\. You get (10|all of them)/);
  await page.getByRole('button', { name: 'Start the drill' }).click();
  await expect(page.locator('.qz-q')).toHaveAttribute('data-format', 'domc');
  await expect(page.getByText('Option 1', { exact: true })).toBeVisible();
  // a small index first, then only the chapter and mock files that hold the picked questions
  const data = requests.filter((p) => /\/(quiz\/data|exams\/data|practice\/drills)\//.test(p));
  expect(data[0]).toBe('/model-citizen/practice/drills/index.json');
  expect(data.length).toBeGreaterThan(1);
  expect(data.slice(1).every((p) => /\/(quiz\/data\/ch\d\d|exams\/data\/mock\d)\.json$/.test(p))).toBe(true);
  await page.getByRole('button', { name: 'Yes' }).focus();
  for (let i = 0; i < 8 && !(await feedback(page).count()); i++) await page.keyboard.press('y');
  await expect(feedback(page)).toBeVisible();
  await expect(page.locator('.qz-domc-review .qz-letter').first()).toHaveText('A'); // letters come back in the review
  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.locator('.qz-q')).toHaveAttribute('data-format', 'domc');
});

test('speed round: the answer is checked when the 1:50 runs out', async ({ page }) => {
  await page.clock.install();
  await page.goto('practice/drills/');
  await expect(page.getByText(/questions match/)).toBeVisible();
  await page.getByRole('radio', { name: /Speed round/ }).check();
  await page.getByRole('checkbox', { name: /Multiple choice/ }).check();
  await page.getByRole('button', { name: 'Start the drill' }).click();
  await expect(page.locator('.qz-pace')).toContainText('1:50 left for this question');
  await page.clock.fastForward('00:01:00');
  await expect(page.locator('.qz-pace')).toContainText(/0:(49|50) left/);
  await page.clock.fastForward('00:00:52');
  await expect(feedback(page).getByRole('heading', { name: 'Time is up' })).toBeVisible();
  await expect(page.locator('.qz-pace')).toContainText('Timer stopped');
});

test('"Only my mistakes" offers the questions answered wrong last time', async ({ page }) => {
  await page.goto('quiz/ch07/?q=q-ch07-01');
  await page.getByRole('radio', { name: /^[A-D]\. analytics\.crm\.accounts$/ }).check(); // a wrong option (letters are shuffled)
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(feedback(page)).toBeVisible();
  await page.goto('practice/drills/');
  await expect(page.getByText(/questions match/)).toBeVisible();
  await page.getByRole('radio', { name: /Only my mistakes/ }).check();
  await expect(page.locator('#dr-count')).toHaveText('1 question matches.');
  await page.getByRole('button', { name: 'Start the drill' }).click();
  await expect(page.locator('#qz-q-h')).toHaveText(/Question 1 of 1/);
  await expect(page.getByText('This file is the only declaration of the source')).toBeVisible();
});

test('drills use the chapter quizzes by default and warn before mock questions (review F17)', async ({ page }) => {
  await page.goto('practice/drills/');
  await expect(page.getByText(/questions match/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Chapter quizzes/ })).toBeChecked();
  await expect(page.locator('.dr-warn')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Mock exam 1/ }).check();
  await expect(page.locator('.dr-warn')).toContainText('Take a mock in timed exam mode before you drill its questions');
});
