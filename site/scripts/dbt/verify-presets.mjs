#!/usr/bin/env node
// Prepare every preset (or the ones given) with the real engine in Node, exactly like the browser does, and print
// the result of each step + row counts of the key relations. Exit code 1 if a preset fails.
//   node scripts/dbt/verify-presets.mjs [ch07-start ch14-end ...] [--log]
import { bootNodeEngine, presetIndex } from './node-engine.mjs';

const args = process.argv.slice(2);
const showLog = args.includes('--log');
const ids = args.filter((a) => !a.startsWith('--'));
const index = presetIndex();
const presets = index.presets.filter((p) => !ids.length || ids.includes(p.id));
let lines = [];
const { session, io, mc, py, timings } = await bootNodeEngine({ print: (l) => { lines.push(l); if (showLog) console.log(l); } });
console.log('engine booted', timings);

const COUNTS = {
  'dbt_adnane.fct_orders': 'select count(*) from dbt_adnane.fct_orders',
  'dbt_adnane.dim_customers': "select count(*) from dbt_adnane.dim_customers",
  'dbt_adnane.dim_customers_v2': 'select count(*) from dbt_adnane.dim_customers_v2',
  'dbt_adnane.fct_monthly_revenue': 'select count(*) from dbt_adnane.fct_monthly_revenue',
  'dbt_adnane.fct_order_items': 'select count(*) from dbt_adnane.fct_order_items',
  'dbt_adnane.fct_order_items_daily': 'select count(*) from dbt_adnane.fct_order_items_daily',
  'dbt_adnane.customers_snapshot': 'select count(*) from dbt_adnane.customers_snapshot',
  'dbt_adnane.orders_snapshot': 'select count(*) from dbt_adnane.orders_snapshot',
  'snapshots.customers_snapshot': 'select count(*) from snapshots.customers_snapshot',
  'snapshots.orders_snapshot': 'select count(*) from snapshots.orders_snapshot',
  'jaffle_shop.orders': 'select count(*) from jaffle_shop.orders',
  'marts.fct_orders': 'select count(*) from marts.fct_orders',
  'prod.customer_segments': 'select count(*) from marts.customer_segments',
  // capstone
  'shop.orders': 'select count(*) from shopflow_app.orders',
  'shop.fct_orders': 'select count(*) from dbt_adnane.fct_orders',
  'shop.fct_events': 'select count(*) from dbt_adnane.fct_events',
  'shop.products_snapshot': 'select count(*) from dbt_adnane.products_snapshot',
  'shop.shipments_snapshot': 'select count(*) from dbt_adnane.shipments_snapshot',
  'shop.customer_rfm': 'select count(*) from dbt_adnane.customer_rfm',
  'shop.prod_fct_orders': 'select count(*) from prod.fct_orders',
};

let failed = 0;
for (const p of presets) {
  lines = [];
  const t = performance.now();
  const r = await session.applyPreset(p, index.projects[p.project], io, { cols: 100 });
  const ms = Math.round(performance.now() - t);
  const dones = lines.filter((l) => /Done\. PASS=|Nothing to do|ERROR=|Completed with/.test(l.replace(/\x1b\[[0-9;]*m/g, ''))).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\d\d:\d\d:\d\d  /, ''));
  const proj = index.projects[p.project];
  const db = session.course + '/' + proj.practiceDir + '/' + proj.database;
  const counts = {};
  for (const [k, sql] of Object.entries(COUNTS)) {
    try {
      const rows = mc.query_rows(db, sql).toJs();
      counts[k] = rows[0][0];
    } catch { /* relation does not exist in this preset */ }
  }
  const wal = session.exists(db + '.wal');
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${p.id.padEnd(11)} ${String(ms).padStart(6)} ms  cwd=${session.tilde(session.cwd)}${wal ? '  WAL LEFT' : ''}`);
  for (const d of dones) console.log('       ' + d);
  console.log('       ' + Object.entries(counts).map(([k, v]) => `${k.split('.').pop()}=${v}`).join(' '));
  if (!r.ok) {
    failed++;
    console.log('       failed step:', r.failed);
    console.log(lines.slice(-40).map((l) => '       | ' + l).join('\n'));
  }
}
try { console.log('wasm memory MB', Math.round(py._module.HEAPU8.byteLength / 1048576)); } catch {}
process.exit(failed ? 1 : 0);
