// Unit + mutation tests of the SQL comparator (src/lib/sql/compare.ts), on every book example.
// Ported from spikes/duckdb-wasm/tests/unit/compare.spec.ts, extended to the whole book (book-sql.json).
import { describe, expect, test } from 'vitest';
import {
  canonicalCell, compareResults, hasTopLevelOrderBy, parseBookOutput, splitSqlStatements, tryParseBookOutput,
  type Actual, type Cell, type ExpectedTable,
} from '../../../src/lib/sql/compare.ts';
import data from '../../../src/lib/sql/book-sql.json';

type Ex = { id: string; sql: string; expectedRaw?: string; expectRowCount?: number; ordered: boolean; columnSubset?: boolean; rowPrefix?: boolean; kind: string; chapter: string };
const examples = data.examples as Ex[];
const tableExamples = examples.filter((e) => e.expectedRaw !== undefined);

describe('parseBookOutput', () => {
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
  test('a dbt log is not a result', () => {
    expect(tryParseBookOutput('22:12:06  1 of 1 FAIL 24 assert_x ... [FAIL 24 in 0.05s]')).toBeNull();
    expect(() => parseBookOutput('')).toThrow();
  });
  test('every extracted example parses', () => {
    for (const ex of tableExamples) expect(() => parseBookOutput(ex.expectedRaw!), ex.id).not.toThrow();
  });
});

describe('canonicalCell', () => {
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

describe('SQL helpers', () => {
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
    expect(splitSqlStatements('  ;  ; ')).toEqual([]);
    expect(splitSqlStatements('select "a;b" from t; select 2')).toEqual(['select "a;b" from t', 'select 2']);
  });
});

describe('plain-English differences', () => {
  const exp = parseBookOutput('+----+-------+\n| id | email |\n+----+-------+\n| 17 | NULL  |\n| 34 | NULL  |\n+----+-------+');
  test('match summary', () => {
    const r = compareResults(exp, { kind: 'table', columns: ['id', 'email'], rows: [['34', null], ['17', null]] });
    expect(r.match).toBe(true);
    expect(r.summary).toBe('2 rows, same columns and values.');
  });
  test('row count and missing row', () => {
    const r = compareResults(exp, { kind: 'table', columns: ['id', 'email'], rows: [['17', null]] });
    expect(r.match).toBe(false);
    expect(r.summary).toBe('The book shows 2 rows. Your result has 1 row.');
    expect(r.diffs.map((d) => d.plain)).toContain('This row of the book is not in your result: (34, NULL).');
  });
  test('order counts with ORDER BY', () => {
    const r = compareResults(exp, { kind: 'table', columns: ['id', 'email'], rows: [['34', null], ['17', null]] }, { ordered: true });
    expect(r.match).toBe(false);
    expect(r.summary).toMatch(/in another order/);
  });
  test('column names', () => {
    const r = compareResults(exp, { kind: 'table', columns: ['id', 'mail'], rows: [['17', null], ['34', null]] });
    expect(r.diffs[0].plain).toBe('Column 2 is called "mail". In the book it is called "email".');
  });
  test('errors', () => {
    const e = parseBookOutput('Binder Error: column "x" not found');
    expect(compareResults(e, { kind: 'table', columns: ['a'], rows: [] }).diffs[0].plain).toMatch(/ran without an error/);
    const ok = compareResults(e, { kind: 'error', message: 'Binder Error: column "x" not found\n\nLINE 1: select x\n               ^' });
    expect(ok.match).toBe(true);
    expect(ok.diffs[0].severity).toBe('warning');
    expect(compareResults(e, { kind: 'error', message: 'Parser Error: column "x" not found' }).match).toBe(false);
  });
  test('maxDiffs counts the rest', () => {
    const many = parseBookOutput('+---+\n| a |\n+---+\n' + Array.from({ length: 30 }, (_, i) => `| ${i} |`).join('\n') + '\n+---+');
    const r = compareResults(many, { kind: 'table', columns: ['a'], rows: [] }, { maxDiffs: 5 });
    expect(r.diffs.filter((d) => d.kind === 'missingRow')).toHaveLength(5);
    expect(r.more).toBeGreaterThan(0);
  });
});

