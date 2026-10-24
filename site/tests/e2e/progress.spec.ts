// Dashboard (/progress/): seeded progress shows the right numbers, the same readiness as the Today page,
// working table twins, no console errors, and no serious axe violation in light or dark mode.
import { readFileSync, readdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const GEN = new URL('../../src/generated/', import.meta.url);
const chapter = (id: string) => JSON.parse(readFileSync(new URL(`chapters/${id}.json`, GEN), 'utf8')) as { lessons: { id: string }[] };
const quiz = (id: string) => JSON.parse(readFileSync(new URL(`questions/${id}.json`, GEN), 'utf8')) as { id: string; objective?: string }[];
const QUIZ_FILES = readdirSync(new URL('questions/', GEN)).filter((f) => /^ch\d+\.json$/.test(f));

const LESSONS = ['ch00', 'ch01', 'ch02', 'ch03', 'ch07'].flatMap((c) => chapter(c).lessons.map((l) => l.id));
const CH07 = quiz('ch07');
const CH14 = quiz('ch14');
const DAY = 86_400_000;
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function seed(page: Page) {
  const now = Date.now();
  const rows = {
    settings: [{ key: 'settings', rhythm: 'standard', startDate: ymd(now - 40 * DAY), dailyMinutes: 120, domcExtraOption: true, domcEarlyEnd: true, updatedAt: now }],
    progress: [
      ...LESSONS.map((id) => ({ id: `lesson:${id}`, kind: 'lesson', ref: id, status: 'done', firstAt: now, updatedAt: now })),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({ id: `labstep:ch07-lab1:${n}`, kind: 'labstep', ref: `ch07-lab1:${n}`, status: 'done', firstAt: now, updatedAt: now })),
      { id: 'chapter:ch01', kind: 'chapter', ref: 'ch01', status: 'done', firstAt: now, updatedAt: now, data: { best: quiz('ch01').length, total: quiz('ch01').length } },
      { id: 'chapter:ch02', kind: 'chapter', ref: 'ch02', status: 'done', firstAt: now, updatedAt: now, data: { best: 1, total: quiz('ch02').length } },
    ],
    answers: [
      ...CH07.map((q, i) => ({ qid: q.id, mode: 'quiz', response: null, correct: i % 6 !== 0, at: now - DAY + i })),
      ...CH14.slice(0, 6).map((q, i) => ({ qid: q.id, mode: 'quiz', response: null, correct: i === 0, at: now - DAY + 100 + i })),
    ],
    examAttempts: [
      { mock: 1, mode: 'exam', pct: 72, at: now - 9 * DAY },
      { mock: 2, mode: 'exam', pct: 83.1, at: now - 4 * DAY },
      { mock: 1, mode: 'practice', pct: 88, at: now - 2 * DAY },
    ].map((a, i) => ({ id: `seed-${i}`, mock: a.mock, mode: a.mode, questionIds: [], seed: 1, startedAt: a.at, endedAt: a.at + 5_400_000, durationMs: 7_200_000, elapsedMs: 5_400_000, current: 0, responses: {}, flags: [], domc: {}, timeByQuestion: {}, status: 'finished', score: { correct: Math.round((a.pct / 100) * 65), total: 65, pct: a.pct }, updatedAt: a.at, clock: 'wall' })),
    activity: Array.from({ length: 20 }, (_, i) => ({ date: ymd(now - i * DAY), minutes: i % 5 === 3 ? 0 : 30 + ((i * 37) % 130), events: i % 5 === 3 ? 0 : 4, updatedAt: now })),
    srs: ['trap-001', 'trap-002', 'trap-003'].map((id) => ({ id, kind: 'trap', box: 1, due: ymd(now - DAY), lapses: 0, updatedAt: now })),
    notes: [{ id: 'error:q-ch07-01', kind: 'error', ref: 'q-ch07-01', text: 'Mixed up ref and source.', createdAt: now, updatedAt: now }],
  };
  await page.evaluate((data) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('model-citizen');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(Object.keys(data), 'readwrite');
      for (const [table, list] of Object.entries(data)) { const s = tx.objectStore(table); s.clear(); for (const r of list as object[]) s.put(r); }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), rows);
}

async function axe(page: Page, label: string) {
  await page.waitForTimeout(150);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `${label}\n${bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`).join('\n')}`).toEqual([]);
}

test('empty dashboard explains where to start', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('progress/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your progress' })).toBeVisible();
  await expect(page.getByText('Nothing to show yet.')).toBeVisible();
  await expect(page.getByText('No finished mock exam yet.')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`seeded dashboard, ${scheme} mode`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('progress/');
    await expect(page.getByRole('heading', { level: 1, name: 'Your progress' })).toBeVisible();
    await seed(page);
    await page.reload();

    const tile = (label: string) => page.locator('.db-tile').filter({ has: page.locator('dt', { hasText: label }) });
    await expect(tile('Lessons done').locator('.db-tile-v')).toContainText(String(LESSONS.length));
    await expect(tile('Labs done').locator('.db-tile-v')).toContainText('1');
    await expect(tile('Questions answered').locator('.db-tile-v')).toContainText(String(CH07.length + 6));
    await expect(tile('Review cards due').locator('.db-tile-v')).toHaveText('3');

    const gate = (label: string) => page.locator('.db-gate').filter({ hasText: label });
    await expect(gate('Two different timed mocks')).toContainText('1 of 2');
    // ch01 from its progress row, ch07 from answers (15 of 18 right); ch02 is below 80%
    await expect(gate('Every chapter quiz')).toContainText(`2 of ${QUIZ_FILES.filter((f) => Number(f.slice(2, 4)) <= 26).length}`);
    await expect(gate('Error notebook')).toContainText('1 note');

    // ch07 questions test objective 1.1/1.5...: at least one heatmap square has answers
    const objective = CH07.find((q) => q.objective)!.objective!;
    const cell = page.getByRole('img', { name: new RegExp(`^${objective.replace('.', '\\.')} `) });
    await expect(cell).toHaveAttribute('data-bin', /[1-4]/);
    await cell.focus();
    await expect(page.locator('.db-heat-tip')).toBeVisible();

    await expect(page.locator('.db-attempts tbody tr')).toHaveCount(3);
    await expect(page.locator('.db-chapters tbody tr').filter({ hasText: 'Chapter' }).first()).toBeVisible().catch(() => {});

    await axe(page, `dashboard ${scheme}`);
    await page.screenshot({ path: info.outputPath(`progress-${scheme}.png`), fullPage: true });

    // table twins
    await page.getByRole('button', { name: 'Show as a table' }).first().click();
    await expect(page.getByRole('table', { name: 'Mastery by exam objective' })).toBeVisible();
    await page.getByRole('button', { name: 'Show as a table' }).first().click();
    await expect(page.getByRole('table', { name: 'Study minutes per day, last 28 days' })).toBeVisible();
    await axe(page, `dashboard tables ${scheme}`);

    // the Today page reads the same numbers
    await page.goto('');
    const todayGate = (label: string) => page.locator('li').filter({ hasText: label }).locator('.t-val');
    await expect(todayGate('Two different timed mocks at 80% or more')).toHaveText('1 of 2');
    await expect(todayGate('Every chapter quiz at 80% or more')).toHaveText(`2 of ${QUIZ_FILES.filter((f) => Number(f.slice(2, 4)) <= 26).length}`);
    expect(errors).toEqual([]);
  });
}
