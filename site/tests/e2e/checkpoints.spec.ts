// Inline lesson checkpoints, on a test page that mounts them like a lesson page (tests/e2e/pages/).
import { expect, test } from '@playwright/test';
import { feedback, idb, tabTo } from './helpers';

test('lesson checkpoints: only this chapter loads, feedback, notebook, review queue, resume, score', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => { if (r.url().endsWith('.json')) requests.push(new URL(r.url()).pathname); });
  await page.goto('test/checkpoints/ch07-s2/');
  const box = page.getByRole('region', { name: 'Check your understanding' });
  await expect(box.getByRole('heading', { level: 3, name: /Question 1 of \d/ })).toBeVisible();
  // question data: only this chapter's file, not the whole bank (other islands may load their own JSON)
  expect(requests.filter((p) => /\/(quiz\/data|exams\/data|practice\/drills)\//.test(p))).toEqual(['/model-citizen/quiz/data/ch07.json']);

  // q-ch07-01: a wrong answer, with feedback, the notebook entry and an SRS card
  await box.getByRole('radio', { name: /^[A-D]\. analytics\.crm\.accounts$/ }).check(); // a wrong option (letters are shuffled)
  await box.getByRole('button', { name: 'Check answer' }).click();
  await expect(feedback(page).getByRole('heading', { name: 'Not correct' })).toBeVisible();
  const answers = await idb<{ qid: string; mode: string; correct: boolean }>(page, 'answers');
  expect(answers).toEqual([expect.objectContaining({ qid: 'q-ch07-01', mode: 'checkpoint', correct: false })]);
  expect((await idb<{ id: string }>(page, 'notes')).map((n) => n.id)).toEqual(['error:q-ch07-01']);
  expect((await idb<{ id: string; kind: string }>(page, 'srs'))).toEqual([expect.objectContaining({ id: 'q-ch07-01', kind: 'question' })]);

  // the session survives a reload
  await box.getByRole('button', { name: 'Next question' }).click();
  await expect(box.getByRole('heading', { level: 3, name: /Question 2 of/ })).toBeVisible();
  await page.reload();
  await expect(box.getByRole('heading', { level: 3, name: /Question 2 of/ })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Question 1, not correct' })).toBeVisible();

  // answer the rest (give up), then the compact score with a link to the full chapter quiz
  const total = Number((await box.locator('.qz-of').textContent())!.replace(/\D/g, ''));
  for (let i = 2; i <= total; i++) {
    await box.getByRole('button', { name: 'I do not know: show the answer' }).click();
    await box.getByRole('button', { name: i < total ? 'Next question' : 'See your score' }).click();
  }
  await expect(box.getByRole('heading', { level: 3, name: 'Your score' })).toBeVisible();
  await expect(box.locator('.qz-score')).toContainText(`0 of ${total} correct`);
  await expect(box.getByRole('link', { name: 'The full Chapter 7 quiz' })).toHaveAttribute('href', '/model-citizen/quiz/ch07/');
});

test('lesson checkpoints: keyboard only, DOMC with the Y key', async ({ page }) => {
  await page.goto('test/checkpoints/ch07-s5/'); // q-ch07-08 (DOMC) and q-ch07-13
  const box = page.getByRole('region', { name: 'Check your understanding' });
  await expect(box.locator('.qz-q')).toHaveAttribute('data-format', 'domc');
  await box.getByRole('heading', { level: 3 }).first().focus();
  await tabTo(page, box.getByRole('button', { name: 'Yes' })); // the Y key works while the option has the focus
  for (let i = 0; i < 6 && !(await feedback(page).count()); i++) await page.keyboard.press('y');
  await expect(feedback(page)).toBeVisible();
  await expect(feedback(page).locator('.qz-fb-title')).toBeFocused();
});
