#!/usr/bin/env node
// Precompiled Python bytecode for the dbt engine (called by build-engine.mjs; can also be run by hand).
//
// Pyodide imports dbt from .py sources and compiles them at every start (about 60% of the start time). This
// script makes engines/dbt/<id>/dbt-bytecode.zip: the .pyc files (unchecked-hash, PEP 552) of the modules that dbt
// really imports, for the exact interpreter of the engine (CPython 3.14.2 in Pyodide). The worker unpacks it next
// to the sources before the first import. Sources stay in place (tracebacks unchanged).
//
//   node scripts/dbt/bytecode.mjs list    <engineDir> <out.json>   run a typical dbt session, list imported modules
//   node scripts/dbt/bytecode.mjs compile <engineDir> <list.json> <out.zip>   compile them in a FRESH interpreter
//
// The two steps run in separate processes on purpose: marshal output depends on the interpreter state, and a fresh
// interpreter that compiles a sorted list gives the same bytes on every run (checked), so the engine id is stable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..');

async function boot(engineDir) {
  const { loadPyodide } = await import(path.join(engineDir, 'pyodide.mjs'));
  return loadPyodide;
}

async function list(indexDir, lockPath, out) {
  // the same Session code as the browser, on the practice project at the end of Chapter 14 (seeds, snapshots,
  // incremental and microbatch models, tests), so the lazily imported task modules are listed too
  const { Session } = await import('../../src/lib/dbt/session.ts');
  const { PY_ENV, bootPackages, createBridge, installRuntime } = await import('../../src/lib/dbt/host.ts');
  const loadPyodide = await boot(indexDir);
  let session = null;
  const py = await loadPyodide({ indexURL: indexDir + '/', lockFileURL: lockPath, env: PY_ENV, stdout: (l) => session?.pyOut(l), stderr: (l) => session?.pyErr(l) });
  py.setStdin({ stdin: () => null });
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  await py.loadPackage(bootPackages(lock), { messageCallback: () => {} });
  const mc = await installRuntime(py, fs.readFileSync(path.join(SITE, 'src/lib/dbt/runtime/mc_dbt.py'), 'utf8'));
  const PRESETS = path.join(SITE, 'public/presets/dbt');
  session = new Session({ fs: py.FS, py: createBridge(py, mc, { loadPandas: async () => {} }), loadBundle: async (rel) => JSON.parse(fs.readFileSync(path.join(PRESETS, rel), 'utf8')) });
  const index = JSON.parse(fs.readFileSync(path.join(PRESETS, 'index.json'), 'utf8'));
  const quiet = { out() {}, err() {}, note() {}, cmd() {} };
  const ctx = { cols: 100 };
  const r = await session.applyPreset(index.presets.find((p) => p.id === 'ch14-end'), index.projects.jaffle, quiet, ctx);
  if (!r.ok) throw new Error('bytecode workload: preset failed at ' + r.failed);
  for (const line of ['dbt ls', 'dbt show -s fct_orders --limit 3', 'dbt compile -s fct_orders', 'dbt test -s stg_jaffle_shop__orders',
    'dbt docs generate', 'dbt seed', 'dbt run-operation print_row_counts', 'dbt source freshness', 'dbt debug', 'dbt retry',
    'dbt parse --no-partial-parse', 'dbt --log-format json ls -s fct_orders', 'dbt clone --state target -s fct_orders', 'dbt clean', 'dbt --version']) {
    await session.exec(line, quiet, ctx);
  }
  const files = JSON.parse(await py.runPythonAsync(`
import sys, json
sp = [p for p in sys.path if p.endswith('site-packages')][0]
json.dumps(sorted({m.__file__[len(sp) + 1:] for m in list(sys.modules.values())
                   if isinstance(getattr(m, '__file__', None), str) and m.__file__.startswith(sp + '/') and m.__file__.endswith('.py')}))`));
  fs.writeFileSync(out, JSON.stringify(files, null, 0));
}

async function compile(indexDir, lockPath, listPath, out) {
  const loadPyodide = await boot(indexDir);
  const py = await loadPyodide({ indexURL: indexDir + '/', lockFileURL: lockPath, env: { HOME: '/home/pyodide' } });
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  await py.loadPackage(Object.keys(lock.packages).filter((n) => n !== 'pandas' && n !== 'numpy'), { messageCallback: () => {} });
  py.globals.set('FILES', py.toPy(JSON.parse(fs.readFileSync(listPath, 'utf8'))));
  // nothing is imported before compiling: same interpreter state on every run
  const n = await py.runPythonAsync(`
import sys, os, py_compile, importlib.util
sp = [p for p in sys.path if p.endswith('site-packages')][0]
os.makedirs('/tmp/pyc', exist_ok=True)
done = 0
for i, rel in enumerate(FILES):
    src = sp + '/' + rel
    if os.path.exists(src):
        py_compile.compile(src, cfile='/tmp/pyc/%d' % i, dfile=src, invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH, doraise=True)
        done += 1
done`);
  const files = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  const tag = await py.runPythonAsync('import sys; sys.implementation.cache_tag');
  const entries = [];
  files.forEach((rel, i) => {
    const p = `/tmp/pyc/${i}`;
    if (!py.FS.analyzePath(p).exists) return;
    const dir = path.posix.dirname(rel);
    const base = path.posix.basename(rel, '.py');
    entries.push({ name: `${dir === '.' ? '' : dir + '/'}__pycache__/${base}.${tag}.pyc`, data: Buffer.from(py.FS.readFile(p)) });
  });
  fs.writeFileSync(out, writeZip(entries));
  console.log(`[dbt-bytecode] ${n} modules compiled (${tag}), ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
}

const [mode, a, b, c, d] = process.argv.slice(2);
if (mode === 'list') await list(a, b, c);
else if (mode === 'compile') await compile(a, b, c, d);
else { console.error('usage: bytecode.mjs list <indexDir> <lock> <out.json> | compile <indexDir> <lock> <list.json> <out.zip>'); process.exit(2); }
