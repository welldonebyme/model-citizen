// Boot the self-hosted dbt engine in Node (same files and the same Session code as the browser), for the
// preset checks and the golden comparisons. Needs public/engines/ (npm run dbt:engine) and public/presets/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from '../../src/lib/dbt/session.ts';
import { PY_ENV, bootPackages, createBridge, installRuntime } from '../../src/lib/dbt/host.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE = path.resolve(HERE, '..', '..');
const ENGINES = path.join(SITE, 'public', 'engines');
const PRESETS = path.join(SITE, 'public', 'presets', 'dbt');

export function presetIndex() {
  return JSON.parse(fs.readFileSync(path.join(PRESETS, 'index.json'), 'utf8'));
}

/** { py, mc, session, timings }. `print` receives every terminal line (default: console.log). */
export async function bootNodeEngine({ print = console.log } = {}) {
  const t0 = performance.now();
  const manifest = JSON.parse(fs.readFileSync(path.join(ENGINES, 'dbt', 'current.json'), 'utf8'));
  const { loadPyodide } = await import(path.join(ENGINES, manifest.indexPath, 'pyodide.mjs'));
  let session = null;
  const py = await loadPyodide({
    indexURL: path.join(ENGINES, manifest.indexPath) + '/',
    lockFileURL: path.join(ENGINES, manifest.lockPath),
    env: PY_ENV,
    stdout: (l) => session?.pyOut(l),
    stderr: (l) => session?.pyErr(l),
  });
  py.setStdin({ stdin: () => null }); // no keyboard input: prompts get end-of-file, like a closed terminal
  const lock = JSON.parse(fs.readFileSync(path.join(ENGINES, manifest.lockPath), 'utf8'));
  await py.loadPackage(bootPackages(lock), { messageCallback: () => {} });
  const tPackages = performance.now();
  const mc = await installRuntime(py, fs.readFileSync(path.join(SITE, 'src', 'lib', 'dbt', 'runtime', 'mc_dbt.py'), 'utf8'));
  const tDbt = performance.now();
  let pandas = false;
  const bridge = createBridge(py, mc, {
    loadPandas: async (io) => {
      if (pandas) return;
      io.note({ text: 'Loading pandas and numpy for the Python model (first time only).' });
      await py.loadPackage(['numpy', 'pandas'], { messageCallback: () => {} });
      pandas = true;
    },
  });
  session = new Session({
    fs: py.FS,
    py: bridge,
    loadBundle: async (rel) => JSON.parse(fs.readFileSync(path.join(PRESETS, rel), 'utf8')),
  });
  const io = {
    out: (l) => print(l),
    err: (l) => print(l),
    note: (n) => print(`[note] ${n.text}${n.link ? ' ' + n.link.href : ''}${n.openFile ? ' (open: ' + n.openFile + ')' : ''}`),
    cmd: (l) => print(`$ ${l}`),
    clear: () => {},
  };
  return {
    py, mc, session, io, manifest,
    timings: { packagesMs: Math.round(tPackages - t0), importDbtMs: Math.round(tDbt - tPackages) },
  };
}
