// axe-core: no serious or critical violation on the delight pages and islands, in the states that matter,
// light and dark: XP panels with a celebration, the focus timer panel, the shortcuts dialog, explain it
// back, exam day (no date, a date in the last week, ticks), the friend challenge (builder, card, run, score).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function axe(page: Page, label: string) {
  await page.waitForTimeout(150);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.slice(0, 5).map((n) => `   ${n.target.join(' ')} :: ${n.failureSummary?.split('\n').slice(0, 3).join(' | ')}`).join('\n')}`).join('\n');
  expect(bad, `${label}\n${report}`).toEqual([]);
}

const iso = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test('delight islands: panels, celebration, focus timer, shortcuts, explain it back', async ({ page }) => {
      await page.goto('test/delight/');
      await expect(page.getByTestId('compact').locator('.dl-level-name')).toHaveText('Level 1 Seed');
      await expect(page.locator('.dl-pomo[data-loaded]')).toBeAttached();
      await axe(page, 'panels');
      await page.getByTestId('compact').getByText('All badges and how XP works').click();
      await page.getByTestId('full').getByText('How XP works').click();
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('mc:celebrate', { detail: { title: 'Chapter 7 done', text: 'Take the quiz with the book closed.', glyph: 'lesson', href: '#badges', linkText: 'See your badges' } })));
      await expect(page.locator('.dl-toast')).toBeVisible();
      await axe(page, 'panels open, celebration');
      await page.getByRole('button', { name: /^Focus timer/ }).click();
      await page.getByRole('dialog', { name: 'Focus timer' }).getByText('Timer settings').click();
      await axe(page, 'focus timer, idle');
      await page.getByRole('button', { name: /^Start/ }).click();
      await axe(page, 'focus timer, running');
      await page.keyboard.press('Escape');
      await page.locator('h1').click();
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      await axe(page, 'shortcuts dialog');
      await page.keyboard.press('Escape');
      const btn = page.getByRole('button', { name: 'Compare with the book' }).first();
      await btn.scrollIntoViewIfNeeded();
      await expect(page.getByLabel('The idea in simple words')).toBeEnabled();
      await btn.click();
      await axe(page, 'explain it back, book shown');
    });

    test('exam day: no date, a date in the last week, ticks', async ({ page }) => {
      await page.goto('exams/exam-day/');
      await expect(page.getByText(/Set the date of your exam/)).toBeVisible();
      await axe(page, 'exam day without a date');
      await page.getByLabel('Exam date').fill(iso(2));
      await page.getByRole('button', { name: 'Save the date' }).click();
      await expect(page.locator('.ed-today')).toContainText('D−2');
      await page.getByRole('checkbox', { name: 'Done: D−7' }).check();
      await page.locator('.ed-item input').first().check();
      await axe(page, 'exam day in the last week');
    });

    test('friend challenge: builder, card, a question, the score', async ({ page }) => {
      await page.goto('practice/challenge/');
      await expect(page.getByText(/questions match/)).toBeVisible();
      await axe(page, 'challenge builder');
      await page.getByRole('radio', { name: '5', exact: true }).check();
      await page.getByRole('checkbox', { name: /^7 Models/ }).check();
      await page.getByRole('button', { name: 'Create the challenge' }).click();
      await expect(page.getByRole('heading', { name: '5 questions' })).toBeVisible();
      await axe(page, 'challenge card');
      await page.getByRole('button', { name: 'Start the challenge' }).click();
      await expect(page.locator('#qz-q-h')).toBeVisible();
      await axe(page, 'challenge question');
      for (let i = 0; i < 5; i++) {
        const show = page.getByRole('button', { name: 'I do not know: show the answer' });
        if (await show.count()) await show.click();
        else for (let k = 0; k < 8 && !(await page.getByRole('region', { name: 'Feedback' }).count()); k++) await page.getByRole('button', { name: 'No', exact: true }).click();
        await page.getByRole('button', { name: /Next question|See your score/ }).click();
      }
      await expect(page.getByRole('heading', { name: /Your challenge score/ })).toBeVisible();
      await axe(page, 'challenge score');
    });
  });
}
