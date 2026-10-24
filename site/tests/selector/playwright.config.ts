// Screenshots and accessibility checks of /labs/selectors/ (light + dark, desktop + phone).
//   npx playwright test -c tests/selector/playwright.config.ts
// Runs against a production build in its own folder and port (never dist/ or someone else's dev server).
// SEL_URL=<base url> runs against another server (for example a private dev server).
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.SEL_PORT ?? 4346);
const BASE = process.env.SEL_URL ?? `http://127.0.0.1:${PORT}/model-citizen/`;
const OUT = 'node_modules/.selector-dist';
const CONFIG = 'tests/selector/astro.selector.config.mjs';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  outputDir: '../../test-results/selector',
  use: { baseURL: BASE, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.SEL_URL ? undefined : {
    command: `npx astro build --config ${CONFIG} --outDir ${OUT} && npx astro preview --config ${CONFIG} --outDir ${OUT} --port ${PORT} --host 127.0.0.1 --ignore-lock`,
    cwd: '../..',
    url: BASE,
    reuseExistingServer: !!process.env.SEL_REUSE,
    timeout: 300_000,
    stdout: 'ignore',
  },
});
