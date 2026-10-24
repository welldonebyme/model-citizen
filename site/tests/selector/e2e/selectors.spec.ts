import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SEL_SHOTS ?? 'test-results/selector-shots';

async function open(page: Page, scheme: 'light' | 'dark', hash = '') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto(`labs/selectors/${hash}`);
  await expect(page.getByRole('heading', { name: /at tag/ })).toBeVisible();
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  return { bad, all: r.violations };
}

for (const scheme of ['light', 'dark'] as const) {
  test(`playground renders, ${scheme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, scheme);
    await expect(page.locator('.msl-term pre')).toContainText('jaffle_dbt.marts.fct_orders');
    // no horizontal page scroll (phone included)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${scheme}-top.png`, fullPage: false });
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${scheme}-full.png`, fullPage: true });
    const a = await axe(page);
    expect(a.bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('typing a command updates the output and the explanation', async ({ page }) => {
  await open(page, 'light');
  const input = page.getByLabel('dbt command', { exact: true });
  await input.fill('dbt ls -s "tag:finance, tag:marketing" --resource-type model');
  await expect(page.locator('.msl-term pre')).toContainText("The selection criterion 'tag:finance,' does not match any enabled nodes");
  await expect(page.locator('.msl-note').first()).toContainText('comma');
  await page.getByLabel('Shell').selectOption('zsh');
  await input.fill('dbt ls -s stg_*');
  await expect(page.locator('.msl-term pre')).toContainText('zsh: no matches found: stg_*');
  await page.getByLabel('Shell').selectOption('powershell');
  await expect(page.locator('.msl-term pre')).toContainText('jaffle_dbt.staging.stripe.stg_stripe__payments');
  await input.fill('dbt build -s stg_stripe__payments+');
  await expect(page.getByRole('heading', { name: /Order of execution/ })).toBeVisible();
});

test('graph is keyboard accessible, list view has the same nodes', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'keyboard test on desktop');
  await open(page, 'light');
  const first = page.locator('.msl-node[tabindex="0"]');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Node details' })).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.msl-table tbody tr')).toHaveCount(38);
  const a = await axe(page);
  expect(a.bad.map((v) => v.id)).toEqual([]);
});

test('a challenge is checked by the engine', async ({ page }, info) => {
  await open(page, 'dark');
  await page.getByRole('button', { name: /First-degree parents only/ }).click();
  const box = page.getByLabel('Your selection');
  await box.fill('+fct_orders');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.locator('.msl-feedback')).toContainText('Not yet');
  await box.fill('1+fct_orders');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.locator('.msl-feedback')).toContainText('Correct');
  await page.locator('.msl-ch-body').screenshot({ path: `${SHOTS}/${info.project.name}-dark-challenge.png` });
});

test('state scenario and shopflow project', async ({ page }, info) => {
  await open(page, 'light', '#p=jaffle-ch24&c=' + encodeURIComponent('dbt ls -s state:modified+ --state prod-artifacts'));
  await expect(page.locator('.msl-term pre')).toContainText('exposure:jaffle_dbt.monthly_revenue_dashboard');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-light-state.png`, fullPage: false });
  await open(page, 'dark', '#p=shopflow-m14&c=' + encodeURIComponent('dbt ls -s +fct_orders --resource-type model'));
  await page.getByLabel('Tests').check();
  await expect(page.locator('.msl-term pre')).toContainText('shopflow_dbt');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-dark-shopflow-tests.png`, fullPage: false });
  const a = await axe(page);
  expect(a.bad.map((v) => v.id)).toEqual([]);
});

test('facts panel: "Try it" loads the project, the command and the --state folder', async ({ page }, info) => {
  await open(page, 'light');
  await page.getByText('Where dbt 1.11.16 differs from the documentation').click();
  await page.getByRole('button', { name: /Try it: ls -s 1\+result:fail\+/ }).click();
  await expect(page.getByRole('heading', { name: 'jaffle_dbt at tag ch24' })).toBeVisible();
  await expect(page.getByLabel('The --state folder holds')).toHaveValue('ch24-test-fail');
  await expect(page.locator('.msl-term pre')).toContainText('jaffle_dbt.staging.jaffle_shop.stg_jaffle_shop__orders');
  await page.getByRole('button', { name: /Try it: ls --selector cli_union/ }).click();
  await expect(page.getByRole('heading', { name: 'jaffle_dbt at tag ch16' })).toBeVisible();
  await expect(page.locator('.msl-term pre')).toContainText('No nodes selected!');
  await page.locator('.msl-facts').screenshot({ path: `${SHOTS}/${info.project.name}-light-facts.png` });
  const a = await axe(page);
  expect(a.bad.map((v) => v.id)).toEqual([]);
});
