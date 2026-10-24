#!/usr/bin/env node
// Download sizes of the labs (raw and gzip -6, like GitHub Pages), from a built site.
//   node scripts/labs/sizes.mjs [dist folder, default .cache/labs/dist]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.resolve(SITE, process.argv[2] ?? '.cache/labs/dist');
const A = path.join(DIST, '_assets');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const size = (p) => { const b = fs.readFileSync(p); return { raw: b.length, gz: zlib.gzipSync(b, { level: 6 }).length }; };
const assets = fs.readdirSync(A);
const pick = (re) => assets.filter((f) => re.test(f)).map((f) => ({ f, ...size(path.join(A, f)) }));

/** JS files a page loads for an island: its entry chunk and the chunks it imports (static imports only). */
function closure(entry) {
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f) || !fs.existsSync(path.join(A, f))) return;
    seen.add(f);
    const src = fs.readFileSync(path.join(A, f), 'utf8');
    for (const m of src.matchAll(/(?:^|[;\s])import\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) walk(m[1]);
  };
  walk(entry);
  return [...seen];
}
function group(name, files) {
  const t = files.reduce((s, x) => ({ raw: s.raw + x.raw, gz: s.gz + x.gz }), { raw: 0, gz: 0 });
  console.log(`${name.padEnd(46)} ${mb(t.raw).padStart(9)} raw  ${mb(t.gz).padStart(9)} gzip   (${files.map((x) => x.f).join(', ').slice(0, 110)})`);
  return t;
}
const entry = (re) => assets.find((f) => re.test(f));
const islandJs = (re) => closure(entry(re)).map((f) => ({ f, ...size(path.join(A, f)) }));

console.log(`dist: ${DIST}\n`);
const sqlIsland = group('SQL workspace island (JS, static imports)', islandJs(/^SqlWorkspace\.[\w-]+\.js$/));
const engine = group('SQL engine module (lazy: duckdb-wasm JS)', pick(/^(engine|bundles|format)\.[\w-]+\.js$/));
const wasm = group('DuckDB eh wasm + worker', pick(/^duckdb-(eh\.[\w-]+\.wasm|browser-eh\.worker\.[\w-]+\.js)$/));
const dataFiles = fs.readdirSync(path.join(DIST, 'data', 'practice'), { recursive: true }).filter((f) => /\.(csv|sql)$/.test(f)).map((f) => ({ f, ...size(path.join(DIST, 'data', 'practice', f)) }));
const data = group('practice data (setup.sql, CSVs, updates)', dataFiles);
const icuPath = path.join(DIST, 'data', 'duckdb-ext', 'v1.5.4', 'wasm_eh', 'icu.duckdb_extension.wasm');
if (fs.existsSync(icuPath)) group('ICU extension (only for Fresh load)', [{ f: 'icu.duckdb_extension.wasm', ...size(icuPath) }]);
console.log(`${'= SQL lab first visit (island + engine + wasm + data)'.padEnd(46)} ${mb(sqlIsland.raw + engine.raw + wasm.raw + data.raw).padStart(9)} raw  ${mb(sqlIsland.gz + engine.gz + wasm.gz + data.gz).padStart(9)} gzip\n`);

const yamlIsland = group('YAML playground island (JS)', islandJs(/^YamlPlayground\.[\w-]+\.js$/));
const jinjaIsland = group('Jinja playground island (JS)', islandJs(/^JinjaPlayground\.[\w-]+\.js$/));
const pyw = group('Python worker (our .py + fixtures + lock)', pick(/^py\.worker-[\w-]+\.js$/));
const P = path.join(DIST, 'engines', 'pyodide', '314.0.7');
const lock = JSON.parse(fs.readFileSync(path.join(SITE, 'src', 'lib', 'py', 'pyodide-lock.labs.json'), 'utf8'));
const pyFiles = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', ...Object.values(lock.packages).map((p) => p.file_name)]
  .map((f) => ({ f, ...size(path.join(P, f)) }));
const core = group('Pyodide core + jinja2, markupsafe, pyyaml', pyFiles);
console.log(`${'= YAML playground first visit'.padEnd(46)} ${mb(yamlIsland.raw + pyw.raw + core.raw).padStart(9)} raw  ${mb(yamlIsland.gz + pyw.gz + core.gz).padStart(9)} gzip`);
console.log(`${'= Jinja playground first visit (+ DuckDB on Run)'.padEnd(46)} ${mb(jinjaIsland.raw + pyw.raw + core.raw).padStart(9)} raw  ${mb(jinjaIsland.gz + pyw.gz + core.gz).padStart(9)} gzip`);
console.log(`\nlargest single file: ${[...pick(/\.wasm$/), ...pyFiles].sort((a, b) => b.raw - a.raw)[0].f} (${kb([...pick(/\.wasm$/), ...pyFiles].sort((a, b) => b.raw - a.raw)[0].raw)})`);
