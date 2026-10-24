// Mock exam simulator: exam mode with the clock fast-forwarded, autosave and resume after a reload,
// a full walk through every question, the review screen, results, past attempts, practice mode, DOMC rules.
import { expect, test, type Page } from '@playwright/test';
import { idb } from './helpers';

const count = (page: Page) => page.locator('.ex-count');
const timer = (page: Page) => page.locator('.ex-timer-value');
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });

async function startExam(page: Page, mode: 'exam' | 'practice' = 'exam') {
  await page.goto('exams/mock1/');
  await page.getByRole('button', { name: mode === 'exam' ? 'Start in exam mode' : 'Start in practice mode' }).click();
  await expect(count(page)).toHaveText(/^Question 1 of \d+$/);
  return Number((await count(page).textContent())!.match(/of (\d+)/)![1]);
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
  await page.getByRole('button', { name: 'Yes' }).click();
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
  await page.getByRole('radio', { name: /^D\./ }).check(); // Mock 1 Q1: the key is D
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
  await page.keyboard.press('y');
  await expect(page.getByText('Option 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await next(page).click();
  await expect(page.getByText('Option 2', { exact: true })).toBeVisible(); // still option 2: no way back
  await expect(page.getByRole('button', { name: 'Yes' })).toHaveCount(1);
});
