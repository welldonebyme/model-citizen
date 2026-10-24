import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  canonicalCell, compareResults, hasTopLevelOrderBy, parseBookOutput, splitSqlStatements,
  type Actual, type Cell, type ExpectedTable,
} from '../../src/lib/compare';

const examples: { id: string; sql: string; expectedRaw: string; ordered: boolean; columnSubset?: boolean; rowPrefix?: boolean }[] =
  JSON.parse(readFileSync('src/data/ch4-examples.json', 'utf8')).examples;

test.describe('parseBookOutput', () => {
  test('table with footer', () => {
    const e = parseBookOutput(`+----+------+\n| id | name |\n+----+------+\n|  1 | Lina |\n|  2 | NULL |\n+----+------+\n(2 rows)`);
    expect(e).toEqual({ kind: 'table', columns: ['id', 'name'], rows: [['1', 'Lina'], ['2', null]], totalRows: 2, truncated: false, notes: [] });
  });
  test('truncated footer and notes', () => {
    const e = parseBookOutput(`+---+\n| a |\n+---+\n| 1 |\n+---+\n(18 rows, 1 shown)\n-- a note`) as ExpectedTable;
    expect(e.truncated).toBe(true);
    expect(e.totalRows).toBe(18);
    expect(e.notes).toEqual(['a note']);
  });
  test('wrapped error message', () => {
    const e = parseBookOutput('Binder Error: column "user_id" must appear in the GROUP BY clause or must be\npart of an aggregate function.');
    expect(e).toEqual({ kind: 'error', errorType: 'Binder Error', message: 'column "user_id" must appear in the GROUP BY clause or must be part of an aggregate function.', notes: [] });
  });
  test('every extracted example parses', () => {
    for (const ex of examples) expect(() => parseBookOutput(ex.expectedRaw), ex.id).not.toThrow();
  });
});

test.describe('canonicalCell', () => {
  test('numbers, booleans, timestamps, NULL', () => {
    expect(canonicalCell('5.0')).toBe(canonicalCell('5'));
    expect(canonicalCell('25.20')).toBe(canonicalCell('25.2'));
    expect(canonicalCell('0.30000000000000004')).toBe(canonicalCell('0.3'));
    expect(canonicalCell('15.79')).not.toBe(canonicalCell('15.8'));
    expect(canonicalCell('True')).toBe(canonicalCell('true'));
    expect(canonicalCell('2025-01-06T02:51:00.000')).toBe(canonicalCell('2025-01-06 02:51:00'));
    expect(canonicalCell(null)).not.toBe(canonicalCell('NULL value'));
    expect(canonicalCell('Lina')).not.toBe(canonicalCell('lina'));
  });
});

test.describe('SQL helpers', () => {
  test('hasTopLevelOrderBy ignores windows, CTEs, subqueries, comments and strings', () => {
    expect(hasTopLevelOrderBy('select 1 order by 1')).toBe(true);
    expect(hasTopLevelOrderBy('SELECT 1\nORDER BY 3 DESC')).toBe(true);
    expect(hasTopLevelOrderBy('select row_number() over (order by x) from t')).toBe(false);
    expect(hasTopLevelOrderBy('with a as (select * from t order by 1) select * from a')).toBe(false);
    expect(hasTopLevelOrderBy("select 'order by' as s -- order by\nfrom t")).toBe(false);
    expect(hasTopLevelOrderBy('select 1 order by 1; select 2')).toBe(false); // only the last statement counts
  });
  test('splitSqlStatements respects strings, comments, dollar quotes', () => {
    expect(splitSqlStatements("select ';' as a; -- x; y\nselect $$;$$ /* ; */ as b;\n-- end")).toEqual(["select ';' as a", "-- x; y\nselect $$;$$ /* ; */ as b"]);
  });
});

/** Build an "actual" result equal to what the book shows (filling hidden rows / columns). */
function actualFromExpected(ex: (typeof examples)[number]): Actual {
  const e = parseBookOutput(ex.expectedRaw);
  if (e.kind === 'error') return { kind: 'error', message: `${e.errorType}: ${e.message}\n\nLINE 1: ...` };
  const rows: Cell[][] = e.rows.map((r) => [...r]);
  for (let i = rows.length; i < e.totalRows; i++) rows.push(e.columns.map((_, c) => `filler-${i}-${c}`));
  if (ex.rowPrefix) rows.push(e.columns.map(() => 'one more row'));
  const columns = ex.columnSubset ? [...e.columns, 'hidden_col'] : [...e.columns];
  return { kind: 'table', columns, rows: ex.columnSubset ? rows.map((r) => [...r, 'x']) : rows };
}

const opts = (ex: (typeof examples)[number]) => ({ ordered: ex.ordered, columnSubset: ex.columnSubset, rowPrefix: ex.rowPrefix });

test.describe('mutation tests on every book example', () => {
  for (const ex of examples) {
    test(ex.id, () => {
      const exp = parseBookOutput(ex.expectedRaw);
      const same = actualFromExpected(ex);
      expect(compareResults(exp, same, opts(ex)).match, 'identical result must match').toBe(true);

      if (exp.kind === 'error') {
        expect(compareResults(exp, { kind: 'table', columns: ['x'], rows: [] }, opts(ex)).match).toBe(false);
        expect(compareResults(exp, { kind: 'error', message: `Parser Error: ${exp.message}` }, opts(ex)).match).toBe(false);
        expect(compareResults(exp, { kind: 'error', message: `${exp.errorType}: something else` }, opts(ex)).match).toBe(false);
        return;
      }
      const t = same as Extract<Actual, { kind: 'table' }>;
      // 1. one changed value
      if (exp.rows.length > 0) {
        const rows = t.rows.map((r) => [...r]);
        const c = rows[0].findIndex((v, j) => j < exp.columns.length && v !== null);
        if (c >= 0) {
          const v = rows[0][c]!;
          rows[0][c] = /^-?\d+(\.\d+)?$/.test(v) ? String(Number(v) + 1) : v + 'x';
        } else rows[0][0] = '0';
        expect(compareResults(exp, { ...t, rows }, opts(ex)).match, 'changed value must not match').toBe(false);
      }
      // 2. one row less
      if (t.rows.length > 0) {
        expect(compareResults(exp, { ...t, rows: t.rows.slice(1) }, opts(ex)).match, 'missing row must not match').toBe(false);
      }
      // 3. one row more (unless the book shows only a prefix)
      if (!ex.rowPrefix) {
        expect(compareResults(exp, { ...t, rows: [...t.rows, t.columns.map(() => 'extra')] }, opts(ex)).match, 'extra row must not match').toBe(false);
      }
      // 4. renamed column
      const columns = [...t.columns]; columns[0] = columns[0] + '_renamed';
      expect(compareResults(exp, { ...t, columns }, opts(ex)).match, 'renamed column must not match').toBe(false);
      // 5. swapped rows: fails only for ORDER BY queries
      const shown = exp.rows.length;
      if (shown >= 2 && JSON.stringify(exp.rows[0]) !== JSON.stringify(exp.rows[1])) {
        const rows = t.rows.map((r) => [...r]);
        [rows[0], rows[1]] = [rows[1], rows[0]];
        expect(compareResults(exp, { ...t, rows }, opts(ex)).match, ex.ordered ? 'ordered: swap must not match' : 'unordered: swap must match').toBe(!ex.ordered);
      }
    });
  }
});
