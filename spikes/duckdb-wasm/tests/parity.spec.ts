import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ParityReport } from '../src/components/ParityRunner';

/**
 * Runs every extracted Chapter 4 example in the browser (book order, one session), compares with the
 * book using src/lib/compare.ts (in the page), checks day2.sql, and writes results/parity-<browser>.{json,md}.
 */
test('chapter 4 parity + day2.sql', async ({ page, browserName }) => {
  await page.goto('parity/');
  await expect(page.getByTestId('parity-done').or(page.getByTestId('parity-error'))).toBeVisible({ timeout: 170_000 });
  const err = await page.evaluate(() => window.__parityError);
  expect(err, 'parity runner error').toBeUndefined();
  const report = (await page.evaluate(() => window.__parity)) as ParityReport;

  mkdirSync('results', { recursive: true });
  writeFileSync(`results/parity-${browserName}.json`, JSON.stringify(report, null, 2));
  const md = [
    `# Chapter 4 parity — ${browserName}`,
    '',
    `DuckDB ${report.info.duckdbVersion} (${report.info.sourceId}), bundle \`${report.info.bundle}\`, @duckdb/duckdb-wasm ${report.info.libraryVersion}`,
    `User agent: ${report.userAgent}`,
    `**${report.passed}/${report.total} match**, total ${report.totalMs} ms`,
    '',
    '| Example | Result | Differences (error) | Notes (warning / annotation) |',
    '|---|---|---|---|',
    ...report.rows.map((r) => `| \`${r.id}\` | ${r.match ? 'match' : '**DIFF**'} | ${r.diffs.filter((d) => d.severity === 'error').map((d) => d.detail).join('<br>').replace(/\|/g, '\\|')} | ${[...r.diffs.filter((d) => d.severity === 'warning').map((d) => d.detail), r.annotation ?? ''].filter(Boolean).join('<br>').replace(/\|/g, '\\|')} |`),
    '',
    '## day2.sql',
    '',
    '| Check | Expected (README) | Actual | |',
    '|---|---|---|---|',
    ...report.day2.checks.map((c) => `| ${c.name} | ${c.expected} | ${c.actual} | ${c.ok ? 'OK' : '**FAIL**'} |`),
    '',
  ].join('\n');
  writeFileSync(`results/parity-${browserName}.md`, md);
  console.log(`[${browserName}] parity ${report.passed}/${report.total}, day2 ${report.day2.checks.filter((c) => c.ok).length}/${report.day2.checks.length}, ${report.totalMs} ms`);

  for (const r of report.rows) expect.soft(r.match, `${r.id}: ${r.diffs.map((d) => d.detail).join('; ')}`).toBe(true);
  for (const c of report.day2.checks) expect.soft(c.ok, `day2 ${c.name}: ${c.actual} vs ${c.expected}`).toBe(true);
  expect(report.total).toBeGreaterThanOrEqual(15);
});
