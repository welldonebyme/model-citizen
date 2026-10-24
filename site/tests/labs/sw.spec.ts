import { expect, test } from '@playwright/test';
import { clearServed, pyReady, served, sqlReady } from './helpers';

// The site's ONE service worker (public/sw.js): a warm visit downloads no engine file again
// (DuckDB wasm + worker, practice data, Pyodide core + wheels): they come from Cache Storage.
test.use({ serviceWorkers: 'allow' });

test('warm visit of the SQL playground: no engine or data download', async ({ page }) => {
  await page.goto('labs/sql/');
  await sqlReady(page);
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  expect(scope).toMatch(/\/model-citizen\/$/);
  const cached = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('mc-sql-')).sort());
  expect(cached).toEqual(expect.arrayContaining(['mc-sql-duckdb', expect.stringMatching(/^mc-sql-data-[0-9a-f]{12}$/)]));
  await clearServed();
  await page.goto('labs/sql/');
  await sqlReady(page);
  const paths = await served();
  const engine = paths.filter((p) => /duckdb-(eh|browser-eh\.worker)\.[\w-]+\.(wasm|js)$/.test(p) || p.startsWith('/model-citizen/data/'));
  expect(engine, `re-downloaded: ${engine.join(', ')}`).toEqual([]);
  // the service worker does not keep pages (only engine files and data)
  const pageInCache = await page.evaluate(async () => {
    for (const k of await caches.keys()) if (await (await caches.open(k)).match(location.href)) return true;
    return false;
  });
  expect(pageInCache).toBe(false);
});

test('warm visit of the YAML playground: no Pyodide download', async ({ page }) => {
  await page.goto('labs/yaml/');
  await pyReady(page);
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  expect(await page.evaluate(async () => (await caches.keys()).includes('mc-engines-pyodide-314.0.7'))).toBe(true);
  await clearServed();
  await page.goto('labs/yaml/');
  await pyReady(page);
  const paths = await served();
  const py = paths.filter((p) => p.startsWith('/model-citizen/engines/pyodide/'));
  expect(py, `re-downloaded: ${py.join(', ')}`).toEqual([]);
});
