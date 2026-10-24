/**
 * Formatting-insensitive comparison of SQL result sets with the book's printed output.
 *
 * Pure TypeScript, no DOM / Node APIs: used by the workspace ("Matches the book"), the extractor
 * (scripts/labs/extract-sql.ts), the unit + mutation tests and the browser parity suite.
 * Ported from spikes/duckdb-wasm/src/lib/compare.ts (verified there on Chapter 4: 69/69).
 *
 * "Formatting-insensitive" means:
 *  - the ASCII box drawing, padding and alignment are ignored;
 *  - numbers are compared numerically (5.0 == 5, 25.20 == 25.2), non-integers to 12 significant digits;
 *  - booleans are case-insensitive (true / True / TRUE);
 *  - timestamps: "T" or space separator, a zero fractional part is ignored;
 *  - NULL in the book == SQL NULL;
 *  - column names are compared case-insensitively by default (a case difference is only a warning);
 *  - row order is ignored unless the (last) statement has a top-level ORDER BY.
 * Every difference also has a `plain` text: a short sentence in simple English for learners.
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
  /** technical detail (tests, reports) */
  detail: string;
  /** the same in simple English, for the learner */
  plain: string;
}

export interface CompareReport {
  match: boolean;
  diffs: Difference[];
  /** one sentence: "5 rows, same columns and values." / "The book shows 5 rows, your result has 4." */
  summary: string;
  /** how many differences were not listed (maxDiffs reached) */
  more: number;
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

/** Parse a "Result" block of the book (ASCII table, optional footer, or an error message). Throws if unknown. */
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

/** Like parseBookOutput, but returns null instead of throwing (e.g. a dbt log printed as "Result"). */
export function tryParseBookOutput(text: string): Expected | null {
  try {
    return parseBookOutput(text);
  } catch {
    return null;
  }
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

/** Split a script into statements (comment/string/$$ aware). Empty statements are dropped. */
export function splitSqlStatements(sql: string): string[] {
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

const showCell = (c: Cell) => (c === null ? 'NULL' : c);
function show(row: Cell[]): string {
  return '(' + row.map(showCell).join(', ') + ')';
}
const rowsWord = (n: number) => `${n} row${n === 1 ? '' : 's'}`;
const colsWord = (n: number) => `${n} column${n === 1 ? '' : 's'}`;

function parseActualError(message: string): { type: string; first: string; rest: string } {
  const m = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)* Error): ([\s\S]*)$/.exec(message.trim());
  const type = m ? m[1] : '';
  const text = m ? m[2] : message;
  // DuckDB appends hints and "LINE n: ..." context after the first line
  const [first, ...rest] = text.split(/\n/);
  return { type, first: first.replace(/\s+/g, ' ').trim(), rest: rest.join('\n').trim() };
}

export function compareResults(expected: Expected, actual: Actual, opts: CompareOptions = {}): CompareReport {
  const diffs: Difference[] = [];
  const maxDiffs = opts.maxDiffs ?? 20;
  const sig = opts.significantDigits ?? 12;
  let more = 0;
  const push = (d: Difference) => { if (diffs.length < maxDiffs + 5) diffs.push(d); else more++; };
  const done = (summary: string): CompareReport => ({ match: !diffs.some((d) => d.severity === 'error'), diffs, summary, more });

  // ---- errors
  if (expected.kind === 'error') {
    if (actual.kind !== 'error') {
      push({ kind: 'expectedErrorGotTable', severity: 'error', detail: `expected "${expected.errorType}: ${expected.message}" but the query succeeded`,
        plain: `The book shows an error (${expected.errorType}), but your query ran without an error.` });
      return done('The book shows an error here.');
    }
    const a = parseActualError(actual.message);
    if (a.type !== expected.errorType) {
      push({ kind: 'errorType', severity: 'error', detail: `expected ${expected.errorType}, got ${a.type || '(untyped)'}: ${a.first}`,
        plain: `The book shows a ${expected.errorType}. You got ${a.type ? `a ${a.type}` : 'a different error'}.` });
    }
    const actualFlat = (a.first + ' ' + a.rest).replace(/\s+/g, ' ').trim();
    if (!actualFlat.startsWith(expected.message) && !a.first.startsWith(expected.message)) {
      push({ kind: 'errorMessage', severity: 'error', detail: `expected message "${expected.message}", got "${a.first}"`,
        plain: `The error message is different. The book says: "${expected.message}"` });
    } else if (a.first !== expected.message || a.rest) {
      const extra = (a.first.slice(expected.message.length) + ' ' + a.rest).replace(/\s+/g, ' ').trim();
      if (extra) push({ kind: 'errorMessageExtra', severity: 'warning', detail: `DuckDB adds: "${extra.slice(0, 200)}"`,
        plain: 'DuckDB in the browser adds a hint or a line number after the message. The book does not print it.' });
    }
    return done(diffs.some((d) => d.severity === 'error') ? 'You got a different error.' : `Same error as the book: ${expected.errorType}.`);
  }
  if (actual.kind === 'error') {
    push({ kind: 'unexpectedError', severity: 'error', detail: actual.message.split('\n')[0],
      plain: 'Your query stopped with an error. The book shows a result table.' });
    return done('Your query stopped with an error.');
  }

  // ---- columns
  const ci = (opts.columnNameCase ?? 'insensitive') === 'insensitive';
  const norm = (c: string) => (ci ? c.toLowerCase() : c);
  let colMap: number[] = []; // expected column index -> actual column index
  if (opts.columnSubset) {
    for (const c of expected.columns) {
      const j = actual.columns.findIndex((a) => norm(a) === norm(c));
      if (j < 0) push({ kind: 'columnName', severity: 'error', detail: `column "${c}" not in result (${actual.columns.join(', ')})`,
        plain: `Your result has no column "${c}".` });
      colMap.push(j);
    }
  } else {
    if (expected.columns.length !== actual.columns.length) {
      push({ kind: 'columnCount', severity: 'error',
        detail: `expected ${expected.columns.length} columns (${expected.columns.join(', ')}), got ${actual.columns.length} (${actual.columns.join(', ')})`,
        plain: `The book shows ${colsWord(expected.columns.length)} (${expected.columns.join(', ')}). Your result has ${colsWord(actual.columns.length)} (${actual.columns.join(', ') || 'none'}).` });
    }
    expected.columns.forEach((c, k) => {
      const a = actual.columns[k];
      if (a === undefined) return;
      if (norm(a) !== norm(c)) push({ kind: 'columnName', severity: 'error', detail: `column ${k + 1}: expected "${c}", got "${a}"`,
        plain: `Column ${k + 1} is called "${a}". In the book it is called "${c}".` });
      else if (a !== c) push({ kind: 'columnNameCase', severity: 'warning', detail: `column ${k + 1}: book prints "${c}", engine returns "${a}"`,
        plain: `Column ${k + 1}: the book prints "${c}", DuckDB returns "${a}" (same name, other letter case).` });
    });
    colMap = expected.columns.map((_, k) => k);
  }
  if (diffs.some((d) => d.severity === 'error')) return done('The columns are different.');

  const project = (row: Cell[]) => colMap.map((j) => (j < 0 ? null : row[j]));
  const actualRows = actual.rows.map(project);
  const key = (row: Cell[]) => JSON.stringify(row.map((c) => canonicalCell(c, sig)));

  // ---- row count
  const partial = expected.truncated || !!opts.rowPrefix;
  let countOk = true;
  if (expected.truncated || !opts.rowPrefix) {
    if (actualRows.length !== expected.totalRows) {
      countOk = false;
      push({ kind: 'rowCount', severity: 'error', detail: `expected ${expected.totalRows} rows, got ${actualRows.length}`,
        plain: `The book shows ${rowsWord(expected.totalRows)}. Your result has ${rowsWord(actualRows.length)}.` });
    }
  } else if (actualRows.length < expected.rows.length) {
    countOk = false;
    push({ kind: 'rowCount', severity: 'error', detail: `expected at least ${expected.rows.length} rows, got ${actualRows.length}`,
      plain: `The book shows at least ${rowsWord(expected.rows.length)}. Your result has ${rowsWord(actualRows.length)}.` });
  }

  // ---- rows
  let listed = 0;
  let orderOnly = false;
  if (opts.ordered) {
    const n = partial ? expected.rows.length : Math.max(expected.rows.length, actualRows.length);
    for (let r = 0; r < n; r++) {
      const e = expected.rows[r];
      const a = actualRows[r];
      if (!e) { if (listed++ < maxDiffs) push({ kind: 'extraRow', severity: 'error', detail: `row ${r + 1}: unexpected ${show(a)}`, plain: `Row ${r + 1} is not in the book: ${show(a)}.` }); else more++; continue; }
      if (!a) { if (listed++ < maxDiffs) push({ kind: 'missingRow', severity: 'error', detail: `row ${r + 1}: missing ${show(e)}`, plain: `Row ${r + 1} is missing. The book shows ${show(e)}.` }); else more++; continue; }
      e.forEach((ev, c) => {
        if (canonicalCell(ev, sig) !== canonicalCell(a[c], sig)) {
          if (listed++ < maxDiffs) {
            push({ kind: 'cell', severity: 'error', detail: `row ${r + 1}, column "${expected.columns[c]}": expected ${showCell(ev)}, got ${showCell(a[c])}`,
              plain: `Row ${r + 1}, column "${expected.columns[c]}": the book shows ${showCell(ev)}, your result shows ${showCell(a[c])}.` });
          } else more++;
        }
      });
    }
    // same rows in another order? say so: it is the most common reason for a difference with ORDER BY
    if (diffs.some((d) => d.kind === 'cell' || d.kind === 'missingRow' || d.kind === 'extraRow') && countOk) {
      const unordered = compareResults(expected, actual, { ...opts, ordered: false, maxDiffs: 1 });
      orderOnly = unordered.match;
    }
  } else {
    const bag = new Map<string, number>();
    for (const a of actualRows) bag.set(key(a), (bag.get(key(a)) ?? 0) + 1);
    for (const e of expected.rows) {
      const k = key(e);
      const left = bag.get(k) ?? 0;
      if (left > 0) bag.set(k, left - 1);
      else if (listed++ < maxDiffs) push({ kind: 'missingRow', severity: 'error', detail: `missing ${show(e)}`, plain: `This row of the book is not in your result: ${show(e)}.` });
      else more++;
    }
    if (!partial) {
      for (const a of actualRows) {
        const k = key(a);
        const left = bag.get(k) ?? 0;
        if (left > 0) {
          bag.set(k, left - 1);
          if (listed++ < maxDiffs) push({ kind: 'extraRow', severity: 'error', detail: `unexpected ${show(a)}`, plain: `This row of your result is not in the book: ${show(a)}.` });
          else more++;
        }
      }
    }
  }
  const ok = !diffs.some((d) => d.severity === 'error');
  if (ok) {
    const shownNote = partial ? ` (the book prints ${expected.rows.length} of them)` : '';
    const rowsPart = opts.rowPrefix && !expected.truncated ? `the first ${rowsWord(expected.rows.length)}` : rowsWord(actualRows.length);
    return done(`${rowsPart[0].toUpperCase()}${rowsPart.slice(1)}${opts.rowPrefix && !expected.truncated ? '' : shownNote}, same columns and values${opts.ordered ? ', same order' : ''}.`);
  }
  if (orderOnly) return done('Same rows as the book, but in another order. This query has ORDER BY, so the order counts.');
  if (!countOk) return done(diffs.find((d) => d.kind === 'rowCount')!.plain);
  return done('Some values are different.');
}

/** Convenience: parse the book text and compare in one call. */
export function checkAgainstBook(bookOutput: string, sql: string, actual: Actual, opts: CompareOptions = {}): CompareReport {
  return compareResults(parseBookOutput(bookOutput), actual, { ...opts, ordered: opts.ordered ?? hasTopLevelOrderBy(sql) });
}
