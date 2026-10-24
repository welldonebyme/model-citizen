// Glue between Pyodide and the Session, shared by the Web Worker (browser) and the Node checks.
import type { EmFS, PyBridge } from './session.ts';
import type { Io } from './types.ts';

/** Where the runtime module (runtime/mc_dbt.py) is written in the virtual file system (outside the learner's ~). */
export const RUNTIME_DIR = '/opt/mc';

/** Environment of the Python process. LANG/LC_ALL pinned: babel and agate need en_US (WebKit gave en-GB). */
export const PY_ENV: Record<string, string> = {
  HOME: '/home/pyodide',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  TZ: 'UTC',
};

/** The minimal Pyodide API used here. */
export interface PyodideLike {
  FS: EmFS & { mkdirTree(p: string): void; writeFile(p: string, d: string | Uint8Array): void };
  runPythonAsync(code: string): Promise<unknown>;
  pyimport(name: string): any;
  toPy(obj: unknown): any;
  loadPackage(names: string[] | string, opts?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<unknown>;
  loadedPackages: Record<string, string>;
}

export async function installRuntime(py: PyodideLike, source: string): Promise<any> {
  py.FS.mkdirTree(RUNTIME_DIR);
  py.FS.writeFile(RUNTIME_DIR + '/mc_dbt.py', source);
  await py.runPythonAsync(`import sys\nif ${JSON.stringify(RUNTIME_DIR)} not in sys.path: sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})\nimport mc_dbt\nmc_dbt.boot()`);
  return py.pyimport('mc_dbt');
}

export function createBridge(py: PyodideLike, mc: any, opts: { loadPandas: (io: Io) => Promise<void> }): PyBridge {
  const call = (fn: any, ...args: unknown[]): number => {
    const conv = args.map((a) => (a !== null && typeof a === 'object' ? py.toPy(a) : a));
    try {
      return Number(fn(...conv));
    } finally {
      for (const c of conv) if (c && typeof c === 'object' && typeof c.destroy === 'function') c.destroy();
    }
  };
  return {
    runDbt: (argv, env, cwd) => call(mc.run_dbt, argv, env, cwd),
    duckdb: (db, script, cwd, width, bail, readOnly) => call(mc.duckdb_cli, db, script, cwd, width, bail, readOnly),
    ensurePandas: (io) => opts.loadPandas(io),
  };
}

/**
 * Unpack the precompiled bytecode (engines/dbt/<id>/dbt-bytecode.zip, scripts/dbt/bytecode.mjs) next to the sources
 * in site-packages, before the first import of dbt. Unchecked-hash .pyc files: Python uses them without compiling.
 */
export async function installBytecode(py: PyodideLike, zip: Uint8Array): Promise<number> {
  py.FS.writeFile('/tmp/dbt-bytecode.zip', zip);
  const n = await py.runPythonAsync(`
import os, sys, zipfile
_sp = [p for p in sys.path if p.endswith('site-packages')][0]
with zipfile.ZipFile('/tmp/dbt-bytecode.zip') as _z:
    _names = _z.namelist()
    _z.extractall(_sp)
os.remove('/tmp/dbt-bytecode.zip')
len(_names)`);
  return Number(n);
}

/** Packages of the dbt lock that are loaded at boot (pandas and numpy only for Python models). */
export function bootPackages(lock: { packages: Record<string, unknown> }): string[] {
  return Object.keys(lock.packages).filter((n) => n !== 'pandas' && n !== 'numpy');
}
