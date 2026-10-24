#!/usr/bin/env node
// Build the self-hosted dbt engine (Pyodide + dbt-core 1.11.16 + dbt-duckdb 1.11.0) from the pinned sources in
// scripts/dbt/engine-sources.json into
//   public/engines/pyodide/<pyodide version>/  shared Pyodide core + distribution wheels (+ a matching pyodide-lock.json),
//                                              also used by the YAML/Jinja playgrounds
//   public/engines/dbt/<engine id>/            dbt-lock.json (Pyodide lock) + PyPI and derived wheels + engine.json
//   public/engines/dbt/current.json            the manifest the site reads (same as <engine id>/engine.json)
//
// - Every download is checked against its sha256 and kept in a local cache (.cache/dbt-engine/, or
//   $DBT_ENGINE_CACHE), so a second run needs no network. In CI, cache that folder (key: engine-sources.json).
// - Three wheels are derived here, deterministically: the babel wheel without the non-English locale data,
//   the pure-Python dbt-extractor stand-in and the threads shim (both from scripts/dbt/py/).
// - The Pyodide lock (dbt-lock.json) gets the sha256 of the files really served; Pyodide checks them.
// - Idempotent: if the output already exists and every file matches, nothing is written.
//
// Usage: node scripts/dbt/build-engine.mjs [--offline] [--quiet]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readZip, writeZip } from './zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..');
const SOURCES = JSON.parse(fs.readFileSync(path.join(HERE, 'engine-sources.json'), 'utf8'));
const CACHE = process.env.DBT_ENGINE_CACHE || path.join(SITE, '.cache', 'dbt-engine');
const ENGINES = path.join(SITE, 'public', 'engines');
const OFFLINE = process.argv.includes('--offline');
const QUIET = process.argv.includes('--quiet');
const log = (...a) => { if (!QUIET) console.log('[dbt-engine]', ...a); };

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const b64sha = (buf) => crypto.createHash('sha256').update(buf).digest('base64url');

