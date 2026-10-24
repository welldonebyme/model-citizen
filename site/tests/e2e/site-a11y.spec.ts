// QA gate (docs/07-quality.md): every page type, light and dark: no serious or critical axe violation,
// no page error, no console error, and no sideways scrolling of the page on a phone.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  '', 'path/', 'learn/ch00/', 'learn/ch00/ch00-s1/', 'learn/ch02/ch02-s3/', 'learn/ch04/ch04-s3/', 'learn/ch07/ch07-s2/',
  'learn/ch14/ch14-s4/', 'learn/ch22/ch22-s2/', 'learn/ch26/ch26-s4/', 'learn/ch28/', 'learn/appA/',
  'quiz/', 'quiz/ch07/', 'exams/', 'exams/exam-day/',
  'practice/', 'practice/traps/', 'practice/flashcards/', 'practice/notebook/', 'practice/drills/', 'practice/challenge/',
  'reference/', 'reference/glossary/', 'reference/cheatsheets/', 'reference/coverage/',
  'labs/', 'labs/sql/', 'labs/yaml/', 'labs/jinja/', 'labs/dbt/', 'labs/selectors/', 'labs/reference/', 'labs/capstone/',
  'progress/', 'settings/', 'about/',
];

for (const scheme of ['light', 'dark'] as const) {
  for (const path of PAGES) {
    test(`${scheme}: /${path}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
      await page.emulateMedia({ colorScheme: scheme });
      const res = await page.goto(path, { waitUntil: 'networkidle' });
      expect(res?.status(), 'HTTP status').toBe(200);
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const report = bad.map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.slice(0, 4).map((n) => `   ${n.target.join(' ')} :: ${n.failureSummary?.split('\n').slice(0, 2).join(' | ')}`).join('\n')}`).join('\n');
      expect(bad, report).toEqual([]);
      if (info.project.name === 'mobile') {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(wide, 'page scrolls sideways on a phone').toBeLessThanOrEqual(1);
      }
      expect(errors).toEqual([]);
    });
  }
}
