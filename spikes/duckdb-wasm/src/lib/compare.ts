/**
 * Formatting-insensitive comparison of SQL result sets against the book's printed output.
 *
 * Pure TypeScript, no DOM / Node APIs: runs in the browser (lab "matches expected" check)
 * and in Node (extractor, unit tests, CI parity report).
 *
 * What "formatting-insensitive" means here:
 *  - the ASCII box drawing, padding and alignment are ignored;
 *  - numbers are compared numerically (5.0 == 5, 25.20 == 25.2), floats to 12 significant digits;
 *  - booleans are case-insensitive (true / True / TRUE);
 *  - timestamps: "T" or space separator, a zero fractional part is ignored;
 *  - NULL in the book == SQL NULL;
 *  - column names are compared case-insensitively by default (SQL identifiers are), a case
 *    difference is reported as a warning;
 *  - row order is ignored unless the (last) statement has a top-level ORDER BY.
 */

/** A display value. `null` means SQL NULL. */
export type Cell = string | null;

export interface ExpectedTable {
  kind: 'table';
  columns: string[];
  rows: Cell[][];
  /** total number of rows of the real result (from the "(N rows)" footer, else rows.length) */
  totalRows: number;
  /** true when the book printed only some rows: "(18 rows, 5 shown)" */
  truncated: boolean;
  /** free text lines printed with the result, e.g. "-- both EXCEPT queries return 0 rows" */
  notes: string[];
}

export interface ExpectedError {
  kind: 'error';
  /** e.g. "Binder Error" */
  errorType: string;
  /** the message as printed, whitespace collapsed */
  message: string;
  notes: string[];
}

export type Expected = ExpectedTable | ExpectedError;

export type Actual =
  | { kind: 'table'; columns: string[]; rows: Cell[][] }
  | { kind: 'error'; message: string };

export interface CompareOptions {
  /** compare rows in order (default false). Use `hasTopLevelOrderBy(sql)` to decide. */
  ordered?: boolean;
  /** default 'insensitive' */
  columnNameCase?: 'insensitive' | 'sensitive';
  /** the book printed only some columns of the result (e.g. "name columns are hidden") */
  columnSubset?: boolean;
  /** the book printed only the first rows of the result, without a "(N rows, M shown)" footer */
  rowPrefix?: boolean;
  /** significant digits used to compare non-integer numbers (default 12) */
  significantDigits?: number;
  /** maximum number of row/cell differences listed (default 20) */
  maxDiffs?: number;
}

export type DiffKind =
  | 'columnCount'
  | 'columnName'
  | 'columnNameCase'
  | 'rowCount'
  | 'missingRow'
  | 'extraRow'
  | 'cell'
  | 'expectedErrorGotTable'
  | 'unexpectedError'
  | 'errorType'
  | 'errorMessage'
  | 'errorMessageExtra';

export interface Difference {
  kind: DiffKind;
  /** 'error' breaks the match, 'warning' is informational (e.g. a DuckDB hint line added to an error) */
  severity: 'error' | 'warning';
  detail: string;
}

export interface CompareReport {
  match: boolean;
  diffs: Difference[];
}

// ---------------------------------------------------------------------------------------------
// Parsing the book output
// ---------------------------------------------------------------------------------------------

const BORDER = /^\+[-+]+\+$/;
const FOOTER = /^\((\d+) rows?(?:,\s*(\d+) shown)?\)$/;
const ERROR_LINE = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)* Error): (.*)$/;

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

/** Parse an `outputcode` block of the book (ASCII table, optional footer, or an error message). */
export function parseBookOutput(text: string): Expected {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const notes: string[] = [];
  const body: string[] = [];
  for (const l of lines) {
    if (l.trim() === '') continue;
    if (l.trim().startsWith('--')) notes.push(l.trim().replace(/^--\s*/, ''));
    else body.push(l.trim());
  }
  if (body.length === 0) throw new Error('empty output block');

  const err = ERROR_LINE.exec(body[0]);
  if (err && !BORDER.test(body[0])) {
    const message = [err[2], ...body.slice(1)].join(' ').replace(/\s+/g, ' ').trim();
    return { kind: 'error', errorType: err[1], message, notes };
  }

  if (!BORDER.test(body[0])) throw new Error(`unrecognised output block, first line: ${body[0]}`);
  let i = 1;
  const header = body[i++];
  if (!header?.startsWith('|')) throw new Error('missing header row');
  const columns = splitRow(header);
  if (!BORDER.test(body[i++] ?? '')) throw new Error('missing border after header');
  const rows: Cell[][] = [];
  while (i < body.length && body[i].startsWith('|')) {
    const cells = splitRow(body[i++]);
    if (cells.length !== columns.length) {
      throw new Error(`row has ${cells.length} cells, header has ${columns.length}: ${body[i - 1]}`);
    }
    rows.push(cells.map((c) => (c === 'NULL' ? null : c)));
  }
  if (!BORDER.test(body[i++] ?? '')) throw new Error('missing closing border');
  let totalRows = rows.length;
  let truncated = false;
  for (; i < body.length; i++) {
    const f = FOOTER.exec(body[i]);
    if (f) {
      totalRows = Number(f[1]);
      truncated = f[2] !== undefined && Number(f[2]) < totalRows;
      if (f[2] !== undefined && Number(f[2]) !== rows.length) {
        throw new Error(`footer says ${f[2]} shown but ${rows.length} rows are printed`);
      }
    } else {
      notes.push(body[i]);
    }
  }
  return { kind: 'table', columns, rows, totalRows, truncated, notes };
}

