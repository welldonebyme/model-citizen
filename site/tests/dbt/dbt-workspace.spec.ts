// The workspace end to end: nothing heavy before the click, accessibility, persistence after a reload, reset,
// the sandbox messages (git, dbt deps), stop, and the lesson hook. Tests that start the engine are tagged @long.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { notes, run, startWorkspace } from './helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', '..', 'test-results', 'dbt-golden');

async function seriousViolations(page: import('@playwright/test').Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('nothing heavy loads before the click; the start card shows the size', async ({ page }) => {
  const engineRequests: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/engines/')) engineRequests.push(r.url()); });
  await page.goto('labs/dbt/?preset=ch07-start');
  await expect(page.getByRole('button', { name: 'Start dbt in your browser' })).toBeEnabled();
  await expect(page.getByText(/First start: about \d+(\.\d)? MB to download/)).toBeVisible();
  await expect(page.getByText('Real dbt-core 1.11.16 in your browser (WebAssembly, DuckDB 1.5.1, one thread)', { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(engineRequests.filter((u) => !u.endsWith('/engines/dbt/current.json'))).toEqual([]);
});

test('axe: no serious or critical violations on /labs/dbt/ (start card)', async ({ page }) => {
  await page.goto('labs/dbt/?preset=ch07-start');
  await expect(page.getByRole('button', { name: 'Start dbt in your browser' })).toBeEnabled();
  expect(await seriousViolations(page)).toEqual([]);
});

test('axe on the started workspace, lesson hook, git and history @long', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the accessibility scan of the started workspace');
  await startWorkspace(page, 'ch07-end');
  await run(page, 'dbt ls --resource-type source');
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole('tab', { name: 'What is different?' }).click();
  await expect(page.getByRole('heading', { name: 'What is different from your computer' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'dbt_project.yml' }).click();
  await expect(page.locator('.cm-content')).toContainText("name: 'jaffle_dbt'");
  expect(await seriousViolations(page)).toEqual([]);

  // git: a clear message, not an error of the terminal
  await run(page, 'git status');
  expect((await notes(page)).join('\n')).toContain('git runs on your computer');

  // the custom event of the lesson code blocks puts the command in the prompt
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('mc:dbt-try', { detail: { commands: ['dbt ls --select +dim_customers'] } })));
  await expect(page.locator('.t-input')).toHaveValue('dbt ls --select +dim_customers');

  // history: Up gives the previous commands
  await page.locator('.t-input').fill('');
  await page.locator('.t-input').press('ArrowUp');
  await expect(page.locator('.t-input')).toHaveValue('git status');
  await page.locator('.t-input').press('ArrowUp');
  await expect(page.locator('.t-input')).toHaveValue('dbt ls --resource-type source');
  // Ctrl+L clears the screen
  await page.locator('.t-input').press('Control+l');
  await expect(page.locator('.t-block')).toHaveCount(0);
});

test('lesson page: "Try in the browser terminal" buttons appear and fill the prompt @long', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the hook is plain DOM: one browser is enough');
  await page.goto('labs/dbt/example/');
  const tryButtons = page.getByRole('button', { name: 'Try in the browser terminal' });
  await expect(tryButtons).toHaveCount(2); // dbt blocks only (not the git block)
  await tryButtons.first().click();
  await expect(page.getByText('After the start, this command is ready in the terminal:')).toBeVisible();
  await page.getByRole('button', { name: 'Start dbt in your browser' }).click();
  await expect(page.locator('.t-input:not([readonly])')).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('.t-input')).toHaveValue('dbt run');
  await page.locator('.t-input').press('Enter');
  await expect(page.locator('.t-input:not([readonly])')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.t-log')).toContainText('Nothing to do');
  await expect(page.locator('.t-input')).toHaveValue('dbt build'); // the next command of the same block
  expect(await seriousViolations(page)).toEqual([]);
});

test('persistence after a reload, warm start from the cache, and reset @long', async ({ page, browserName }) => {
  const cold = await startWorkspace(page, 'ch07-start');
  let r = await run(page, 'mkdir -p models && echo "select 1 as x" > models/browser_test.sql');
  expect(r.code).toBe(0);
  r = await run(page, 'dbt run');
  expect(r.lines.join('\n')).toContain('OK created sql view model dbt_adnane.browser_test');
  // an edit in the editor, saved with Ctrl/Cmd+S
  await page.getByRole('button', { name: 'dbt_project.yml' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText("name: 'jaffle_dbt'");
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n# edited in the browser\n');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.f-editor')).toContainText('Saved dbt_project.yml');

  // reload: the same workspace comes back, the engine starts from the service worker cache
  await page.reload();
  const t0 = Date.now();
  const warm = await startWorkspace(page, 'ch07-start');
  const warmReadyMs = Date.now() - t0;
  await expect(page.locator('.t-log')).toContainText('Your saved workspace for Chapter 7 is back');
  expect((await run(page, 'cat models/browser_test.sql')).lines).toEqual(['select 1 as x']);
  expect((await run(page, 'grep -c "edited in the browser" dbt_project.yml')).lines).toEqual(['1']);
  const q = await run(page, 'duckdb ../practice/practice.duckdb -c "select count(*) as n from dbt_adnane.browser_test"');
  expect(q.code).toBe(0);
  expect(q.lines.join('\n')).toMatch(/│\s+1\s+│/);

  // reset to the start of the chapter
  await page.getByRole('button', { name: 'Workspace' }).click();
  await page.getByRole('button', { name: 'Reset to the start of this chapter' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('.t-input:not([readonly])')).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('.t-log')).toContainText('Ready: Chapter 7, start of the labs');
  expect((await run(page, 'ls models')).lines.join('\n')).not.toContain('browser_test.sql');
  expect((await run(page, 'grep -c "edited in the browser" dbt_project.yml')).lines).toEqual(['0']);
  const t = await run(page, `duckdb ../practice/practice.duckdb -c "select count(*) as n from information_schema.tables where table_name = 'browser_test'"`);
  expect(t.lines.join('\n')).toMatch(/│\s+0\s+│/);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${browserName}-persistence.json`), JSON.stringify({ cold, warm, warmReadyMs }, null, 1));
  console.log(browserName, 'cold', cold.wallMs, 'ms (cached before:', !cold.cold, ') warm', warm.wallMs, 'ms (cached before:', !warm.cold, '), ready after reload', warmReadyMs, 'ms');
  expect(warm.cold).toBe(false); // every engine file was in the cache before the second start
});

test('sandbox: dbt deps installs the saved packages, apply day2, Stop @long', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'shell features are the same code in every browser');
  await startWorkspace(page, 'ch12-start');
  let r = await run(page, 'dbt clean');
  expect(r.code).toBe(0);
  r = await run(page, 'dbt deps');
  expect(r.code).toBe(0);
  const n = (await notes(page)).join('\n');
  expect(n).toContain('Installed dbt-labs/dbt_utils 1.4.1 into dbt_packages/dbt_utils');
  expect(n).toContain('Installed dbt-labs/audit_helper 0.14.0 into dbt_packages/audit_helper');
  r = await run(page, 'dbt compile --inline "select {{ dbt_utils.generate_surrogate_key([\'a\', \'b\']) }} as k"');
  expect(r.code).toBe(0);
  r = await run(page, 'apply day2');
  expect(r.code).toBe(0);
  r = await run(page, 'duckdb ../practice/practice.duckdb -c "select count(*) as n from jaffle_shop.orders"');
  expect(r.lines.join('\n')).toMatch(/│\s+320\s+│/);
  // Stop a long command: the engine restarts and the terminal works again
  const input = page.locator('.t-input');
  await input.fill('dbt build');
  await input.press('Enter');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.t-log')).toContainText('Stopped.', { timeout: 120_000 });
  await expect(page.locator('.t-input:not([readonly])')).toBeVisible({ timeout: 240_000 });
  r = await run(page, 'pwd');
  expect(r.lines).toEqual(['/home/pyodide/dbt-course/jaffle_dbt']);
});
