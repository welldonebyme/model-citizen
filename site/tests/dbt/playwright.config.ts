// Playwright for "dbt in the browser": the built site under the base path (npm run build:fast && npm run preview).
//   npx playwright test -c tests/dbt/playwright.config.ts                  all tests, 3 browsers
//   npm run e2e:dbt                                                         quick tests (no engine start)
//   npm run e2e:dbt:long                                                    engine tests (golden logs, persistence)
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.DBT_E2E_PORT ?? 4322);
// a private build (so other builds of dist/ cannot change the site under the tests):
//   node scripts/dbt/build-engine.mjs --quiet && node scripts/sync-assets.mjs && npx astro build --outDir node_modules/.dist-dbt
//   DBT_E2E_OUTDIR=node_modules/.dist-dbt DBT_E2E_PORT=4343 npx playwright test -c tests/dbt/playwright.config.ts
const OUTDIR = process.env.DBT_E2E_OUTDIR;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '../../test-results/dbt',
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // each engine uses 200 to 340 MB of memory: one browser at a time
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/model-citizen/`,
    trace: 'retain-on-failure',
    viewport: { width: 1360, height: 950 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 950 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1360, height: 950 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1360, height: 950 } } },
  ],
  webServer: {
    command: OUTDIR ? `npx astro preview --outDir ${OUTDIR} --port ${PORT} --host 127.0.0.1 --ignore-lock` : 'npm run preview',
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/model-citizen/`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
