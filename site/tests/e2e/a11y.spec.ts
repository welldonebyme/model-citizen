// axe-core: no serious or critical violation on the quiz, exam, results and drills pages, in every
// state that matters (each question format, feedback, navigator, review screen, results), light and dark.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function axe(page: Page, label: string) {
  await page.waitForTimeout(150);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.slice(0, 5).map((n) => `   ${n.target.join(' ')} :: ${n.failureSummary?.split('\n').slice(0, 3).join(' | ')}`).join('\n')}`).join('\n');
  expect(bad, `${label}\n${report}`).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test('chapter quiz: every format, before and after feedback', async ({ page }) => {
      for (const qid of ['q-ch07-01', 'q-ch07-02', 'q-ch07-03', 'q-ch07-05', 'q-ch07-06', 'q-ch07-07', 'q-ch07-08']) {
        await page.goto(`quiz/ch07/?q=${qid}`);
        await expect(page.locator('.qz-q')).toBeVisible();
        await axe(page, `quiz ${qid}`);
        const show = page.getByRole('button', { name: 'I do not know: show the answer' });
        if (await show.count()) await show.click();
        else for (let i = 0; i < 6 && !(await page.getByRole('region', { name: 'Feedback' }).count()); i++) await page.getByRole('button', { name: 'Yes' }).click();
        await expect(page.getByRole('region', { name: 'Feedback' })).toBeVisible();
        await axe(page, `quiz ${qid} feedback`);
      }
      await page.getByRole('button', { name: /See your score|Next question/ }).click();
    });

    test('mock exam: start, question, navigator, review, results, history', async ({ page }) => {
      await page.clock.install();
      await page.goto('exams/mock1/');
      await expect(page.getByRole('button', { name: 'Start in exam mode' })).toBeVisible();
      await axe(page, 'exam start');
      await page.getByRole('button', { name: 'Start in exam mode' }).click();
      await page.getByRole('radio').first().check();
      await axe(page, 'exam question');
      await page.getByRole('button', { name: 'Flag for review' }).click();
      await page.getByRole('button', { name: 'All questions' }).click();
      await axe(page, 'exam navigator');
      for (const n of [3, 5, 6, 8, 11]) { // fill, hotspot, build list, DOMC, matching in Mock 1
        await page.getByRole('region', { name: 'All questions' }).getByRole('button', { name: new RegExp(`^Question ${n}:`) }).click();
        await axe(page, `exam question ${n}`);
        await page.getByRole('button', { name: 'All questions' }).click();
      }
      await page.getByRole('region', { name: 'All questions' }).getByRole('button', { name: 'Review and submit' }).click();
      await axe(page, 'exam review screen');
      await page.getByRole('button', { name: 'Submit the exam' }).click();
      await axe(page, 'exam submit confirm');
      await page.getByRole('button', { name: 'Yes, submit' }).click();
      await expect(page.getByRole('heading', { name: 'Mock exam 1: your results' })).toBeVisible();
      await axe(page, 'results');
      await page.locator('.rs-list > li').first().locator('summary').click();
      await page.locator('.rs-details summary').first().click();
      await axe(page, 'results with a question open');
      await page.goto('exams/');
      await expect(page.locator('.xi-table')).toBeVisible();
      await axe(page, 'exams index');
      await page.getByRole('link', { name: /^See results/ }).click();
      await expect(page.getByRole('heading', { name: 'Mock exam 1: your results' })).toBeVisible();
      await axe(page, 'attempt page');
    });

    test('lesson checkpoints: question and feedback', async ({ page }) => {
      await page.goto('test/checkpoints/ch07-s4/');
      await expect(page.locator('.qz-checkpoints .qz-q')).toBeVisible();
      await axe(page, 'checkpoints');
      await page.getByRole('button', { name: 'I do not know: show the answer' }).click();
      await expect(page.getByRole('region', { name: 'Feedback' })).toBeVisible();
      await axe(page, 'checkpoints feedback');
    });

    test('drills: builder and a running drill', async ({ page }) => {
      await page.goto('practice/drills/');
      await expect(page.getByText(/questions match/)).toBeVisible();
      await axe(page, 'drills builder');
      await page.getByRole('radio', { name: /Speed round/ }).check();
      await page.getByRole('button', { name: 'Start the drill' }).click();
      await expect(page.locator('#qz-q-h')).toBeVisible();
      await axe(page, 'speed round');
    });
  });
}
