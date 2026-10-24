// Playwright suite of the in-browser labs (SQL workspace and playground, YAML and Jinja playgrounds).
//
//   npm run labs:build                 builds the site (with the test-only lesson page) into .cache/labs/dist
//   npm run e2e:labs                   short suite, 3 desktop browsers + 1 phone
//   npm run e2e:labs:long              long suites (@long): the full SQL / YAML / Jinja parity, timeouts
//
// The server behaves like GitHub Pages: base path /model-citizen/, no COOP/COEP headers, gzip.
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.LABS_PORT ?? 4410);
const BASE = '/model-citizen/';
export const baseURL = `http://127.0.0.1:${PORT}${BASE}`;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  outputDir: fileURLToPath(new URL('../../test-results/labs', import.meta.url)),
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  // one worker: the service-worker test reads the server's request log, which parallel tests would fill
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node scripts/labs/serve.mjs',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: baseURL,
    reuseExistingServer: true,
    env: { PORT: String(PORT), BASE },
  },
  use: { baseURL, trace: 'retain-on-failure', actionTimeout: 30_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts$/ },
  ],
});