/** Build an "actual" result equal to what the book shows (filling hidden rows / columns). */
function actualFromExpected(ex: Ex): Actual {
  const e = parseBookOutput(ex.expectedRaw!);
  if (e.kind === 'error') return { kind: 'error', message: `${e.errorType}: ${e.message}\n\nLINE 1: ...` };
  const rows: Cell[][] = e.rows.map((r) => [...r]);
  for (let i = rows.length; i < e.totalRows; i++) rows.push(e.columns.map((_, c) => `filler-${i}-${c}`));
  if (ex.rowPrefix) rows.push(e.columns.map(() => 'one more row'));
  const columns = ex.columnSubset ? [...e.columns, 'hidden_col'] : [...e.columns];
  return { kind: 'table', columns, rows: ex.columnSubset ? rows.map((r) => [...r, 'x']) : rows };
}
const opts = (ex: Ex) => ({ ordered: ex.ordered, columnSubset: ex.columnSubset, rowPrefix: ex.rowPrefix });

describe('mutation tests on every book example', () => {
  test('the index has the whole book', () => {
    expect(examples.length).toBe(70);
    expect(new Set(examples.map((e) => e.chapter))).toEqual(new Set(['ch04', 'ch18']));
    expect(data.skipped.length).toBe(7);
  });
  for (const ex of tableExamples) {
    test(ex.id, () => {
      const exp = parseBookOutput(ex.expectedRaw!);
      const same = actualFromExpected(ex);
      expect(compareResults(exp, same, opts(ex)).match, 'identical result must match').toBe(true);
      if (exp.kind === 'error') {
        expect(compareResults(exp, { kind: 'table', columns: ['x'], rows: [] }, opts(ex)).match).toBe(false);
        expect(compareResults(exp, { kind: 'error', message: `Parser Error: ${exp.message}` }, opts(ex)).match).toBe(false);
        expect(compareResults(exp, { kind: 'error', message: `${exp.errorType}: something else` }, opts(ex)).match).toBe(false);
        return;
      }
      const t = same as Extract<Actual, { kind: 'table' }>;
      if (exp.rows.length > 0) { // 1. one changed value
        const rows = t.rows.map((r) => [...r]);
        const c = rows[0].findIndex((v, j) => j < exp.columns.length && v !== null);
        if (c >= 0) { const v = rows[0][c]!; rows[0][c] = /^-?\d+(\.\d+)?$/.test(v) ? String(Number(v) + 1) : v + 'x'; } else rows[0][0] = '0';
        expect(compareResults(exp, { ...t, rows }, opts(ex)).match, 'changed value must not match').toBe(false);
      }
      if (t.rows.length > 0) expect(compareResults(exp, { ...t, rows: t.rows.slice(1) }, opts(ex)).match, 'missing row must not match').toBe(false); // 2.
      if (!ex.rowPrefix) expect(compareResults(exp, { ...t, rows: [...t.rows, t.columns.map(() => 'extra')] }, opts(ex)).match, 'extra row must not match').toBe(false); // 3.
      const columns = [...t.columns]; columns[0] = columns[0] + '_renamed'; // 4.
      expect(compareResults(exp, { ...t, columns }, opts(ex)).match, 'renamed column must not match').toBe(false);
      if (exp.rows.length >= 2 && JSON.stringify(exp.rows[0]) !== JSON.stringify(exp.rows[1])) { // 5. swapped rows: fail only with ORDER BY
        const rows = t.rows.map((r) => [...r]);
        [rows[0], rows[1]] = [rows[1], rows[0]];
        expect(compareResults(exp, { ...t, rows }, opts(ex)).match, ex.ordered ? 'ordered: swap must not match' : 'unordered: swap must match').toBe(!ex.ordered);
      }
    });
  }
});
