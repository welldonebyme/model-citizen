// A chapter quiz from start to score: feedback, error notebook entry, SRS card, summary, retry wrong ones.
import { expect, test } from '@playwright/test';
import { feedback, idb } from './helpers';

test('chapter quiz: feedback, error notebook, review queue, score and retry', async ({ page }) => {
  await page.goto('quiz/ch07/');
  await expect(page.getByRole('heading', { level: 1, name: 'Check yourself: Chapter 7' })).toBeVisible();
  const total = Number((await page.locator('.qz-of').textContent())!.replace(/\D/g, ''));
  expect(total).toBeGreaterThanOrEqual(8);

  // Q1 wrong: red feedback with the correct answer, the explanation and the review link
  await page.getByRole('radio', { name: /^[A-D]\. analytics\.crm\.accounts$/ }).check(); // a wrong option (letters are shuffled)
  await page.getByRole('button', { name: 'Check answer' }).click();
  const fb = feedback(page);
  await expect(fb.getByRole('heading', { name: 'Not correct' })).toBeVisible();
  await expect(fb.getByText('Explanation')).toBeVisible();
  await expect(fb.getByRole('link', { name: 'Chapter 7' })).toHaveAttribute('href', /\/model-citizen\/learn\/ch07\//);
  await expect(page.getByText('Your answer', { exact: true })).toBeVisible();
  await expect(page.getByText('Correct answer', { exact: true })).toBeVisible();

  // the error notebook entry: automatic, and the rule in my own words
  await fb.getByLabel('The rule in your own words (optional)').fill('Sources never use the target schema.');
  await fb.getByRole('button', { name: 'Save in my notebook' }).click();
  await expect(fb.getByText('Saved in your error notebook.')).toBeVisible();
  const notes = await idb<{ id: string; kind: string; text: string }>(page, 'notes');
  const note = notes.find((n) => n.id === 'error:q-ch07-01');
  expect(note?.kind).toBe('error');
  expect(note?.text).toMatch(/What I answered: [A-D]\. analytics\.crm\.accounts\n/);
  expect(note?.text).toMatch(/Correct answer: [A-D]\. analytics\.crm\.accounts_v2/);
  expect(note?.text).toContain('Sources never use the target schema.');
  const cards = await idb<{ id: string; kind: string; box: number }>(page, 'srs');
  expect(cards.find((c) => c.id === 'q-ch07-01')).toMatchObject({ kind: 'question', box: 1 });

  // Q2 right
  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.locator('#qz-q-h')).toHaveText(/Question 2/);
  await expect(page.locator('#qz-q-h')).toBeFocused();
  await page.getByRole('textbox', { name: 'Your answer for the blank' }).fill('table');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(feedback(page).getByRole('heading', { name: 'Correct', exact: true })).toBeVisible();
  expect((await idb(page, 'notes')).some((n) => (n as { id: string }).id === 'error:q-ch07-02')).toBe(false);

  // jump to the last question, give up on it, see the score
  await page.getByRole('button', { name: `Question ${total}`, exact: true }).click();
  await page.getByRole('button', { name: 'I do not know: show the answer' }).click();
  await page.getByRole('button', { name: 'See your score' }).click();
  await expect(page.getByRole('heading', { name: 'Your score' })).toBeVisible();
  await expect(page.locator('.qz-score')).toContainText(`1 of ${total} correct`);
  const answers = await idb<{ qid: string; mode: string; correct: boolean }>(page, 'answers');
  expect(answers.map((a) => [a.qid, a.mode, a.correct])).toEqual(expect.arrayContaining([['q-ch07-01', 'quiz', false], ['q-ch07-02', 'quiz', true]]));
  await expect(page.getByRole('link', { name: 'Back to Chapter 7' })).toBeVisible();

  // retry only the missed ones (wrong and skipped)
  await page.getByRole('button', { name: `Retry the ${total - 1} questions you missed` }).click();
  await expect(page.locator('#qz-q-h')).toHaveText(new RegExp(`Question 1 of ${total - 1}`));
  await expect(page.getByText('retry 1')).toBeVisible();
});

