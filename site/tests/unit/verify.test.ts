import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDbtSummary, parseDbtVersion, parseGitStatus, parseGitStatusShort, parseGitLogOneline, detect, compareOutput, parseTable, parseFileList } from '../../src/lib/verify/parsers';

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

describe('file listings: the same files on macOS, WSL and Windows PowerShell (Lesson 6.3, ch06-c8)', () => {
  // the book's result of `find jaffle_dbt | sort` (macOS)
  const book = [
    'jaffle_dbt', 'jaffle_dbt/.gitignore', 'jaffle_dbt/analyses', 'jaffle_dbt/analyses/.gitkeep', 'jaffle_dbt/dbt_project.yml',
    'jaffle_dbt/macros', 'jaffle_dbt/macros/.gitkeep', 'jaffle_dbt/models', 'jaffle_dbt/models/example',
    'jaffle_dbt/models/example/my_first_dbt_model.sql', 'jaffle_dbt/models/example/my_second_dbt_model.sql',
    'jaffle_dbt/models/example/schema.yml', 'jaffle_dbt/README.md', 'jaffle_dbt/seeds', 'jaffle_dbt/seeds/.gitkeep',
    'jaffle_dbt/snapshots', 'jaffle_dbt/snapshots/.gitkeep', 'jaffle_dbt/tests', 'jaffle_dbt/tests/.gitkeep',
  ].join('\n');
  // what `Get-ChildItem -Recurse -Name jaffle_dbt | Sort-Object` prints: relative to the folder, with \, sorted without case
  const windows = [
    '.gitignore', 'analyses', 'analyses\\.gitkeep', 'dbt_project.yml', 'macros', 'macros\\.gitkeep', 'models', 'models\\example',
    'models\\example\\my_first_dbt_model.sql', 'models\\example\\my_second_dbt_model.sql', 'models\\example\\schema.yml',
    'README.md', 'seeds', 'seeds\\.gitkeep', 'snapshots', 'snapshots\\.gitkeep', 'tests', 'tests\\.gitkeep',
  ].join('\r\n');

  it('recognises a file listing', () => {
    expect(detect(book)).toBe('file_list');
    expect(detect(windows)).toBe('file_list');
    expect(parseFileList(windows)).toContain('models/example/schema.yml');
    // plain dbt ls output (no folder) stays a dbt ls listing
    expect(detect('jaffle_dbt.marts.dim_customers\njaffle_dbt.marts.fct_orders')).toBe('dbt_ls');
  });
  it('accepts the Windows PowerShell output of the Windows command', () => {
    const v = compareOutput(book, windows);
    expect(v.messages).toEqual([expect.stringMatching(/^Same 18 files and folders as the book in jaffle_dbt\./)]);
    expect(v.ok).toBe(true);
  });
  it('accepts the same output with the prompt line, in another order, or from find . inside the folder', () => {
    expect(compareOutput(book, `(.venv) PS> Get-ChildItem -Recurse -Name jaffle_dbt | Sort-Object\n${windows}\n`).ok).toBe(true);
    expect(compareOutput(book, book.split('\n').reverse().join('\n')).ok).toBe(true);
    const inside = ['.', ...book.split('\n').slice(1).map((p) => p.replace(/^jaffle_dbt\//, './'))].join('\n');
    expect(compareOutput(book, inside).ok).toBe(true);
  });
  it('still finds a missing or an extra file', () => {
    const v = compareOutput(book, windows.replace('seeds\\.gitkeep\r\n', '') + '\r\nlogs');
    expect(v.ok).toBe(false);
    expect(v.messages).toEqual(['Missing compared with the book: seeds/.gitkeep.', 'Not in the book: logs.']);
    // the folder name alone is not the listing (it used to be accepted)
    expect(compareOutput(book, 'jaffle_dbt').ok).toBe(false);
  });
  it('explains output that is not a plain list (Get-ChildItem without -Name)', () => {
    const table = '    Directory: C:\\Users\\you\\dbt-course\\jaffle_dbt\n\nMode   LastWriteTime   Length Name\n----   -------------   ------ ----\nd----  21/10/2026 22:00        analyses';
    const v = compareOutput(book, table);
    expect(v.ok).toBe(false);
    expect(v.messages[0]).toMatch(/not a plain list of files/);
  });
});
