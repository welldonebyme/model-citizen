/**
 * Fast dev loop: run the Chapter 4 parity check with the SAME DuckDB-WASM package in Node
 * (blocking Node build of @duckdb/duckdb-wasm). The authoritative run is the browser one
 * (tests/parity.spec.ts); this script is only for quick iteration and CI smoke tests.
 *
 *   npx tsx scripts/parity-node.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareResults, parseBookOutput, splitSqlStatements, type Actual } from '../src/lib/compare.ts';
import { arrowToResultSet } from '../src/lib/format.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
const dist = join(root, 'node_modules/@duckdb/duckdb-wasm/dist');

const db = await duckdb.createDuckDB(
  { mvp: { mainModule: join(dist, 'duckdb-mvp.wasm'), mainWorker: '' }, eh: { mainModule: join(dist, 'duckdb-eh.wasm'), mainWorker: '' } },
  new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
await db.instantiate();
db.open({});
const conn = db.connect();
const version = arrowToResultSet(conn.query('select version() as v')).rows[0][0];

function run(sql: string): Actual {
  let last: Actual = { kind: 'table', columns: [], rows: [] };
  for (const stmt of splitSqlStatements(sql)) {
    try {
      const rs = arrowToResultSet(conn.query(stmt));
      last = { kind: 'table', columns: rs.columns, rows: rs.rows };
    } catch (e) {
      return { kind: 'error', message: (e as Error).message };
    }
  }
  return last;
}

run("attach ':memory:' as practice; use practice;");
for (const f of ['customers', 'orders', 'order_items', 'products', 'payments']) {
  db.registerFileBuffer(`data/${f}.csv`, new Uint8Array(readFileSync(join(root, 'public/data', `${f}.csv`))));
}
const setup = run(readFileSync(join(root, 'public/data/setup.sql'), 'utf8'));
console.log(`DuckDB ${version}; setup.sql ->`, setup.kind === 'table' ? setup.rows.map((r) => r.join('=')).join(', ') : setup.message);

const data = JSON.parse(readFileSync(join(root, 'src/data/ch4-examples.json'), 'utf8'));
let ok = 0;
for (const ex of data.examples) {
  const actual = run(ex.sql);
  const rep = compareResults(parseBookOutput(ex.expectedRaw), actual, { ordered: ex.ordered, columnSubset: ex.columnSubset, rowPrefix: ex.rowPrefix });
  if (rep.match) ok++;
  const warn = rep.diffs.filter((d) => d.severity === 'warning').map((d) => d.detail);
  const errs = rep.diffs.filter((d) => d.severity === 'error').map((d) => d.detail);
  console.log(`${rep.match ? 'PASS' : 'FAIL'} ${ex.id}${errs.length ? '\n    ' + errs.join('\n    ') : ''}${warn.length ? '\n    (warn) ' + warn.join('\n    (warn) ') : ''}`);
}
console.log(`\n${ok}/${data.examples.length} match (DuckDB ${version}, Node blocking build)`);
