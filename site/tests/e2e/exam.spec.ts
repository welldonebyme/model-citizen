// Mock exam simulator: exam mode with the clock fast-forwarded, autosave and resume after a reload,
// a full walk through every question, the review screen, results, past attempts, practice mode, DOMC rules.
import { expect, test, type Page } from '@playwright/test';
import { idb, putRows } from './helpers';

const count = (page: Page) => page.locator('.ex-count');
const timer = (page: Page) => page.locator('.ex-timer-value');
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });

async function startExam(page: Page, mode: 'exam' | 'practice' = 'exam') {
  await page.goto('exams/mock1/');
  await page.getByRole('button', { name: mode === 'exam' ? 'Start in exam mode' : 'Start in practice mode' }).click();
  await expect(count(page)).toHaveText(/^Question 1 of \d+$/);
  return Number((await count(page).textContent())!.match(/of (\d+)/)![1]);
}

/** Mock 1 Q8 (DOMC): only option B is NO. Judging the shown option right keeps the question open. */
async function judgeQ8Right(page: Page, how: 'click' | 'key') {
  const isB = /written by hand/.test((await page.locator('.qz-domc-text').textContent()) ?? '');
  if (how === 'click') await page.getByRole('button', { name: isB ? 'No' : 'Yes', exact: true }).click();
  else await page.keyboard.press(isB ? 'n' : 'y');
}

/** Gives some answer to the current question, whatever its format. */
async function answerSomething(page: Page) {
  const q = page.locator('.qz-q');
  const format = await q.getAttribute('data-format');
  switch (format) {
    case 'mc': await q.getByRole('radio').first().check(); break;
    case 'ms': {
      const n = Number((await q.locator('.qz-count').textContent())!.match(/Choose (\d+)/)![1]);
      for (let i = 0; i < n; i++) await q.getByRole('checkbox').nth(i).check();
      break;
    }
    case 'fill': for (const box of await q.getByRole('textbox').all()) await box.fill('x'); break;
    case 'hotspot': await q.getByRole('button', { name: 'Line 1', exact: true }).first().click(); break;
    case 'match': for (const s of await q.locator('select').all()) await s.selectOption({ index: 1 }); break;
    case 'order': await q.getByRole('button', { name: 'Use this order' }).click(); break;
    case 'domc':
      for (let i = 0; i < 10 && !(await q.locator('.qz-domc-done').count()); i++) await q.getByRole('button', { name: 'Yes' }).click();
      await expect(q.locator('.qz-domc-done')).toBeVisible();
      break;
  }
}

test('exam mode: timer, flag, navigator, time-up auto-submit, results, past attempts', async ({ page }) => {
  await page.clock.install();
  const total = await startExam(page);
  await expect(timer(page)).toHaveText('02:00:00');
  await expect(page.getByText('Exam mode, no feedback until the end')).toBeVisible();

  await answerSomething(page);
  await expect(page.getByRole('region', { name: 'Feedback' })).toHaveCount(0); // no feedback in exam mode
  await next(page).click();
  await expect(count(page)).toHaveText(`Question 2 of ${total}`);
  await page.getByRole('button', { name: 'Flag for review' }).click();
  await expect(page.getByText('Flagged for review').first()).toBeVisible();

  await page.getByRole('button', { name: 'All questions' }).click();
  const nav = page.getByRole('region', { name: 'All questions' });
  await expect(nav.getByRole('button', { name: 'Question 1: answered', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^Question 2: not answered, flagged for review, this question$/ })).toBeVisible();
  await nav.getByRole('button', { name: /^Question 5:/ }).click();
  await expect(count(page)).toHaveText(`Question 5 of ${total}`);

  await page.clock.fastForward('01:30:00');
  await expect(timer(page)).toHaveText(/^00:(29|30):\d\d$/);
  await page.clock.fastForward('00:31:00');
  await expect(page.getByText('Time is up. Your answers were submitted automatically.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mock exam 1: your results' })).toBeVisible();
  await expect(page.getByText(/submitted when the time was up/)).toBeVisible();
  await expect(page.locator('.rs-pct-of')).toHaveText(new RegExp(`of ${total} correct`));

  const attempts = await idb<{ status: string; timeUp: boolean; mode: string; flags: string[] }>(page, 'examAttempts');
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ status: 'finished', timeUp: true, mode: 'exam', flags: ['m1-q02'] });
  const answers = await idb<{ mode: string }>(page, 'answers');
  expect(answers.filter((a) => a.mode === 'mock-exam')).toHaveLength(total);

  // the list of attempts, then the permanent results page of this attempt
  await page.goto('exams/');
  await expect(page.locator('.xi-table')).toContainText('Mock 1');
  await page.getByRole('link', { name: /^See results/ }).click();
  await expect(page).toHaveURL(/exams\/attempt\/\?id=/);
  await expect(page.getByRole('heading', { name: 'Mock exam 1: your results' })).toBeVisible();
  await expect(page.locator('.viz-rows').first().locator('tbody tr')).toHaveCount(7);
});

