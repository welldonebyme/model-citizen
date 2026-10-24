// Review fixes (Today, plan, progress tracking, settings, flashcards, notebook): each test replays a finding of
// the independent review and checks the fixed behaviour.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { idb } from './helpers';

const GEN = new URL('../../src/generated/', import.meta.url);
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DAY = 86_400_000;

async function put(page: Page, table: string, rows: object[]) {
  await page.evaluate(({ table, rows }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('model-citizen');
    open.onsuccess = () => {
      const tx = open.result.transaction(table, 'readwrite');
      for (const r of rows) tx.objectStore(table).put(r);
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), { table, rows });
}
const settingsRow = (over: object = {}) => ({ key: 'settings', rhythm: 'standard', dailyMinutes: 120, domcExtraOption: true, domcEarlyEnd: true, updatedAt: Date.now(), ...over });

async function finishLesson(page: Page, path: string) {
  await page.goto(path);
  const buttons = page.locator('[data-understood]');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) await buttons.nth(i).click();
  await expect.poll(async () => (await idb<{ id: string }>(page, 'progress')).some((r) => r.id.startsWith('lesson:'))).toBe(true);
}

test('Today: the course map shows progress, finished lessons stay ticked, the button moves on', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Start my plan today' }).click();
  await expect(page.locator('.t-mission')).toBeVisible();
  await finishLesson(page, 'learn/ch00/ch00-s1/');
  await page.goto('');
  await expect(page.locator('[data-part-node="0"]')).toHaveAttribute('data-state', 'now');
  expect(Number(await page.locator('[data-part-node="0"] .bar').getAttribute('width'))).toBeGreaterThan(0);
  await expect(page.locator('.t-mission li.done')).toContainText('0.1');
  await expect(page.locator('.t-cta .btn-primary')).toContainText('Start lesson 0.2');
});

test('a lab stays on the mission until its ticks are done, even when its lesson is understood', async ({ page }) => {
  const ch01 = JSON.parse(readFileSync(new URL('chapters/ch01.json', GEN), 'utf8')) as { lessons: { id: string; labs: string[] }[] };
  const withLab = ch01.lessons.find((l) => l.labs.length)!;
  const all = ['ch00', 'ch01'].flatMap((c) => (JSON.parse(readFileSync(new URL(`chapters/${c}.json`, GEN), 'utf8')) as { lessons: { id: string }[] }).lessons.map((l) => l.id));
  await page.goto('');
  await put(page, 'settings', [settingsRow({ startDate: ymd(Date.now() - 3 * DAY) })]);
  await put(page, 'progress', all.map((id) => ({ id: `lesson:${id}`, kind: 'lesson', ref: id, status: 'done', firstAt: 1, updatedAt: 1 })));
  await page.reload();
  await expect(page.locator('.t-mission li').filter({ has: page.locator('.t-k-lab') }).first()).toBeVisible();
  const labLinks = await page.locator('.t-mission li .t-body a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).hash));
  expect(labLinks).toContain(`#${withLab.labs[0]}`);
});

test('unticking "I understood this" stays unticked after a reload, and the lesson is no longer done', async ({ page }) => {
  await finishLesson(page, 'learn/ch00/ch00-s1/');
  const second = page.locator('[data-understood]').nth(1);
  const stepId = await second.getAttribute('data-understood');
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await idb<{ id: string; status: string }>(page, 'progress')).find((r) => r.id === `step:${stepId}`)?.status).toBe('seen');
  await page.reload();
  await expect(page.locator('[data-understood]').nth(1)).toHaveAttribute('aria-pressed', 'false');
  expect((await idb<{ id: string }>(page, 'progress')).some((r) => r.id === 'lesson:ch00-s1')).toBe(false);
});

test('starting the plan keeps an exam date saved before, and import into a fresh browser keeps the file\'s plan', async ({ page, browser }) => {
  await page.goto('');
  await put(page, 'settings', [settingsRow({ examDate: '2027-01-15', name: 'Amal', os: 'win', startDate: undefined })]);
  await page.reload();
  await expect(page.getByLabel(/Exam date/)).toHaveValue('2027-01-15');
  await page.getByRole('button', { name: 'Start my plan today' }).click();
  await expect(page.getByText('2027-01-15')).toBeVisible();

  // export the progress file of this browser (an older start date and the intensive rhythm)
  await put(page, 'settings', [settingsRow({ examDate: '2027-01-15', name: 'Amal', os: 'win', rhythm: 'intensive', startDate: '2026-10-01' })]);
  await put(page, 'progress', [{ id: 'lesson:ch00-s1', kind: 'lesson', ref: 'ch00-s1', status: 'done', firstAt: 1, updatedAt: 1 }]);
  await page.goto('settings/');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export/ }).click()]);
  const file = await download.path();

  const ctx = await browser.newContext();
  const b = await ctx.newPage();
  await b.goto('');
  await b.getByRole('button', { name: 'Start my plan today' }).click();
  await expect(b.locator('.t-mission')).toBeVisible();
  await b.goto('settings/');
  await b.locator('input[type="file"]').setInputFiles(file!);
  await expect(b.getByText(/Progress imported/)).toBeVisible();
  const s = (await idb<{ key: string; startDate?: string; rhythm?: string; os?: string }>(b, 'settings')).find((r) => r.key === 'settings');
  expect([s?.startDate, s?.rhythm, s?.os]).toEqual(['2026-10-01', 'intensive', 'win']);
  expect(await b.evaluate(() => localStorage.getItem('mc:os'))).toBe('win');
  await ctx.close();
});

test('missed questions due are answered again from the flashcards page', async ({ page }) => {
  await page.goto('practice/flashcards/');
  await put(page, 'srs', [{ id: 'q-ch07-01', kind: 'question', box: 1, due: ymd(Date.now() - DAY), lapses: 1, updatedAt: 1 }]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Missed questions (1)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.qz-stem, [class*="qz-"]').first()).toBeVisible();
});

test('the notebook has the re-read button of the fourth condition', async ({ page }) => {
  await page.goto('practice/notebook/');
  await page.getByRole('button', { name: 'I have re-read my whole notebook' }).click();
  await expect(page.getByText(/You re-read your whole notebook on/)).toBeVisible();
  await page.goto('progress/');
  await expect(page.locator('.db-gate').filter({ hasText: 'Error notebook re-read' })).toHaveClass(/ok/);
});

test('deleting progress also clears quiz sessions, but keeps reading preferences', async ({ page }) => {
  await page.goto('settings/');
  await page.evaluate(() => { localStorage.setItem('mc:quiz-session:quiz:ch07', '{"i":3}'); localStorage.setItem('mc:theme', 'dark'); });
  page.on('dialog', (d) => d.accept());
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Delete my progress in this browser' }).click()]);
  expect(await page.evaluate(() => [localStorage.getItem('mc:quiz-session:quiz:ch07'), localStorage.getItem('mc:theme')])).toEqual([null, 'dark']);
});

test('study time counts minutes of real use on a lesson page', async ({ page }) => {
  await page.clock.install();
  await page.goto('learn/ch07/ch07-s2/');
  await page.locator('h1').click(); // a click or a tap counts as use
  await page.clock.runFor(61_000);
  await expect.poll(async () => (await idb<{ minutes: number }>(page, 'activity')).reduce((n, a) => n + a.minutes, 0)).toBeGreaterThanOrEqual(1);
});

test('Progress shows topic weights as shares of the 65 questions', async ({ page }) => {
  await page.goto('progress/');
  await expect(page.getByText('Developing models, 40% of the exam (26 of 65 questions)')).toBeVisible();
});
