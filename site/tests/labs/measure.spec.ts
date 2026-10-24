import { test, type Page } from '@playwright/test';
import { pyReady, sqlReady, writeReport } from './helpers';

// Timings (Chromium only, tagged @long @measure): time from navigation start to "engine ready" and to the first
// result, cold (empty cache, no service worker), warm (second visit, service worker), and cold on a slow link
// (a second server on port 4411 throttled to 9 Mbit/s shared by all connections, 40 ms latency). Median of 3.
// Start it first:  THROTTLE_MBIT=9 LATENCY_MS=40 PORT=4411 node scripts/labs/serve.mjs
test.use({ serviceWorkers: 'allow' });

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const SLOW = 'http://127.0.0.1:4411/model-citizen/';

async function sqlVisit(page: Page, base = '') {
  await page.goto(base + 'labs/sql/');
  await sqlReady(page);
  const ready = await page.evaluate(() => (globalThis as Record<string, number>).__mcSqlReadyAt);
  await page.getByTestId('run').click();
  await page.getByTestId('result-grid').waitFor();
  const first = await page.evaluate(() => performance.now());
  return { ready: Math.round(ready), firstResult: Math.round(first) };
}

async function pyVisit(page: Page, base = '') {
  await page.goto(base + 'labs/yaml/');
  await pyReady(page);
  await page.getByTestId('yaml-error').waitFor();
  return { ready: Math.round(await page.evaluate(() => performance.now())) };
}

test('@long @measure engine timings', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'timings: Chromium only');
  test.skip(!(await fetch(SLOW).then((r) => r.ok, () => false)), 'start the throttled server on port 4411 first');
  test.setTimeout(600_000);
  const out: Record<string, unknown> = {};
  for (const [name, fn] of [['sql', sqlVisit], ['yaml', pyVisit]] as const) {
    const cold: number[] = []; const warm: number[] = []; const slow: number[] = []; const firsts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const c = await fn(page);
      cold.push(c.ready); if ('firstResult' in c) firsts.push(c.firstResult as number);
      await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
      const w = await fn(page);
      warm.push(w.ready);
      await ctx.close();
      const ctx2 = await browser.newContext();
      const p2 = await ctx2.newPage();
      slow.push((await fn(p2, SLOW)).ready);
      await ctx2.close();
    }
    out[name] = { coldReadyMs: median(cold), coldFirstResultMs: firsts.length ? median(firsts) : undefined, warmReadyMs: median(warm), slowLink9MbitColdReadyMs: median(slow), runs: { cold, warm, slow } };
  }
  writeReport('timings-chromium.json', out);
  console.log('timings', JSON.stringify(out));
});