test('chapter quiz: the session survives a reload, and a finished quiz is marked done', async ({ page }) => {
  await page.goto('quiz/ch16/');
  const total = Number((await page.locator('.qz-of').textContent())!.replace(/\D/g, ''));
  await page.getByRole('button', { name: 'I do not know: show the answer' }).click();   // Q1 wrong
  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.locator('#qz-q-h')).toHaveText(/Question 2/);
  await page.reload();
  await expect(page.locator('#qz-q-h')).toHaveText(new RegExp(`Question 2 of ${total}`));
  await expect(page.getByRole('button', { name: 'Question 1, not correct' })).toBeVisible();

  // finish: jump to the last question and see the score
  await page.getByRole('button', { name: `Question ${total}`, exact: true }).click();
  await page.getByRole('button', { name: 'I do not know: show the answer' }).click();
  await page.getByRole('button', { name: 'See your score' }).click();
  await expect(page.getByRole('heading', { name: 'Your score' })).toBeVisible();
  const progress = await idb<{ id: string; kind: string; ref: string; status: string; data: { score: number; total: number } }>(page, 'progress');
  expect(progress).toEqual([expect.objectContaining({ id: 'chapter:ch16', kind: 'chapter', ref: 'ch16', status: 'done', data: expect.objectContaining({ score: 0, total }) })]);

  // a finished quiz starts fresh next time, and shows the last result
  await page.reload();
  await expect(page.locator('#qz-q-h')).toHaveText(new RegExp(`Question 1 of ${total}`));
  await expect(page.locator('.qz-last')).toContainText(`Last finished on`);
  await expect(page.locator('.qz-last')).toContainText(`0 of ${total}`);
});

test('score screen: the start of each question, the next chapter and Today (review F22); a link to a question outside the retry round opens it (F14)', async ({ page }) => {
  await page.goto('quiz/ch07/');
  const total = Number((await page.locator('.qz-of').textContent())!.replace(/\D/g, ''));
  await page.getByRole('button', { name: 'I do not know: show the answer' }).click(); // Q1 missed
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('textbox', { name: 'Your answer for the blank' }).fill('table'); // Q2 right
  await page.getByRole('button', { name: 'Check answer' }).click();
  await page.getByRole('button', { name: `Question ${total}`, exact: true }).click();
  await page.getByRole('button', { name: 'I do not know: show the answer' }).click();
  await page.getByRole('button', { name: 'See your score' }).click();
  await expect(page.locator('.qz-sum-list')).toContainText('This file is the only declaration of the source');
  await expect(page.getByRole('link', { name: 'Next: Chapter 8' })).toHaveAttribute('href', '/model-citizen/learn/ch08/');
  await expect(page.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/model-citizen/');

  await page.getByRole('button', { name: /^Retry the \d+ questions you missed$/ }).click();
  await expect(page.locator('#qz-q-h')).toHaveText(new RegExp(`Question 1 of ${total - 1}`));
  await expect(page.getByText(`0 of ${total - 1} checked.`)).toBeAttached(); // counts this round only
  await page.goto('quiz/ch07/?q=q-ch07-02'); // answered right, so not in the retry round
  await expect(page.locator('#qz-q-h')).toHaveText(new RegExp(`Question 2 of ${total}`));
  await expect(page.getByRole('textbox', { name: 'Your answer for the blank' })).toBeVisible();
});

test('chapter quiz options are shuffled with new letters, and the explanation names the shown letters (review F1)', async ({ page }) => {
  await page.goto('quiz/ch07/?q=q-ch07-05');
  const right = [/Renaming id/, /Converting an amount/];
  for (const r of right) await page.getByRole('checkbox', { name: r }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  const letters = (await Promise.all(right.map((r) => page.getByRole('checkbox', { name: r }).getAttribute('value')))).sort();
  await expect(page.getByRole('region', { name: 'Feedback' }).locator('.qz-expl strong').first()).toHaveText(`${letters[0]} and ${letters[1]}.`);
});