// ---------------------------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------------------------

/**
 * Replace comments, string literals and quoted identifiers by neutral placeholders so that
 * keyword searches and statement splitting do not look inside them.
 */
export function maskSql(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      out += ' ';
    } else if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      out += ' ';
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) { i++; break; }
        else i++;
      }
      out += c === "'" ? "''" : '"q"';
    } else if (c === '$') {
      const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end < 0 ? n : end + tag.length;
        out += "''";
      } else { out += c; i++; }
    } else { out += c; i++; }
  }
  return out;
}

/** Split a script into statements (comment/string aware). Empty statements are dropped. */
export function splitSqlStatements(sql: string): string[] {
  // walk the masked text to find top-level semicolons, cut the ORIGINAL text at the same places
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) { i++; break; }
        else i++;
      }
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i));
      if (m) { const end = sql.indexOf(m[0], i + m[0].length); i = end < 0 ? n : end + m[0].length; continue; }
    }
    if (c === ';') { parts.push(sql.slice(start, i)); start = i + 1; }
    i++;
  }
  parts.push(sql.slice(start));
  return parts.filter((p) => maskSql(p).trim() !== '').map((p) => p.trim());
}

/** Does the LAST statement have an ORDER BY outside of any parentheses (CTE, subquery, OVER)? */
export function hasTopLevelOrderBy(sql: string): boolean {
  const stmts = splitSqlStatements(sql);
  if (stmts.length === 0) return false;
  let s = maskSql(stmts[stmts.length - 1]);
  let prev = '';
  while (prev !== s) { prev = s; s = s.replace(/\([^()]*\)/g, ' '); }
  return /\border\s+by\b/i.test(s);
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/;

/** Canonical form of one cell, used as comparison key. */
export function canonicalCell(v: Cell, significantDigits = 12): string {
  if (v === null || v === undefined) return '∅NULL';
  const s = String(v).trim();
  if (NUMBER.test(s)) {
    const x = Number(s);
    if (Number.isFinite(x)) {
      if (Number.isInteger(x)) return `#${x}`;
      return `#${Number(x.toPrecision(significantDigits))}`;
    }
  }
  if (/^(true|false)$/i.test(s)) return s.toLowerCase();
  const ts = TIMESTAMP.exec(s);
  if (ts) {
    const frac = (ts[3] ?? '').replace(/0+$/, '');
    return `${ts[1]} ${ts[2]}${frac ? '.' + frac : ''}`;
  }
  return `"${s}`;
}

function show(row: Cell[]): string {
  return '(' + row.map((c) => (c === null ? 'NULL' : c)).join(', ') + ')';
}

function parseActualError(message: string): { type: string; first: string; rest: string } {
  const m = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)* Error): ([\s\S]*)$/.exec(message.trim());
  const type = m ? m[1] : '';
  const text = m ? m[2] : message;
  // DuckDB appends hints and "LINE n: ..." context after the first paragraph / line
  const [first, ...rest] = text.split(/\n/);
  return { type, first: first.replace(/\s+/g, ' ').trim(), rest: rest.join('\n').trim() };
}

