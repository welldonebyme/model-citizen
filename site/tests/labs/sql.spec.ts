import { expect, test } from '@playwright/test';
import { clearServed, foreign, getEditor, served, setEditor, sqlReady, trackErrors, trackRequests } from './helpers';

test.describe('SQL engine and workspace', () => {
  test('engine loads under the base path with no COOP/COEP and no third party', async ({ page }) => {
    const errors = trackErrors(page);
    const urls = trackRequests(page);
    await clearServed();
    const resp = await page.goto('labs/sql/');
    expect(resp?.headers()['cross-origin-opener-policy']).toBeUndefined();
    expect(resp?.headers()['cross-origin-embedder-policy']).toBeUndefined();
    await sqlReady(page);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    const info = await page.evaluate(() => (globalThis as unknown as { __mcSqlEngine: { info: Record<string, unknown> } }).__mcSqlEngine.info);
    expect(info).toMatchObject({ duckdbVersion: 'v1.5.4', bundle: 'eh', libraryVersion: '1.33.1-dev57.0' });

    const ws = page.getByTestId('sql-workspace');
    await ws.getByTestId('run').click();
    const grid = ws.getByTestId('result-grid');
    await expect(grid.locator('thead th')).toHaveText(['id', 'first_name', 'email']);
    await expect(grid.locator('tbody tr')).toHaveCount(5);
    await expect(grid.locator('tbody tr').first().locator('td')).toHaveText(['17', 'Leo', 'NULL']);
    await expect(grid.locator('tbody tr').first().locator('td').nth(0)).toHaveClass(/num/);
    await expect(grid.locator('tbody tr').first().locator('td').nth(2)).toHaveClass(/null/);
    await expect(ws.getByTestId('result-meta')).toContainText('5 rows');

    const paths = await served();
    expect(paths.some((p) => /^\/model-citizen\/_assets\/duckdb-eh\.[\w-]+\.wasm$/.test(p))).toBe(true);
    expect(paths.some((p) => p.startsWith('/model-citizen/data/practice/setup.sql'))).toBe(true);
    expect(paths.filter((p) => !p.startsWith('/model-citizen/'))).toEqual([]);
    expect(foreign(urls)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('lesson page: two runnable blocks, the event API, restore and expected', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('labs/sql/lesson-test/');
    await expect(page.locator('html')).toHaveAttribute('data-workspace', 'ready');
    await sqlReady(page);
    const ws = page.getByTestId('sql-workspace');

    // block 1: a result table
    await page.locator('[data-send-to-workspace="ch04-c27"]').click();
    await expect(ws.getByTestId('match-status')).toHaveAttribute('data-match', 'true');
    await expect(ws.getByTestId('match-status')).toContainText('Matches the book');
    await expect(ws.getByTestId('result-grid').locator('thead th')).toHaveText(['a', 'b', 'c', 'd']);
    await expect(ws.getByTestId('example-info')).toContainText('lesson 4.4');

    // block 2: an error the book prints
    await page.locator('[data-send-to-workspace="ch04-c59"]').click();
    await expect(ws.getByTestId('result-error')).toContainText('Binder Error');
    await expect(ws.getByTestId('match-status')).toHaveAttribute('data-match', 'true');

    // change the query, run with the keyboard: differs; restore the book's query
    await setEditor(page, 'sql-editor', 'select status, count(*) as n\nfrom jaffle_shop.orders\ngroup by status;');
    await ws.getByTestId('sql-editor').click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(ws.getByTestId('match-status')).toHaveAttribute('data-match', 'false');
    await expect(ws.getByTestId('match-status')).toContainText('Differs from the book');
    await expect(ws.getByTestId('match-status')).toContainText('The book shows an error');
    await ws.getByTestId('restore').click();
    expect(await getEditor(page, 'sql-editor')).toBe('select status, user_id, count(*)\nfrom jaffle_shop.orders\ngroup by status;');
    await ws.getByTestId('toggle-expected').click();
    await expect(ws.getByTestId('expected')).toContainText('Binder Error: column "user_id" must appear in the GROUP BY clause');

    // the CustomEvent API (window and document)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mc:workspace-run', { detail: { sql: 'select 42 as answer', expectedText: '+--------+\n| answer |\n+--------+\n|     42 |\n+--------+' } })));
    await expect(ws.getByTestId('match-status')).toHaveAttribute('data-match', 'true');
    await expect(ws.getByTestId('result-grid').locator('tbody td')).toHaveText(['42']);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('mc:workspace-run', { detail: { codeId: 'ch04-c27' } })));
    await expect(ws.getByTestId('result-grid').locator('thead th')).toHaveText(['a', 'b', 'c', 'd']);
    await expect(ws.getByTestId('match-status')).toHaveAttribute('data-match', 'true');
    expect(errors).toEqual([]);
  });

  test('apply day 2, fresh load (self-hosted ICU) and reset', async ({ page }) => {
    const urls = trackRequests(page);
    await clearServed();
    await page.goto('labs/sql/');
    await sqlReady(page);
    const ws = page.getByTestId('sql-workspace');
    const count = async () => {
      await setEditor(page, 'sql-editor', 'select count(*) as n from jaffle_shop.orders');
      await ws.getByTestId('run').click();
      return ws.getByTestId('result-grid').locator('tbody td').first();
    };
    await expect(await count()).toHaveText('300');
    await ws.getByTestId('apply-day2').click();
    await expect(ws.getByTestId('notice')).toContainText('jaffle_shop.orders 320 rows');
    await expect(ws.getByTestId('data-state')).toHaveText('Data: day 1 + day 2');
    await expect(await count()).toHaveText('320');
    await ws.getByTestId('fresh-load').click();
    await expect(ws.getByTestId('notice')).toContainText('Fresh load done');
    await expect(ws.getByTestId('data-state')).toHaveText('Data: day 1 + day 2 + 1 fresh load');
    await expect(await count()).toHaveText('322');
    await ws.getByTestId('reset').click();
    await expect(ws.getByTestId('notice')).toContainText('back to day 1');
    await expect(await count()).toHaveText('300');
    // the time zone extension came from this site, not from extensions.duckdb.org
    expect((await served()).some((p) => p === '/model-citizen/data/duckdb-ext/v1.5.4/wasm_eh/icu.duckdb_extension.wasm')).toBe(true);
    expect(foreign(urls)).toEqual([]);
  });

  test('a query that runs too long can be stopped', async ({ page }) => {
    await page.goto('labs/sql/');
    await sqlReady(page);
    const ws = page.getByTestId('sql-workspace');
    await setEditor(page, 'sql-editor', 'select sum(a.range * b.range) from range(200000) a, range(200000) b');
    await ws.getByTestId('run').click();
    await expect(ws.getByTestId('stop')).toBeVisible({ timeout: 10_000 });
    await ws.getByTestId('stop').click();
    await expect(ws.getByTestId('notice')).toContainText('The query was stopped');
    await sqlReady(page);
    await setEditor(page, 'sql-editor', 'select count(*) as n from stripe.payments');
    await ws.getByTestId('run').click();
    await expect(ws.getByTestId('result-grid').locator('tbody td').first()).toHaveText('341');
  });
});
