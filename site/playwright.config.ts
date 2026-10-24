// End-to-end tests: Chromium (= Edge/Chrome on Windows), WebKit (= Safari), Firefox, and a phone.
// The tests run against a production build in its own folder and on its own port, so they never touch
// dist/ or the dev server someone else may be using. E2E_URL=<base url> runs them against another server.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4331);
const BASE = process.env.E2E_URL ?? `http://127.0.0.1:${PORT}/model-citizen/`;
const OUT = 'node_modules/.e2e-dist';
const CONFIG = 'tests/astro.e2e.config.mjs';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_URL ? undefined : {
    // the same steps as `npm run build` after astro: the search index and the offline file list
    command: `npx astro build --config ${CONFIG} --outDir ${OUT} && npx pagefind --site ${OUT} --output-subdir pagefind --glob "**/*.html" && node scripts/offline-manifest.mjs ${OUT} && npx astro preview --config ${CONFIG} --outDir ${OUT} --port ${PORT} --host 127.0.0.1 --ignore-lock`,
    url: BASE,
    reuseExistingServer: !!process.env.E2E_REUSE,
    timeout: 240_000,
    stdout: 'ignore',
  },
});