async function download(url, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      log(`download failed (${i}/${attempts}): ${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw new Error(`cannot download ${url}: ${last?.message}`);
}

/** A pinned upstream file, from the cache or the network, always checked. */
async function pinned({ url, sha256: want, size }) {
  fs.mkdirSync(CACHE, { recursive: true });
  const cached = path.join(CACHE, `${want.slice(0, 16)}-${decodeURIComponent(url.split('/').pop())}`);
  if (fs.existsSync(cached)) {
    const buf = fs.readFileSync(cached);
    if (sha256(buf) === want) return buf;
    log('cache entry corrupted, downloading again:', cached);
  }
  if (OFFLINE) throw new Error(`--offline and not in cache: ${url}`);
  log('downloading', url);
  const buf = await download(url);
  const got = sha256(buf);
  if (got !== want) throw new Error(`sha256 mismatch for ${url}\n  expected ${want}\n  got      ${got}`);
  if (size && buf.length !== size) throw new Error(`size mismatch for ${url}: ${buf.length} != ${size}`);
  fs.writeFileSync(cached + '.tmp', buf);
  fs.renameSync(cached + '.tmp', cached);
  return buf;
}

/** RECORD lines for the given entries (+ the RECORD line itself). */
function record(entries, recordName) {
  const lines = entries.map(({ name, data }) => `${name},sha256=${b64sha(data)},${data.length}`);
  lines.push(`${recordName},,`);
  return Buffer.from(lines.join('\n') + '\n');
}

/** A small pure-Python wheel built from files of scripts/dbt/py/. */
function buildPureWheel(dist, version, files, summary) {
  const distinfo = `${dist}-${version}.dist-info`;
  const tag = 'py3-none-any';
  const entries = files.map(([name, src]) => ({ name, data: fs.readFileSync(path.join(HERE, 'py', src)) }));
  const tops = [...new Set(files.map(([name]) => name.split('/')[0].replace(/\.py$/, '')))].sort();
  entries.push({ name: `${distinfo}/METADATA`, data: Buffer.from(`Metadata-Version: 2.1\nName: ${dist.replace(/_/g, '-')}\nVersion: ${version}\nSummary: ${summary}\n`) });
  entries.push({ name: `${distinfo}/WHEEL`, data: Buffer.from(`Wheel-Version: 1.0\nGenerator: model-citizen build-engine\nRoot-Is-Purelib: true\nTag: ${tag}\n`) });
  entries.push({ name: `${distinfo}/top_level.txt`, data: Buffer.from(tops.join('\n') + '\n') });
  entries.push({ name: `${distinfo}/RECORD`, data: record(entries, `${distinfo}/RECORD`) });
  return writeZip(entries);
}

/** babel without the locale data the sandbox never uses (LANG/LC_ALL are pinned to en_US.UTF-8). 9.7 MB -> ~0.35 MB. */
function slimBabel(buf, keep) {
  const keepSet = new Set(keep);
  const all = readZip(buf);
  const dropped = new Set(all.filter((e) => e.name.startsWith('babel/locale-data/') && !keepSet.has(path.posix.basename(e.name))).map((e) => e.name));
  const kept = all.filter((e) => !dropped.has(e.name));
  for (const e of kept) {
    if (e.name.endsWith('.dist-info/RECORD')) {
      e.data = Buffer.from(e.data.toString('utf8').split('\n').filter((l) => !dropped.has(l.split(',')[0])).join('\n'));
    }
  }
  // integrity of what we keep: every kept file must still match its RECORD hash
  const rec = kept.find((e) => e.name.endsWith('.dist-info/RECORD')).data.toString('utf8');
  const hashes = new Map(rec.split('\n').filter(Boolean).map((l) => { const [n, h] = l.split(','); return [n, h]; }));
  for (const e of kept) {
    const h = hashes.get(e.name);
    if (h && h.startsWith('sha256=') && h.slice(7) !== b64sha(e.data)) throw new Error(`babel: RECORD mismatch for ${e.name}`);
  }
  log(`babel: dropped ${dropped.size} locale files`);
  return writeZip(kept);
}

async function wheelBytes(pkg) {
  const d = pkg.derive;
  if (!d) return pinned(pkg.source);
  if (d.kind === 'babel-slim') return slimBabel(await pinned(pkg.source), d.keep);
  if (d.kind === 'dbt-extractor-stub') {
    return buildPureWheel('dbt_extractor', d.version, [['dbt_extractor/__init__.py', 'dbt_extractor/__init__.py']],
      'Pure-Python stand-in for dbt-extractor (static parser subset) for Pyodide');
  }
  if (d.kind === 'dbt-pyodide-shim') {
    return buildPureWheel('dbt_pyodide_shim', d.version, [['dbt_pyodide_shim.py', 'dbt_pyodide_shim.py']],
      'Threads/_multiprocessing shims that let dbt-core run in Pyodide');
  }
  throw new Error(`unknown derive kind ${d.kind}`);
}

function gzipSize(buf) {
  return zlib.gzipSync(buf, { level: 6 }).length;
}

async function writeIfChanged(file, data) {
  if (fs.existsSync(file) && fs.statSync(file).size === data.length && sha256(fs.readFileSync(file)) === sha256(data)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', data);
  fs.renameSync(file + '.tmp', file);
  return true;
}

async function main() {
  const t0 = Date.now();
  const pyv = SOURCES.versions.pyodide;
  const sharedRel = `pyodide/${pyv}/`;            // relative to public/engines/
  const sharedDir = path.join(ENGINES, 'pyodide', pyv);
  const files = []; // { rel (to public/engines/), data, group }
  for (const c of SOURCES.core) files.push({ rel: sharedRel + c.file, data: await pinned(c), group: 'boot' });
  const lock = { info: SOURCES.lockInfo, packages: {} };
  const dbtFiles = [];
  for (const pkg of SOURCES.packages) {
    if (pkg.file.includes('/') || pkg.file.includes('..')) throw new Error(`bad file name ${pkg.file}`);
    const data = await wheelBytes(pkg);
    const rel = pkg.shared ? sharedRel + pkg.file : null;
    if (rel) files.push({ rel, data, group: pkg.group });
    else dbtFiles.push({ file: pkg.file, data, group: pkg.group });
    // file_name is resolved by Pyodide with new URL(file_name, <folder of dbt-lock.json>)
    lock.packages[pkg.name] = { ...pkg.lock, file_name: pkg.shared ? `../../${sharedRel}${pkg.file}` : pkg.file, sha256: sha256(data) };
  }
  const lockBuf = Buffer.from(JSON.stringify(lock, null, 1) + '\n');

  // 1. shared Pyodide folder: write what is missing or different; never delete files we do not own
  let wroteShared = 0;
  for (const f of files.filter((x) => x.rel.startsWith(sharedRel))) {
    if (await writeIfChanged(path.join(ENGINES, f.rel), f.data)) wroteShared++;
  }
  // its pyodide-lock.json = the official distribution lock, limited to the wheels present in the folder
  const official = JSON.parse((await pinned(SOURCES.pyodideLock)).toString('utf8'));
  const present = new Set(fs.readdirSync(sharedDir));
  const sharedLock = { info: official.info, packages: Object.fromEntries(Object.entries(official.packages).filter(([, v]) => present.has(v.file_name))) };
  if (await writeIfChanged(path.join(sharedDir, 'pyodide-lock.json'), Buffer.from(JSON.stringify(sharedLock, null, 1) + '\n'))) wroteShared++;
  log(wroteShared ? `shared Pyodide folder: ${wroteShared} file(s) written` : 'shared Pyodide folder up to date', `(engines/${sharedRel})`);

  // 2. precompiled bytecode of the modules dbt imports (scripts/dbt/bytecode.mjs): a faster start. It depends only on
  //    the engine (wheels, lock, Pyodide core) and on the runtime module, so it is cached by those inputs.
  const runtimeSrc = fs.readFileSync(path.join(SITE, 'src/lib/dbt/runtime/mc_dbt.py'));
  const bcKey = sha256(Buffer.from(JSON.stringify([
    ...files.map((f) => [f.rel, sha256(f.data)]), ...dbtFiles.map((f) => [f.file, sha256(f.data)]),
    sha256(lockBuf), sha256(runtimeSrc), sha256(fs.readFileSync(path.join(HERE, 'bytecode.mjs'))),
  ]))).slice(0, 16);
  const bcCache = path.join(CACHE, `bytecode-${bcKey}.zip`);
  if (!fs.existsSync(bcCache) && !process.argv.includes('--no-bytecode')) {
    const tmp = path.join(ENGINES, 'dbt', `.tmp-bytecode-${process.pid}`); // same depth as the real folder (lock paths)
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of dbtFiles) fs.writeFileSync(path.join(tmp, f.file), f.data);
    fs.writeFileSync(path.join(tmp, 'dbt-lock.json'), lockBuf);
    log('compiling the bytecode of dbt (once per engine version, about 1 to 2 minutes)...');
    const run = (args) => execFileSync(process.execPath, [path.join(HERE, 'bytecode.mjs'), ...args], { stdio: QUIET ? 'pipe' : 'inherit' });
    try {
      run(['list', sharedDir, path.join(tmp, 'dbt-lock.json'), path.join(tmp, 'modules.json')]);
      run(['compile', sharedDir, path.join(tmp, 'dbt-lock.json'), path.join(tmp, 'modules.json'), path.join(tmp, 'bytecode.zip')]);
      fs.copyFileSync(path.join(tmp, 'bytecode.zip'), bcCache);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  // group "bytecode": not part of the first download; the page fetches it in the background after the first start
  if (fs.existsSync(bcCache)) dbtFiles.push({ file: 'dbt-bytecode.zip', data: fs.readFileSync(bcCache), group: 'bytecode' });

  const fingerprint = sha256(Buffer.from(JSON.stringify([
    ...files.map((f) => [f.rel, sha256(f.data)]),
    ...dbtFiles.map((f) => [f.file, sha256(f.data)]),
    ['dbt-lock.json', sha256(lockBuf)],
  ])));
  const id = `dbt-${SOURCES.versions.dbtCore}-${fingerprint.slice(0, 10)}`;
  const dbtRel = `dbt/${id}/`;
  for (const f of dbtFiles) files.push({ rel: dbtRel + f.file, data: f.data, group: f.group });
  files.push({ rel: dbtRel + 'dbt-lock.json', data: lockBuf, group: 'boot' });

  // gzip sizes are only for the "about N MB to download" label; cache them by content hash.
  const gzCachePath = path.join(CACHE, 'gzip-sizes.json');
  const gzCache = fs.existsSync(gzCachePath) ? JSON.parse(fs.readFileSync(gzCachePath, 'utf8')) : {};
  const manifestFiles = files.map((f) => {
    const h = sha256(f.data);
    gzCache[h] ??= gzipSize(f.data);
    return { path: f.rel, group: f.group, size: f.data.length, gzip: gzCache[h], sha256: h };
  });
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(gzCachePath, JSON.stringify(gzCache));
  const groups = {};
  for (const f of manifestFiles) {
    groups[f.group] ??= { files: 0, size: 0, gzip: 0 };
    groups[f.group].files++; groups[f.group].size += f.size; groups[f.group].gzip += f.gzip;
  }
  const manifest = {
    $comment: 'Generated by scripts/dbt/build-engine.mjs. Paths are relative to <base>/engines/.',
    id,
    versions: SOURCES.versions,
    indexPath: sharedRel,             // Pyodide indexURL (shared core)
    lockPath: dbtRel + 'dbt-lock.json',
    groups,
    files: manifestFiles,
  };
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 1) + '\n');

  // 2. dbt folder: public/engines/dbt/<id>/ (immutable, so it can be cached forever)
  const outDir = path.join(ENGINES, 'dbt', id);
  const mine = files.filter((x) => x.rel.startsWith(dbtRel));
  const upToDate = fs.existsSync(path.join(outDir, 'engine.json')) && mine.every((f) => {
    const p = path.join(ENGINES, f.rel);
    return fs.existsSync(p) && fs.statSync(p).size === f.data.length && sha256(fs.readFileSync(p)) === sha256(f.data);
  });
  if (!upToDate) {
    const tmp = path.join(ENGINES, 'dbt', `.tmp-${id}-${process.pid}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of mine) fs.writeFileSync(path.join(tmp, f.rel.slice(dbtRel.length)), f.data);
    fs.writeFileSync(path.join(tmp, 'engine.json'), manifestBuf);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(tmp, outDir);
    log('wrote', path.relative(SITE, outDir));
  } else {
    await writeIfChanged(path.join(outDir, 'engine.json'), manifestBuf);
    log('up to date:', path.relative(SITE, outDir));
  }
  // keep only the current dbt engine (old ones would double the size of the site)
  for (const name of fs.readdirSync(path.join(ENGINES, 'dbt'))) {
    if (name !== id && (name.startsWith('dbt-') || name.startsWith('.tmp-'))) {
      fs.rmSync(path.join(ENGINES, 'dbt', name), { recursive: true, force: true });
      log('removed old engine', name);
    }
  }
  await writeIfChanged(path.join(ENGINES, 'dbt', 'current.json'), manifestBuf);
  const mb = (n) => (n / 1e6).toFixed(1) + ' MB';
  log(`engine ${id}: boot+core ${mb(groups.boot.size + groups.core.size)} (gzip ~${mb(groups.boot.gzip + groups.core.gzip)}),`
    + ` pandas ${mb(groups.pandas.size)} (gzip ~${mb(groups.pandas.gzip)}),`
    + ` bytecode ${groups.bytecode ? mb(groups.bytecode.size) + ' (zip ' + mb(groups.bytecode.gzip) + ')' : 'none'}, ${files.length} files, ${Date.now() - t0} ms`);
}

main().catch((e) => {
  console.error('[dbt-engine] FAILED:', e.message);
  process.exit(1);
});
