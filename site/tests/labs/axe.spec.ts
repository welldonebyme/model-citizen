import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { pyReady, sqlReady, writeReport } from './helpers';

// axe-core on the three lab pages (and the lesson-like test page), in their working state: engine ready,
// a result, an error message or an exercise check on screen. No serious or critical violation allowed.
async function audit(page: Page, name: string, browserName: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  writeReport(`axe-${name}-${browserName}.json`, res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8) })));
  console.log(`[${browserName}] axe ${name}: ${res.violations.length} violations (${bad.length} serious/critical)${res.violations.length ? ': ' + res.violations.map((v) => `${v.id}(${v.impact})`).join(', ') : ''}`);
  expect(bad.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe (${scheme})`, () => {
    test.use({ colorScheme: scheme });
    test(`SQL playground`, async ({ page, browserName }) => {
      await page.goto('labs/sql/');
      await sqlReady(page);
      await page.getByTestId('run').click();
      await expect(page.getByTestId('result-grid')).toBeVisible();
      await page.locator('[data-send-to-workspace="ch04-c59"]').click();
      await expect(page.getByTestId('match-status')).toBeVisible();
      await page.getByTestId('toggle-expected').click();
      await audit(page, `sql-${scheme}`, browserName);
    });
    test(`lesson-like page with the workspace`, async ({ page, browserName }) => {
      await page.goto('labs/sql/lesson-test/');
      await sqlReady(page);
      await page.locator('[data-send-to-workspace="ch04-c27"]').click();
      await expect(page.getByTestId('match-status')).toBeVisible();
      await audit(page, `lesson-${scheme}`, browserName);
    });
    test(`YAML playground`, async ({ page, browserName }) => {
      await page.goto('labs/yaml/');
      await pyReady(page);
      await expect(page.getByTestId('yaml-error')).toBeVisible();
      await page.locator('[data-exercise="lab-broken-yml"]').click();
      await page.getByRole('button', { name: 'Hint' }).click();
      await audit(page, `yaml-${scheme}`, browserName);
    });
    test(`Jinja playground`, async ({ page, browserName }) => {
      await page.goto('labs/jinja/');
      await pyReady(page);
      await page.getByTestId('compile').click();
      await expect(page.getByTestId('compiled')).toBeVisible();
      await audit(page, `jinja-${scheme}`, browserName);
    });
  });
}
