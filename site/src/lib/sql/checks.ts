/**
 * Batch checks on the SQL engine: every book example (the parity suite, also behind the playground's
 * "Check every example" button) and the day-2 counts of labs/updates/README.md.
 */
import { compareResults, parseBookOutput, type CompareReport } from './compare.ts';
import type { RunResult, SqlEngine } from './engine.ts';

export interface BookExample {
  id: string; codeId: string; chapter: string; chapterNumber: number; lessonId?: string; lessonNumber?: string;
  sql: string; bookSql: string; setup?: string; expectedRaw?: string; expectRowCount?: number; kind: string;
  ordered: boolean; columnSubset?: boolean; rowPrefix?: boolean; needsModels?: string[]; annotation?: string;
}

export interface ExampleCheck {
  id: string;
  chapter: string;
  match: boolean;
  summary: string;
  diffs: CompareReport['diffs'];
  annotation?: string;
  actual: { kind: 'table'; columns: string[]; rows: (string | null)[][]; totalRows: number } | { kind: 'error'; message: string };
  elapsedMs: number;
}

export async function checkExample(engine: SqlEngine, ex: BookExample): Promise<ExampleCheck> {
  if (ex.setup) {
    const s = await engine.run(ex.setup);
    if (s.kind === 'error' && !/already exists/.test(s.message)) {
      return { id: ex.id, chapter: ex.chapter, match: false, summary: `setup failed: ${s.message}`, diffs: [], actual: { kind: 'error', message: s.message }, elapsedMs: 0, annotation: ex.annotation };
    }
  }
  const res: RunResult = await engine.run(ex.sql);
  const actual = res.kind === 'table'
    ? { kind: 'table' as const, columns: res.columns, rows: res.rows, totalRows: res.totalRows }
    : { kind: 'error' as const, message: res.message };
  let rep: CompareReport;
  if (ex.expectRowCount !== undefined) {
    const n = res.kind === 'table' ? res.totalRows : -1;
    rep = { match: n === ex.expectRowCount, summary: `${n} rows (book: ${ex.expectRowCount})`, diffs: [], more: 0 };
  } else {
    rep = compareResults(parseBookOutput(ex.expectedRaw ?? ''), actual, { ordered: ex.ordered, columnSubset: ex.columnSubset, rowPrefix: ex.rowPrefix });
  }
  return { id: ex.id, chapter: ex.chapter, match: rep.match, summary: rep.summary, diffs: rep.diffs, annotation: ex.annotation, actual, elapsedMs: res.elapsedMs };
}

export const DAY2_CHECK_SQL = `select 'customers' as k, count(*)::varchar as v from jaffle_shop.customers
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

/** labs/updates/README.md, "Counts before / after (verified)", columns "day 1" and "after day2.sql". */
export const DAY1_EXPECTED: Record<string, string> = {
  customers: '100', orders: '300', order_items: '606', products: '12', payments: '341',
  'successful payments': '317', 'successful amount': '500440', 'max orders._loaded_at': '2025-12-31 16:22:00',
  'orders by status': 'completed 239, shipped 21, returned 18, return_pending 12, placed 10',
  'null / upper emails': '5 / 9', 'customers without orders': '11', 'orphan orders': '1',
};
export const DAY2_EXPECTED: Record<string, string> = {
  customers: '100', orders: '320', order_items: '638', products: '12', payments: '371',
  'successful payments': '347', 'successful amount': '544320', 'max orders._loaded_at': '2026-01-04 16:13:00',
  'orders by status': 'completed 252, shipped 38, returned 18, return_pending 12',
  'null / upper emails': '4 / 8', 'customers without orders': '9', 'orphan orders': '1',
};

export interface Day2Report { checks: { name: string; expected: string; actual: string | null; ok: boolean }[] }

/** Reset, check day 1, apply day2.sql, check, apply it again (idempotent), check, reset. */
export async function checkDay2(engine: SqlEngine): Promise<Day2Report> {
  const checks: Day2Report['checks'] = [];
  const counts = async () => {
    const r = await engine.run(DAY2_CHECK_SQL);
    if (r.kind !== 'table') throw new Error(`check query failed: ${r.message}`);
    return new Map(r.rows.map(([k, v]) => [String(k), v]));
  };
  await engine.reset();
  const day1 = await counts();
  for (const [k, v] of Object.entries(DAY1_EXPECTED)) checks.push({ name: `day 1: ${k}`, expected: v, actual: day1.get(k) ?? null, ok: day1.get(k) === v });
  const a = await engine.applyDay2();
  if (a.kind === 'error') throw new Error(`day2.sql failed: ${a.message}`);
  const day2 = await counts();
  for (const [k, v] of Object.entries(DAY2_EXPECTED)) checks.push({ name: `day 2: ${k}`, expected: v, actual: day2.get(k) ?? null, ok: day2.get(k) === v });
  const again = await engine.applyDay2();
  const twice = await counts();
  const same = again.kind === 'table' && JSON.stringify([...twice]) === JSON.stringify([...day2]);
  checks.push({ name: 'day2.sql twice changes nothing', expected: 'same', actual: same ? 'same' : 'different', ok: same });
  await engine.reset();
  const back = await counts();
  const reset = JSON.stringify([...back]) === JSON.stringify([...day1]);
  checks.push({ name: 'reset brings day 1 back', expected: 'same', actual: reset ? 'same' : 'different', ok: reset });
  return { checks };
}
