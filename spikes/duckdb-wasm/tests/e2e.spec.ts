import { expect, test } from '@playwright/test';

/**
 * Loads the BUILT static site (served under /dbt-academy/ without COOP/COEP headers),
 * waits for the lazily loaded DuckDB-WASM engine, runs a query and asserts the result.
 */
test('lab page: text first, engine lazy, query result matches the book', async ({ page, browserName }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto('lab/');
  // lesson text is server-rendered HTML: visible before any engine code runs
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lab: revenue per payment method');

  const lab = page.getByTestId('lab-lab-group-by');
  await expect(lab.getByTestId('engine-status')).toHaveAttribute('data-phase', 'ready');
  await lab.getByTestId('run').click();

  const grid = lab.getByTestId('result-grid');
  await expect(grid).toBeVisible();
  await expect(grid.locator('thead th')).toHaveText(['paymentmethod', 'n_payments', 'total_dollars']);
  await expect(grid.locator('tbody tr')).toHaveCount(4);
  await expect(grid.locator('tbody tr').first().locator('td')).toHaveText(['credit_card', '204', '3477.2']);
  await expect(lab.getByTestId('match-status')).toHaveAttribute('data-match', 'true');

  // edit the query in CodeMirror and run it with the keyboard shortcut
  await lab.getByTestId('sql-editor').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type("select count(*) as n from practice.jaffle_shop.orders where status = 'placed'");
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await expect(grid.locator('tbody tr').first().locator('td')).toHaveText(['10']);
  await expect(lab.getByTestId('match-status')).toHaveAttribute('data-match', 'false');

  // day 2: the 10 placed orders are shipped
  await lab.getByTestId('apply-day2').click();
  await expect(lab.getByTestId('notice')).toContainText('jaffle_shop.orders = 320');
  await lab.getByTestId('run').click();
  await expect(grid.locator('tbody tr').first().locator('td')).toHaveText(['0']);
  await lab.getByTestId('reset').click();
  await expect(lab.getByTestId('notice')).toContainText('reset');
  await lab.getByTestId('run').click();
  await expect(grid.locator('tbody tr').first().locator('td')).toHaveText(['10']);

  // the second island on the page shares the same engine and checks an expected error
  const err = page.getByTestId('lab-lab-binder-error');
  await err.getByTestId('run').click();
  await expect(err.getByTestId('result-error')).toContainText('Binder Error');
  await expect(err.getByTestId('match-status')).toHaveAttribute('data-match', 'true');

  const info = await page.evaluate(() => (globalThis as any).__sqlEngine.info);
  test.info().annotations.push({ type: 'engine', description: `${browserName}: DuckDB ${info.duckdbVersion} bundle=${info.bundle} lib=${info.libraryVersion}` });
  console.log(`[${browserName}] DuckDB ${info.duckdbVersion} (${info.sourceId}) bundle=${info.bundle} timings=${JSON.stringify(info.timingsMs)}`);

  // every request stays under the base path on our own origin (self-hosted, no CDN)
  const foreign = requests.filter((u) => !u.startsWith(new URL('.', page.url()).origin + '/dbt-academy/'));
  expect(foreign).toEqual([]);
  expect(requests.some((u) => /duckdb-(eh|mvp)\.[\w-]+\.wasm$/.test(u))).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('reading page ships zero JavaScript', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.goto('read/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.locator('script').count()).toBe(0);
  expect(scripts).toEqual([]);
});

test('base path: assets resolve under /dbt-academy/, root is 404', async ({ page, request }) => {
  const res = await request.get('/lab/', { failOnStatusCode: false });
  expect(res.status()).toBe(404); // nothing is served outside the base (like a GitHub project page)
  const r2 = await page.goto('lab');
  expect(r2?.url()).toMatch(/\/dbt-academy\/lab\/$/); // /lab -> /lab/ redirect
});
