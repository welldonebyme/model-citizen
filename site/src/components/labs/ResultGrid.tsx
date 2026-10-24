/** Result table of a query: NULL in italics, numbers right-aligned, long results cut with a note. */
import { useState } from 'react';
import type { Cell } from '../../lib/sql/compare.ts';

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export interface ResultGridProps {
  columns: string[];
  rows: Cell[][];
  /** per column: is it a number type? (default: guessed from the values) */
  numeric?: boolean[];
  /** rows of the real result (rows may hold fewer) */
  totalRows?: number;
  caption?: string;
  testId?: string;
  /** first page size (default 200) */
  pageSize?: number;
}

export function ResultGrid({ columns, rows, numeric, totalRows, caption, testId, pageSize = 200 }: ResultGridProps) {
  const [limit, setLimit] = useState(pageSize);
  const isNum = numeric ?? columns.map((_, c) => rows.length > 0 && rows.every((r) => r[c] === null || NUM.test(String(r[c]))) && rows.some((r) => r[c] !== null));
  const shown = rows.slice(0, limit);
  const total = totalRows ?? rows.length;
  return (
    <div className="mcl-grid-wrap">
      <table className="mcl-grid" data-testid={testId}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>{columns.map((c, i) => <th key={i} scope="col" className={isNum[i] ? 'num' : undefined}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={v === null ? 'null' : isNum[j] ? 'num' : undefined}>{v === null ? 'NULL' : v === '' ? <span className="empty" aria-label="empty text">''</span> : v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="mcl-grid-more">
          {shown.length} of {total} rows shown.{' '}
          <button type="button" className="mcl-link" onClick={() => setLimit((n) => n + pageSize)}>Show {Math.min(pageSize, rows.length - shown.length)} more</button>
        </p>
      )}
      {rows.length < total && rows.length === shown.length && <p className="mcl-grid-more">{rows.length} of {total} rows are kept in the page.</p>}
    </div>
  );
}