export function compareResults(expected: Expected, actual: Actual, opts: CompareOptions = {}): CompareReport {
  const diffs: Difference[] = [];
  const maxDiffs = opts.maxDiffs ?? 20;
  const sig = opts.significantDigits ?? 12;
  const push = (d: Difference) => { if (diffs.length < maxDiffs + 5) diffs.push(d); };

  // ---- errors
  if (expected.kind === 'error') {
    if (actual.kind !== 'error') {
      push({ kind: 'expectedErrorGotTable', severity: 'error', detail: `expected "${expected.errorType}: ${expected.message}" but the query succeeded` });
      return { match: false, diffs };
    }
    const a = parseActualError(actual.message);
    if (a.type !== expected.errorType) {
      push({ kind: 'errorType', severity: 'error', detail: `expected ${expected.errorType}, got ${a.type || '(untyped)'}: ${a.first}` });
    }
    const actualFlat = (a.first + ' ' + a.rest).replace(/\s+/g, ' ').trim();
    if (!actualFlat.startsWith(expected.message) && !a.first.startsWith(expected.message)) {
      push({ kind: 'errorMessage', severity: 'error', detail: `expected message "${expected.message}", got "${a.first}"` });
    } else if (a.first !== expected.message || a.rest) {
      const extra = (a.first.slice(expected.message.length) + ' ' + a.rest).replace(/\s+/g, ' ').trim();
      if (extra) push({ kind: 'errorMessageExtra', severity: 'warning', detail: `DuckDB adds: "${extra.slice(0, 200)}"` });
    }
    return { match: !diffs.some((d) => d.severity === 'error'), diffs };
  }
  if (actual.kind === 'error') {
    push({ kind: 'unexpectedError', severity: 'error', detail: actual.message.split('\n')[0] });
    return { match: false, diffs };
  }

  // ---- columns
  const ci = (opts.columnNameCase ?? 'insensitive') === 'insensitive';
  const norm = (c: string) => (ci ? c.toLowerCase() : c);
  let colMap: number[] = []; // expected column index -> actual column index
  if (opts.columnSubset) {
    for (const c of expected.columns) {
      const j = actual.columns.findIndex((a) => norm(a) === norm(c));
      if (j < 0) push({ kind: 'columnName', severity: 'error', detail: `column "${c}" not in result (${actual.columns.join(', ')})` });
      colMap.push(j);
    }
  } else {
    if (expected.columns.length !== actual.columns.length) {
      push({ kind: 'columnCount', severity: 'error', detail: `expected ${expected.columns.length} columns (${expected.columns.join(', ')}), got ${actual.columns.length} (${actual.columns.join(', ')})` });
    }
    expected.columns.forEach((c, k) => {
      const a = actual.columns[k];
      if (a === undefined) return;
      if (norm(a) !== norm(c)) push({ kind: 'columnName', severity: 'error', detail: `column ${k + 1}: expected "${c}", got "${a}"` });
      else if (a !== c) push({ kind: 'columnNameCase', severity: 'warning', detail: `column ${k + 1}: book prints "${c}", engine returns "${a}"` });
    });
    colMap = expected.columns.map((_, k) => k);
  }
  if (diffs.some((d) => d.severity === 'error')) return { match: false, diffs };

  const project = (row: Cell[]) => colMap.map((j) => (j < 0 ? null : row[j]));
  const actualRows = actual.rows.map(project);
  const key = (row: Cell[]) => JSON.stringify(row.map((c) => canonicalCell(c, sig)));

  // ---- row count
  const partial = expected.truncated || !!opts.rowPrefix;
  if (expected.truncated || !opts.rowPrefix) {
    if (actualRows.length !== expected.totalRows) {
      push({ kind: 'rowCount', severity: 'error', detail: `expected ${expected.totalRows} rows, got ${actualRows.length}` });
    }
  } else if (actualRows.length < expected.rows.length) {
    push({ kind: 'rowCount', severity: 'error', detail: `expected at least ${expected.rows.length} rows, got ${actualRows.length}` });
  }

  // ---- rows
  let listed = 0;
  if (opts.ordered) {
    const n = partial ? expected.rows.length : Math.max(expected.rows.length, actualRows.length);
    for (let r = 0; r < n && listed < maxDiffs; r++) {
      const e = expected.rows[r];
      const a = actualRows[r];
      if (!e) { push({ kind: 'extraRow', severity: 'error', detail: `row ${r + 1}: unexpected ${show(a)}` }); listed++; continue; }
      if (!a) { push({ kind: 'missingRow', severity: 'error', detail: `row ${r + 1}: missing ${show(e)}` }); listed++; continue; }
      e.forEach((ev, c) => {
        if (canonicalCell(ev, sig) !== canonicalCell(a[c], sig) && listed < maxDiffs) {
          push({ kind: 'cell', severity: 'error', detail: `row ${r + 1}, column "${expected.columns[c]}": expected ${ev ?? 'NULL'}, got ${a[c] ?? 'NULL'}` });
          listed++;
        }
      });
    }
  } else {
    const bag = new Map<string, number>();
    for (const a of actualRows) bag.set(key(a), (bag.get(key(a)) ?? 0) + 1);
    for (const e of expected.rows) {
      const k = key(e);
      const left = bag.get(k) ?? 0;
      if (left > 0) bag.set(k, left - 1);
      else if (listed++ < maxDiffs) push({ kind: 'missingRow', severity: 'error', detail: `missing ${show(e)}` });
    }
    if (!partial) {
      for (const a of actualRows) {
        const k = key(a);
        const left = bag.get(k) ?? 0;
        if (left > 0) {
          bag.set(k, left - 1);
          if (listed++ < maxDiffs) push({ kind: 'extraRow', severity: 'error', detail: `unexpected ${show(a)}` });
        }
      }
    }
  }
  return { match: !diffs.some((d) => d.severity === 'error'), diffs };
}

/** Convenience: parse the book text and compare in one call. */
export function checkAgainstBook(bookOutput: string, sql: string, actual: Actual, opts: Omit<CompareOptions, 'ordered'> & { ordered?: boolean } = {}): CompareReport {
  return compareResults(parseBookOutput(bookOutput), actual, { ordered: opts.ordered ?? hasTopLevelOrderBy(sql), ...opts });
}
