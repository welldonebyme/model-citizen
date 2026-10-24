import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDbtSummary, parseDbtVersion, parseGitStatus, parseGitStatusShort, parseGitLogOneline, detect, compareOutput, parseTable } from '../../src/lib/verify/parsers';

type G = { id: string; kind: string; text: string; expected: Record<string, unknown> };
const golden: G[] = JSON.parse(readFileSync(new URL('../../../converter/golden/outputs.json', import.meta.url), 'utf8'));

describe('parsers reproduce every golden output (converter/golden/outputs.json)', () => {
  for (const g of golden) {
    it(`${g.id} ${g.kind}`, () => {
      expect(detect(g.text)).toBe(g.kind);
      if (g.kind === 'dbt_summary') {
        const s = parseDbtSummary(g.text)!;
        const { pass, warn, error, skip, no_op, total, completed, finished } = s;
        expect({ pass, warn, error, skip, no_op, total, completed, finished }).toEqual({
          pass: g.expected.pass, warn: g.expected.warn, error: g.expected.error, skip: g.expected.skip, no_op: g.expected.no_op,
          total: g.expected.total, completed: g.expected.completed ?? null, finished: g.expected.finished ?? null,
        });
      }
      if (g.kind === 'dbt_version') expect(parseDbtVersion(g.text)).toEqual(g.expected);
      if (g.kind === 'git_status') expect(parseGitStatus(g.text)).toEqual(g.expected);
      if (g.kind === 'git_status_short') expect(parseGitStatusShort(g.text)).toEqual(g.expected);
      if (g.kind === 'git_log_oneline') expect(parseGitLogOneline(g.text)).toEqual(g.expected);
    });
  }
});

describe('tolerance and verdicts', () => {
  const book = '20:35:41  Done. PASS=66 WARN=1 ERROR=0 SKIP=0 NO-OP=2 TOTAL=69';
  it('accepts Windows line endings, colours and other timestamps', () => {
    const mine = '\x1b[32m09:01:02\x1b[0m  Running with dbt=1.11.16\r\n09:01:09  Done. PASS=66 WARN=1 ERROR=0 SKIP=0 NO-OP=2 TOTAL=69\r\n';
    expect(compareOutput(book, mine).ok).toBe(true);
  });
  it('explains a different summary', () => {
    const v = compareOutput(book, '10:00:00  Done. PASS=60 WARN=1 ERROR=6 SKIP=0 NO-OP=2 TOTAL=69');
    expect(v.ok).toBe(false);
    expect(v.messages.join(' ')).toMatch(/ERROR: the book has 0, you have 6/);
  });
  it('checks the dbt version family, not the patch', () => {
    const b = 'Core:\n  - installed: 1.11.16\n\nPlugins:\n  - duckdb: 1.11.0 - Up to date!';
    expect(compareOutput(b, 'Core:\n  - installed: 1.11.18\nPlugins:\n  - duckdb: 1.11.2').ok).toBe(true);
    expect(compareOutput(b, 'Core:\n  - installed: 1.12.1\nPlugins:\n  - duckdb: 1.12.0').ok).toBe(false);
  });
  it('compares DuckDB tables order-insensitively', () => {
    const b = '┌───────┬──────┐\n│  id   │ name │\n│ int32 │ varchar │\n├───────┼──────┤\n│    17 │ Leo  │\n│    34 │ Leo  │\n└───────┴──────┘';
    const t = parseTable(b)!;
    expect(t.columns).toEqual(['id', 'name']);
    expect(t.rows).toEqual([['17', 'Leo'], ['34', 'Leo']]);
    expect(compareOutput(b, '| id | name |\n|----|------|\n| 34 | Leo |\n| 17 | Leo |').ok).toBe(true);
  });
});