test('autosave: answers, flags, DOMC progress and time left survive a reload', async ({ page }) => {
  await page.clock.install();
  const total = await startExam(page);
  await answerSomething(page); // Q1
  await next(page).click();
  await page.getByRole('button', { name: 'Flag for review' }).click(); // Q2 flagged
  await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('region', { name: 'All questions' }).getByRole('button', { name: /^Question 8:/ }).click();
  await expect(page.locator('.qz-q')).toHaveAttribute('data-format', 'domc');
  await expect(page.getByText('Option 1', { exact: true })).toBeVisible();
  const firstOption = (await page.locator('.qz-domc-text').textContent())!;
  await judgeQ8Right(page, 'click');
  await expect(page.getByText('Option 2', { exact: true })).toBeVisible();
  await page.clock.fastForward('00:10:00');
  await page.waitForTimeout(400); // let the debounced save run

  await page.reload();
  await expect(page.getByRole('heading', { name: 'You have a mock exam in progress' })).toBeVisible();
  await expect(page.locator('.ex-resume')).toContainText(`1 of ${total} questions answered`);
  await expect(page.locator('.ex-resume')).toContainText(/1 hour 4[89] minutes left/);
  await page.getByRole('button', { name: 'Resume where you stopped' }).click();

  await expect(count(page)).toHaveText(`Question 8 of ${total}`);
  await expect(timer(page)).toHaveText(/^01:4[89]:\d\d$/);
  // the judged DOMC option stays hidden and locked: the next option is shown
  await expect(page.getByText('Option 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Option 1 answered')).toBeVisible();
  await expect(page.locator('.qz-domc-text')).not.toHaveText(firstOption);
  await page.getByRole('button', { name: 'All questions' }).click();
  const nav = page.getByRole('region', { name: 'All questions' });
  await expect(nav.getByRole('button', { name: 'Question 1: answered', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Question 2: not answered, flagged for review', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^Question 8: started, not finished, this question$/ })).toBeVisible();

  // starting again ends the attempt in progress
  await page.reload();
  await page.getByRole('button', { name: 'Start again' }).click();
  await page.getByRole('button', { name: 'Yes, end it' }).click();
  await expect(page.getByRole('button', { name: 'Start in exam mode' })).toBeVisible();
  const attempts = await idb<{ status: string }>(page, 'examAttempts');
  expect(attempts.map((a) => a.status)).toEqual(['abandoned']);
});

test('a full mock: every question, the review screen, submit, results and review', async ({ page }) => {
  test.setTimeout(240_000);
  const total = await startExam(page);
  for (let i = 1; i <= total; i++) {
    await expect(count(page)).toHaveText(`Question ${i} of ${total}`);
    if (i !== 3) await answerSomething(page); // leave question 3 empty
    if (i === 4) await page.getByRole('button', { name: 'Flag for review' }).click();
    if (i < total) await next(page).click();
  }
  await page.getByRole('button', { name: 'Review and submit' }).click();
  await expect(page.getByRole('heading', { name: 'Review before you submit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not answered (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flagged for review (1)' })).toBeVisible();
  await page.locator('.ex-rev-sec').first().getByRole('button', { name: 'Question 3' }).click();
  await expect(count(page)).toHaveText(`Question 3 of ${total}`);
  await answerSomething(page);
  await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('button', { name: 'Review and submit' }).click();
  await expect(page.getByRole('heading', { name: 'Not answered (0)' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit the exam' }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();

  await expect(page.getByRole('heading', { name: 'Mock exam 1: your results' })).toBeVisible();
  await expect(page.locator('.rs-pct-n')).toHaveText(/^\d+%$/);
  await expect(page.getByText('Pass line 65%').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By topic' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Checkpoints of the book\'s three-pass plan' })).toBeVisible();
  await expect(page.locator('.rs-list > li')).toHaveCount(total);
  await page.getByRole('button', { name: /^Flagged \(1\)$/ }).click();
  await expect(page.locator('.rs-list > li')).toHaveCount(1);
  await page.getByRole('button', { name: /^All \(/ }).click();
  const first = page.locator('.rs-list > li').first();
  await first.locator('summary').click();
  await expect(first.getByText('Your answer:')).toBeVisible();
  await expect(first.getByRole('heading', { name: 'Explanation' })).toBeVisible();
});

test('practice mode: feedback after each question, recorded as mock practice', async ({ page }) => {
  await startExam(page, 'practice');
  await expect(page.getByText('Time used')).toBeVisible();
  await page.getByRole('radio', { name: /^[A-D]\. There is no int_payments__successful object/ }).check(); // Mock 1 Q1: the right option (book letter D)
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByRole('region', { name: 'Feedback' }).getByRole('heading', { name: 'Correct', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why the other options are wrong' })).toBeVisible();
  const answers = await idb<{ qid: string; mode: string; correct: boolean }>(page, 'answers');
  expect(answers).toEqual([expect.objectContaining({ qid: 'm1-q01', mode: 'mock-practice', correct: true })]);
});

test('DOMC in exam mode: no letters, judged options hidden, no way back', async ({ page }) => {
  await startExam(page);
  await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('region', { name: 'All questions' }).getByRole('button', { name: /^Question 8:/ }).click();
  await expect(page.getByText('Option 1', { exact: true })).toBeVisible();
  await expect(page.locator('.qz-domc-card')).not.toHaveAttribute('data-option', /.+/); // no book letter
  await page.keyboard.press('n'); // the focus is on the question heading: a stray key judges nothing (review E15)
  await expect(page.getByText('Option 1', { exact: true })).toBeVisible();
  await next(page).focus();
  await page.keyboard.press('n'); // nor on the Next button
  await expect(page.getByText('Option 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Yes' }).focus();
  await judgeQ8Right(page, 'key');
  await expect(page.getByText('Option 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await next(page).click();
  await expect(page.getByText('Option 2', { exact: true })).toBeVisible(); // still option 2: no way back
  await expect(page.getByRole('button', { name: 'Yes' })).toHaveCount(1);
});

// ------------------------------------------------------------------------------------------ review fixes
async function mockIds(page: Page, n: number): Promise<string[]> {
  const r = await page.request.get(`exams/data/mock${n}.json`);
  return ((await r.json()) as { questions: { id: string }[] }).questions.map((q) => q.id);
}
const seeded = (id: string, mock: number, mode: 'exam' | 'practice', pct: number, ids: string[], extra: Record<string, unknown> = {}) => ({
  id, mock, mode, questionIds: ids, seed: 1, startedAt: Date.now() - 3600_000, endedAt: Date.now() - 1800_000, durationMs: mode === 'exam' ? 7_200_000 : 0,
  elapsedMs: 1_800_000, current: 0, responses: {}, flags: [], domc: {}, timeByQuestion: {}, status: 'finished',
  score: { correct: Math.round((pct / 100) * ids.length), total: ids.length, pct }, updatedAt: Date.now(), ...extra,
});

test('the results page counts different mocks for the book rule, like the dashboard (review E3)', async ({ page }) => {
  await page.goto('exams/');
  await expect(page.locator('.xi-cards')).toBeVisible();
  const ids = await mockIds(page, 1);
  await putRows(page, 'examAttempts', [seeded('m1-a', 1, 'exam', 90.8, ids), seeded('m1-b', 1, 'exam', 92.3, ids)]);
  await page.goto('exams/attempt/?id=m1-b');
  await expect(page.getByText('Different mocks at 80% or more in timed exam mode: 1 of 2.')).toBeVisible();
});

test('the mock cards: best exam-mode score, live time left and answers (review E5, E17)', async ({ page }) => {
  await page.goto('exams/');
  await expect(page.locator('.xi-cards')).toBeVisible();
  const ids2 = await mockIds(page, 2);
  const ids3 = await mockIds(page, 3);
  await putRows(page, 'examAttempts', [
    seeded('m2-p', 2, 'practice', 95.4, ids2), seeded('m2-e', 2, 'exam', 50.8, ids2),
    { ...seeded('m3-live', 3, 'exam', 0, ids3), status: 'active', score: undefined, endedAt: undefined, elapsedMs: 600_000, clock: 'wall', clockAt: Date.now() - 50 * 60_000, answered: 1, responses: { [ids3[0]]: { format: 'mc', choice: 'A' }, [ids3[1]]: { format: 'ms', choices: ['A'] } } },
  ]);
  await page.reload();
  const card2 = page.locator('.xi-card', { hasText: 'Mock exam 2' });
  await expect(card2).toContainText('Best score in exam mode: 50%');
  await expect(card2).toContainText('practice mode: 95%');
  const card3 = page.locator('.xi-card', { hasText: 'Mock exam 3' });
  await expect(card3).toContainText(/1 of 65 answered, (59 minutes|1 hour) left \(the timer is running\)/);
});

test('submitting needs a deliberate choice: Enter twice does not submit, Escape goes back (review E8)', async ({ page }) => {
  await startExam(page);
  await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('region', { name: 'All questions' }).getByRole('button', { name: 'Review and submit' }).click();
  await page.getByRole('button', { name: 'Submit the exam' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Review before you submit' })).toBeVisible(); // not submitted
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit the exam' })).toBeFocused();
  const attempts = await idb<{ status: string }>(page, 'examAttempts');
  expect(attempts[0].status).toBe('active');
});

test('time on the review screen is not given to the last question (review E11)', async ({ page }) => {
  await page.clock.install();
  await startExam(page);
  await answerSomething(page);
  await next(page).click();
  await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('region', { name: 'All questions' }).getByRole('button', { name: 'Review and submit' }).click();
  await page.clock.fastForward('00:05:00');
  await page.getByRole('button', { name: 'Submit the exam' }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(page.getByText(/Time on the review screen before you submitted: 5 minutes/)).toBeVisible();
  const [a] = await idb<{ reviewMs: number; timeByQuestion: Record<string, number> }>(page, 'examAttempts');
  expect(a.reviewMs).toBeGreaterThanOrEqual(300_000);
  expect(Math.max(...Object.values(a.timeByQuestion))).toBeLessThan(60_000);
});

test('one tab at a time: a second tab that resumes the exam stops the first one (review E13)', async ({ page, context }) => {
  await startExam(page);
  await answerSomething(page);
  await page.waitForTimeout(400);
  const two = await context.newPage();
  await two.goto('exams/mock1/');
  await two.getByRole('button', { name: 'Resume where you stopped' }).click();
  await expect(two.locator('.ex-count')).toHaveText(/^Question 1 of/);
  await expect(page.getByText('This mock exam is now open in another tab or window')).toBeVisible();
  await two.getByRole('button', { name: 'Next', exact: true }).click();
  await answerSomething(two);
  await two.waitForTimeout(400);
  const [a] = await idb<{ responses: Record<string, unknown> }>(two, 'examAttempts');
  expect(Object.keys(a.responses).length).toBe(2); // nothing lost
});

test('mock options are shuffled per attempt with new letters; the review matches (review F1)', async ({ page }) => {
  await startExam(page, 'practice');
  const texts = await page.locator('.qz-choice-text').allTextContents();
  await page.getByRole('radio', { name: /There is no int_payments__successful object/ }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  const letter = (await page.getByRole('radio', { name: /There is no int_payments__successful object/ }).getAttribute('value'))!;
  await expect(page.getByRole('region', { name: 'Feedback' }).locator('.qz-expl p').first()).toContainText(`Why ${letter} is correct.`);
  expect(texts.length).toBe(4);
});
