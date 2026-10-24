import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4400);
const BASE = process.env.SITE_BASE ?? '/dbt-academy/';
const baseURL = `http://localhost:${PORT}${BASE}`;

export default defineConfig({
  testDir: 'tests',
  timeout: 180_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1, // timing measurements and 3 x 36 MB wasm loads: keep runs sequential
  reporter: [['list'], ['json', { outputFile: 'results/playwright-report.json' }]],
  webServer: {
    command: `node scripts/serve.mjs`,
    url: baseURL,
    reuseExistingServer: true,
    env: { PORT: String(PORT), BASE, DIST: process.env.DIST ?? 'dist' },
  },
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'unit', testMatch: /unit\/.*\.spec\.ts/ },
    { name: 'chromium', testMatch: /(e2e|parity)\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testMatch: /(e2e|parity)\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', testMatch: /(e2e|parity)\.spec\.ts/, use: { ...devices['Desktop Firefox'] } },
    { name: 'measure', testMatch: /measure\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
});
