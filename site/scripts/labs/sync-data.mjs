#!/usr/bin/env node
// Practice data for the in-browser SQL engine (DuckDB-WASM).
//
//   node scripts/labs/sync-data.mjs            copy + verify (needs ../dbt-bible next to dbt-academy, or $DBT_BIBLE)
//   node scripts/labs/sync-data.mjs --check    verify only (CI: the copies are committed, the book folder may be absent)
//
// What it does
//  1. Copies the book's practice files, byte for byte, into public/data/practice/ (never edit them by hand):
//       labs/setup.sql, labs/data/*.csv, labs/updates/day2.sql, labs/updates/fresh_load.sql
//     setup.sql reads 'data/<table>.csv': the engine registers each CSV under that same relative name.
//  2. Self-hosts the DuckDB ICU extension (time zones: fresh_load.sql uses `at time zone 'UTC'`), which the
//     browser build of DuckDB does not contain. Without it DuckDB-WASM would download it from
//     extensions.duckdb.org (a third party). The file is the official signed binary, pinned by sha256,
//     downloaded once into .cache/labs/ and copied to public/data/duckdb-ext/<duckdb version>/wasm_eh/
//     (git-ignored, like public/engines/).
//  3. Writes src/lib/sql/data-manifest.json: a content hash (the cache version used in URLs and by the
//     service worker), sizes, gzip sizes, and the DuckDB-WASM file sizes for the progress bar.
// Idempotent: files that are already identical are not rewritten.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..');
const BOOK = path.resolve(process.env.DBT_BIBLE ?? path.join(SITE, '..', '..', 'dbt-bible'));
const LABS = path.join(BOOK, 'labs');
const OUT = path.join(SITE, 'public', 'data');
const MANIFEST = path.join(SITE, 'src', 'lib', 'sql', 'data-manifest.json');
const CACHE = path.join(SITE, '.cache', 'labs');
const CHECK_ONLY = process.argv.includes('--check');

// The DuckDB version inside @duckdb/duckdb-wasm 1.33.1-dev57.0 (select version() -> v1.5.4).
const DUCKDB_VERSION = 'v1.5.4';
const EXTENSIONS = [
  {
    name: 'icu',
    platform: 'wasm_eh',
    url: `https://extensions.duckdb.org/${DUCKDB_VERSION}/wasm_eh/icu.duckdb_extension.wasm`,
    sha256: 'ecdbbb29331f72103b8eb227db5792f186b191a4f7a359db8dda9919b0a736de',
    size: 6389178,
  },
];

const PRACTICE = [
  ['setup.sql', 'setup.sql'],
  ['data/customers.csv', 'data/customers.csv'],
  ['data/orders.csv', 'data/orders.csv'],
  ['data/order_items.csv', 'data/order_items.csv'],
  ['data/products.csv', 'data/products.csv'],
  ['data/payments.csv', 'data/payments.csv'],
  ['updates/day2.sql', 'updates/day2.sql'],
  ['updates/fresh_load.sql', 'updates/fresh_load.sql'],
];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gz = (b) => zlib.gzipSync(b, { level: 6 }).length;
const log = (...a) => console.log('[labs:data]', ...a);

function writeIfChanged(file, data) {
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === sha256(data)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', data);
  fs.renameSync(file + '.tmp', file);
  return true;
}

async function extension(ext) {
  const cached = path.join(CACHE, `${ext.sha256.slice(0, 16)}-${ext.name}.duckdb_extension.wasm`);
  let buf = fs.existsSync(cached) ? fs.readFileSync(cached) : null;
  if (!buf || sha256(buf) !== ext.sha256) {
    if (CHECK_ONLY) throw new Error(`--check: ${ext.name} extension not in ${CACHE}`);
    log('downloading', ext.url);
    const res = await fetch(ext.url);
    if (!res.ok) throw new Error(`${ext.url}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== ext.sha256) throw new Error(`sha256 mismatch for ${ext.url}: got ${sha256(buf)}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cached, buf);
  }
  if (buf.length !== ext.size) throw new Error(`size mismatch for ${ext.name}: ${buf.length} != ${ext.size}`);
  const rel = `duckdb-ext/${DUCKDB_VERSION}/${ext.platform}/${ext.name}.duckdb_extension.wasm`;
  writeIfChanged(path.join(OUT, rel), buf);
  return { name: ext.name, path: rel, size: buf.length, gzip: gz(buf), sha256: ext.sha256 };
}

function wasmFile(rel) {
  const p = path.join(SITE, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist', rel);
  const b = fs.readFileSync(p);
  return { file: rel, size: b.length, gzip: gz(b) };
}

async function main() {
  const files = [];
  let copied = 0;
  const haveBook = fs.existsSync(path.join(LABS, 'setup.sql'));
  if (!haveBook && !CHECK_ONLY) log(`book folder not found (${LABS}): verifying the committed copies only`);
  for (const [src, dst] of PRACTICE) {
    const target = path.join(OUT, 'practice', dst);
    if (haveBook) {
      const data = fs.readFileSync(path.join(LABS, src));
      if (CHECK_ONLY) {
        if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== sha256(data)) throw new Error(`--check: ${dst} differs from the book (run without --check)`);
      } else if (writeIfChanged(target, data)) copied++;
    }
    if (!fs.existsSync(target)) throw new Error(`missing ${target}`);
    const b = fs.readFileSync(target);
    files.push({ path: `practice/${dst}`, size: b.length, gzip: gz(b), sha256: sha256(b) });
  }
  const extensions = [];
  for (const e of EXTENSIONS) extensions.push(await extension(e));
  const version = sha256(Buffer.from(JSON.stringify(files.map((f) => [f.path, f.sha256])))).slice(0, 12);
  const wasm = { eh: { wasm: wasmFile('duckdb-eh.wasm'), worker: wasmFile('duckdb-browser-eh.worker.js') } };
  const manifest = {
    $comment: 'Generated by scripts/labs/sync-data.mjs. Do not edit. Paths are relative to <base>data/.',
    version,
    source: 'dbt-bible/labs (setup.sql, data/*.csv, updates/day2.sql, updates/fresh_load.sql)',
    duckdbVersion: DUCKDB_VERSION,
    files,
    extensionRepository: `duckdb-ext`,
    extensions,
    wasm,
  };
  const text = JSON.stringify(manifest, null, 1) + '\n';
  const wrote = writeIfChanged(MANIFEST, Buffer.from(text));
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  log(`${files.length} practice files (${copied} copied), version ${version}, data ${kb(files.reduce((s, f) => s + f.size, 0))}`
    + ` (gzip ${kb(files.reduce((s, f) => s + f.gzip, 0))}), ICU ${kb(extensions[0].size)} (gzip ${kb(extensions[0].gzip)}),`
    + ` duckdb-eh.wasm ${kb(wasm.eh.wasm.size)} (gzip ${kb(wasm.eh.wasm.gzip)})${wrote ? ', manifest written' : ''}`);
}

main().catch((e) => {
  console.error('[labs:data] FAILED:', e.message);
  process.exit(1);
});
