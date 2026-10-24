import { useEffect, useState } from 'react';
import data from '../data/ch4-examples.json';
import { compareResults, parseBookOutput, type CompareReport } from '../lib/compare';
import { getEngine, onEngineProgress } from '../lib/shared-engine';
import type { EngineInfo, Progress, RunResult } from '../lib/engine';

export interface ParityRow {
  id: string;
  annotation?: string;
  match: boolean;
  diffs: CompareReport['diffs'];
  actual: { kind: 'table'; columns: string[]; rows: (string | null)[][]; totalRows: number } | { kind: 'error'; message: string };
  elapsedMs: number;
}
export interface ParityReport {
  info: EngineInfo;
  userAgent: string;
  rows: ParityRow[];
  passed: number;
  total: number;
  day2: { before: (string | null)[][]; after: (string | null)[][]; checks: { name: string; expected: string; actual: string | null; ok: boolean }[] };
  totalMs: number;
}

declare global { interface Window { __parity?: ParityReport; __parityError?: string } }

const DAY2_CHECKS = `select 'customers' as k, count(*)::varchar as v from jaffle_shop.customers
union all select 'orders', count(*)::varchar from jaffle_shop.orders
union all select 'order_items', count(*)::varchar from jaffle_shop.order_items
union all select 'products', count(*)::varchar from jaffle_shop.products
union all select 'payments', count(*)::varchar from stripe.payments
union all select 'successful payments', count(*)::varchar from stripe.payments where status = 'success'
union all select 'successful amount', sum(amount)::varchar from stripe.payments where status = 'success'
union all select 'max orders._loaded_at', max(_loaded_at)::varchar from jaffle_shop.orders
union all select 'orders by status', string_agg(status || ' ' || n, ', ' order by n desc, status) from (select status, count(*) as n from jaffle_shop.orders group by status)
union all select 'null / upper emails', (count(*) filter (where email is null))::varchar || ' / ' || (count(*) filter (where email = upper(email)))::varchar from jaffle_shop.customers
union all select 'customers without orders', count(*)::varchar from jaffle_shop.customers c where not exists (select 1 from jaffle_shop.orders o where o.user_id = c.id)
union all select 'orphan orders', count(*)::varchar from jaffle_shop.orders o where not exists (select 1 from jaffle_shop.customers c where c.id = o.user_id)`;

// labs/updates/README.md "Counts before / after (verified)", column "after day2.sql"
const DAY2_EXPECTED: Record<string, string> = {
  customers: '100', orders: '320', order_items: '638', products: '12', payments: '371',
  'successful payments': '347', 'successful amount': '544320', 'max orders._loaded_at': '2026-01-04 16:13:00',
  'orders by status': 'completed 252, shipped 38, returned 18, return_pending 12',
  'null / upper emails': '4 / 8', 'customers without orders': '9', 'orphan orders': '1',
};

export default function ParityRunner() {
  const [progress, setProgress] = useState<Progress>({ phase: 'worker' });
  const [report, setReport] = useState<ParityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = onEngineProgress(setProgress);
    (async () => {
      const t0 = performance.now();
      const engine = await getEngine();
      const rows: ParityRow[] = [];
      for (const ex of data.examples) {
        const res: RunResult = await engine.run(ex.sql);
        const actual = res.kind === 'table'
          ? { kind: 'table' as const, columns: res.columns, rows: res.rows, totalRows: res.totalRows }
          : { kind: 'error' as const, message: res.message };
        const rep = compareResults(parseBookOutput(ex.expectedRaw), actual, {
          ordered: ex.ordered, columnSubset: (ex as { columnSubset?: boolean }).columnSubset, rowPrefix: (ex as { rowPrefix?: boolean }).rowPrefix,
        });
        rows.push({ id: ex.id, annotation: (ex as { annotation?: string }).annotation, match: rep.match, diffs: rep.diffs, actual, elapsedMs: res.elapsedMs });
      }
      // day 2: fresh database, apply labs/updates/day2.sql, check the README's verified counts
      await engine.reset();
      const before = await engine.run(DAY2_CHECKS);
      const applied = await engine.run(engine.text('updates/day2.sql'));
      if (applied.kind === 'error') throw new Error(`day2.sql failed: ${applied.message}`);
      const after = await engine.run(DAY2_CHECKS);
      const again = await engine.run(engine.text('updates/day2.sql')); // "safe to run twice"
      const afterTwice = await engine.run(DAY2_CHECKS);
      if (before.kind !== 'table' || after.kind !== 'table' || afterTwice.kind !== 'table' || again.kind !== 'table') throw new Error('day2 check query failed');
      const checks = after.rows.map(([k, v]) => ({ name: String(k), expected: DAY2_EXPECTED[String(k)], actual: v, ok: DAY2_EXPECTED[String(k)] === v }));
      checks.push({ name: 'idempotent (second run changes nothing)', expected: 'same', actual: JSON.stringify(afterTwice.rows) === JSON.stringify(after.rows) ? 'same' : 'different', ok: JSON.stringify(afterTwice.rows) === JSON.stringify(after.rows) });
      await engine.reset();
      const r: ParityReport = {
        info: engine.info, userAgent: navigator.userAgent, rows,
        passed: rows.filter((x) => x.match).length, total: rows.length,
        day2: { before: before.rows, after: after.rows, checks },
        totalMs: Math.round(performance.now() - t0),
      };
      window.__parity = r;
      setReport(r);
    })().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      window.__parityError = msg;
      setError(msg);
    });
    return off;
  }, []);

  if (error) return <p role="alert" data-testid="parity-error">Parity run failed: {error}</p>;
  if (!report) return <p role="status">Running… ({progress.phase}{progress.total ? ` ${Math.round((100 * (progress.loaded ?? 0)) / progress.total)}%` : ''})</p>;
  return (
    <div data-testid="parity-done">
      <p><strong>{report.passed} / {report.total}</strong> examples match. DuckDB {report.info.duckdbVersion} ({report.info.sourceId}),
        bundle <code>{report.info.bundle}</code>, @duckdb/duckdb-wasm {report.info.libraryVersion}.</p>
      <table>
        <thead><tr><th>Example</th><th>Result</th><th>Differences / notes</th></tr></thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.id}>
              <td><code>{r.id}</code></td>
              <td>{r.match ? 'match' : 'DIFF'}</td>
              <td>{r.diffs.map((d) => `${d.severity}: ${d.detail}`).join(' | ')}{r.annotation ? ` [${r.annotation}]` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>day2.sql</h2>
      <ul>{report.day2.checks.map((c) => <li key={c.name}>{c.ok ? 'OK' : 'FAIL'} {c.name}: {c.actual} (expected {c.expected})</li>)}</ul>
    </div>
  );
}
