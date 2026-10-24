import { expect, test } from '@playwright/test';
import { sqlReady, writeReport } from './helpers';
import data from '../../src/lib/sql/book-sql.json' with { type: 'json' };

/**
 * The SQL parity suite: every book SQL example with a printed result (book-sql.json: Chapter 4 + Chapter 18),
 * run in book order on one fresh database, compared with the book; then the day-2 counts of labs/updates/README.md.
 * Writes test-results/labs-reports/sql-parity-<browser>.{json,md}.
 */
test('@long SQL parity: every book example, then day2.sql', async ({ page, browserName }) => {
  test.setTimeout(300_000);
  await page.goto('labs/sql/');
  await sqlReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-sql-runner', 'ready');
  const report = await page.evaluate(() => window.__mcSqlParity!());
  const day2 = await page.evaluate(() => window.__mcSqlDay2!());

  const perChapter = data.perChapter.map((c) => {
    const rows = report.rows.filter((r) => r.chapter === c.chapter);
    return { chapter: c.chapter, blocksWithResult: c.blocksWithResult, checked: rows.length, matched: rows.filter((r) => r.match).length, skipped: c.skipped };
  });
  writeReport(`sql-parity-${browserName}.json`, { info: report.info, userAgent: report.userAgent, totalMs: report.totalMs, perChapter, rows: report.rows, day2, skipped: data.skipped });
  writeReport(`sql-parity-${browserName}.md`, [
    `# SQL parity, ${browserName}`, '', `DuckDB ${String(report.info.duckdbVersion)}, ${report.passed}/${report.total} checks match, ${report.totalMs} ms`, '',
    '| Chapter | blocks with a result | checked | matched | skipped |', '|---|---:|---:|---:|---:|',
    ...perChapter.map((c) => `| ${c.chapter} | ${c.blocksWithResult} | ${c.checked} | ${c.matched} | ${c.skipped} |`), '',
    '| Example | Result | Notes |', '|---|---|---|',
    ...report.rows.map((r) => `| ${r.id} | ${r.match ? 'match' : '**DIFF**'} | ${[r.summary, ...r.diffs.map((d) => `${d.severity}: ${d.detail}`), r.annotation ?? ''].filter(Boolean).join('<br>').replace(/\|/g, '\\|')} |`),
    '', '## Skipped', '', ...data.skipped.map((s) => `- ${s.codeId} (${s.category}): ${s.reason}`), '',
    '## day2.sql', '', ...day2.checks.map((c) => `- ${c.ok ? 'OK' : 'FAIL'} ${c.name}: ${c.actual} (expected ${c.expected})`), '',
  ].join('\n'));
  console.log(`[${browserName}] SQL parity ${report.passed}/${report.total}; ${perChapter.map((c) => `${c.chapter} ${c.matched}/${c.checked} (+${c.skipped} skipped)`).join(', ')}; day2 ${day2.checks.filter((c) => c.ok).length}/${day2.checks.length}; ${report.totalMs} ms`);

  for (const r of report.rows) expect.soft(r.match, `${r.id}: ${r.summary} ${r.diffs.map((d) => d.detail).join('; ')}`).toBe(true);
  for (const c of day2.checks) expect.soft(c.ok, `day2 ${c.name}: ${c.actual} vs ${c.expected}`).toBe(true);
  expect(report.total).toBe(data.examples.length);
});
