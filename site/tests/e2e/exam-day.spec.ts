// Exam day (/exams/exam-day/): countdown from the exam date of Settings, today's step of the book's
// last-7-days plan, checklists that save (settings table, row "exam-day"), the four booking conditions.
import { expect, test, type Page } from '@playwright/test';
import { idb } from './helpers';

const iso = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('no date yet: set it, see the countdown and today\'s step of the plan', async ({ page }) => {
  await page.goto('exams/exam-day/');
  await expect(page.getByRole('heading', { name: 'Exam day', level: 1 })).toBeVisible();
  await expect(page.getByText(/Set the date of your exam/)).toBeVisible();
  await page.getByLabel('Exam date').fill(iso(5));
  await page.getByRole('button', { name: 'Save the date' }).click();
  await expect(page.locator('.ed-big')).toHaveText(/5\s*days to your exam/);
  await expect(page.locator('.ed-today')).toContainText('Today is D−5');
  await expect(page.locator('.ed-today')).toContainText('Traps of Topics 2, 3 and 4');
  await expect(page.locator('.ed-day[data-today]')).toContainText('D−5');
  await expect(page.locator('.ed-line li[data-state="now"]')).toHaveText(/D−5/);
  const settings = await idb<{ key: string; examDate?: string }>(page, 'settings');
  expect(settings.find((s) => s.key === 'settings')?.examDate).toBe(iso(5));
});

/** Writes the exam date straight into the database (the date field does not take past dates). */
async function setExamDate(page: Page, date: string) {
  await page.evaluate((d) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('model-citizen');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      const get = st.get('settings');
      get.onsuccess = () => st.put({ key: 'settings', rhythm: 'standard', dailyMinutes: 120, domcExtraOption: true, domcEarlyEnd: true, ...(get.result ?? {}), examDate: d, updatedAt: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), date);
  await page.reload();
}

test('exam day itself, a date far away and a date in the past', async ({ page }) => {
  await page.goto('exams/exam-day/');
  await page.getByLabel('Exam date').fill(iso(0));
  await page.getByRole('button', { name: 'Save the date' }).click();
  await expect(page.locator('.ed-big')).toHaveText('Today is exam day.');
  await expect(page.locator('.ed-day[data-today]')).toContainText('D0');
  await page.getByRole('button', { name: 'Change the date' }).click();
  await page.getByLabel('Exam date').fill(iso(20));
  await page.getByRole('button', { name: 'Save the date' }).click();
  await expect(page.locator('.ed-big')).toHaveText(/20\s*days to your exam/);
  await expect(page.getByText(/The last-7-days plan starts on/)).toBeVisible();
  await setExamDate(page, iso(-3));
  await expect(page.locator('.ed-big')).toHaveText('Your exam date has passed.');
  await expect(page.getByRole('link', { name: 'After the exam' })).toHaveAttribute('href', '/model-citizen/learn/ch27/ch27-s9/');
});

test('the plan and the checklist come from the book and keep their ticks', async ({ page }) => {
  await page.goto('exams/exam-day/');
  const days = page.locator('.ed-day');
  await expect(days).toHaveCount(8);
  await expect(days.first()).toContainText('D−7');
  await expect(days.last()).toContainText('D0');
  await expect(page.getByText('The last-minute cramming trap.')).toBeVisible();
  for (const t of ['Talview system check', 'government-issued photo ID', 'one screen only', 'Nothing on the desk', 'Q22 by minute 40']) await expect(page.locator('.ed-check')).toContainText(t);
  await expect(page.locator('.ed-item')).toHaveCount(17);

  await page.getByRole('checkbox', { name: /Done: D−7/ }).check();
  await page.getByRole('checkbox', { name: /Your computer passes the Talview system check/ }).check();
  await expect(page.locator('.ed-check-count')).toHaveText('1 of 17 ticked');
  const saved = async () => (await idb<{ key: string; week?: string[]; checklist?: string[] }>(page, 'settings')).find((s) => s.key === 'exam-day');
  await expect.poll(async () => (await saved())?.checklist).toEqual(['g1-2']); // saved before the reload
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Done: D−7/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Your computer passes the Talview system check/ })).toBeChecked();
  expect(await saved()).toMatchObject({ week: ['d7'], checklist: ['g1-2'] });

  await page.getByRole('button', { name: 'Untick the whole checklist' }).click();
  await expect(page.locator('.ed-check-count')).toHaveText('0 of 17 ticked');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.ed-check-count')).toHaveText('1 of 17 ticked');
});

test('the four booking conditions, with the learner\'s status and links', async ({ page }) => {
  await page.goto('exams/exam-day/');
  const ready = page.locator('.ed-ready');
  await expect(ready.getByRole('heading', { name: 'Ready to book?' })).toBeVisible();
  await expect(ready.locator('.ed-conds li')).toHaveCount(4);
  await expect(ready).toContainText('80% or more on two full mock exams');
  await expect(ready.getByRole('link', { name: /of 27 quizzes/ })).toHaveAttribute('href', '/model-citizen/quiz/');
  await expect(ready.getByRole('link', { name: /of 15 milestones/ })).toHaveAttribute('href', '/model-citizen/labs/capstone/');
  await expect(ready.getByRole('link', { name: '0 of 2 mocks' })).toHaveAttribute('href', '/model-citizen/exams/');
  await expect(page.locator('.ed-facts')).toContainText('65 questions');
});
