/// <reference lib="webworker" />
// The dbt engine Web Worker: Pyodide + real dbt-core 1.11.16 + dbt-duckdb 1.11.0, the terminal session and the
// saved workspaces. Protocol: types.ts (WorkerRequest / WorkerEvent). Everything heavy is loaded on "boot".
import runtimeSource from './runtime/mc_dbt.py?raw';
import { Session } from './session.ts';
import { PY_ENV, bootPackages, createBridge, installBytecode, installRuntime, type PyodideLike } from './host.ts';
import { trackFetchProgress } from './engine-cache.ts';
import * as store from './persist.ts';
import { makeZip } from './zip.ts';
import type { EngineManifest, ExecContext, Io, PresetIndex, Progress, WorkerEvent, WorkerRequest, WorkspaceMeta } from './types.ts';

declare const self: DedicatedWorkerGlobalScope;

let py: (PyodideLike & { setStdin(o: unknown): void; _module?: { HEAPU8: Uint8Array } }) | null = null;
let session: Session | null = null;
let index: PresetIndex | null = null;
let manifest: EngineManifest | null = null;
let engineBase = '';
let presetsBase = '';
let pandasLoaded = false;
let persistOk = true;
let current: { ws: string; meta: WorkspaceMeta; release: () => void } | null = null;
let snapshot = new Map<string, { dir: boolean; mtime: number; size: number }>();
let prepLog: string[] = [];
let bytecodeUsed = false;

const post = (m: WorkerEvent, transfer: Transferable[] = []) => self.postMessage(m, transfer);
let lastProgress = 0;
function progress(p: Progress, force = false) {
  const now = Date.now();
  if (!force && now - lastProgress < 80) return;
  lastProgress = now;
  post({ type: 'progress', progress: p });
}

function ioFor(id: number, log?: string[]): Io {
  return {
    out: (text) => { log?.push(text); post({ type: 'line', id, kind: 'out', text }); },
    err: (text) => { log?.push(text); post({ type: 'line', id, kind: 'err', text }); },
    note: (note) => { log?.push('[browser] ' + note.text); post({ type: 'note', id, note }); },
    cmd: (text) => { log?.push('$ ' + text); post({ type: 'cmd', id, text }); },
    clear: () => post({ type: 'clear', id }),
  };
}

// ---- boot -----------------------------------------------------------------------------------------------------------
async function boot(msg: Extract<WorkerRequest, { type: 'boot' }>) {
  if (py) return { versions: await versions(), timings: {} };
  const t0 = performance.now();
  engineBase = msg.engineBase;
  presetsBase = msg.presetsBase;
  manifest = msg.manifest;
  const indexURL = engineBase + manifest.indexPath;
  const lockURL = engineBase + manifest.lockPath;
  const bootFiles = manifest.files.filter((f) => f.group !== 'pandas' && f.group !== 'bytecode');
  const total = bootFiles.reduce((s, f) => s + f.size, 0);
  const sizes = new Map(manifest.files.map((f) => [new URL(engineBase + f.path).href, f.size]));
  const got = new Map<string, number>();
  let loaded = 0;
  let label = 'Downloading the engine';
  let phase: Progress['phase'] = 'download';
  trackFetchProgress(self, manifest.files.map((f) => ({ url: engineBase + f.path, size: f.size })), (delta, url) => {
    const cap = sizes.get(url) ?? 0;
    const before = got.get(url) ?? 0;
    const after = Math.min(cap, before + delta);
    got.set(url, after);
    const g = manifest!.files.find((f) => engineBase + f.path === url)?.group;
    if (g === 'pandas' || g === 'bytecode') return;
    loaded += after - before;
    progress({ phase, label, loaded, total });
  });
  progress({ phase, label, loaded, total }, true);
  // the two JS modules are imported, not fetched by Pyodide: fetch them first so they are counted (and cached)
  await Promise.all(['pyodide.mjs', 'pyodide.asm.mjs'].map((f) => fetch(indexURL + f).then((r) => r.arrayBuffer())));
  const t1 = performance.now();
  phase = 'python';
  label = 'Starting Python';
  progress({ phase, label, loaded, total }, true);
  const { loadPyodide } = await import(/* @vite-ignore */ indexURL + 'pyodide.mjs');
  py = await loadPyodide({
    indexURL,
    lockFileURL: lockURL,
    env: PY_ENV,
    stdout: (l: string) => session?.pyOut(l),
    stderr: (l: string) => session?.pyErr(l),
  });
  py!.setStdin({ stdin: () => null });
  const t2 = performance.now();
  phase = 'packages';
  label = 'Installing dbt-core, dbt-duckdb and their packages';
  progress({ phase, label, loaded, total }, true);
  const lock = await (await fetch(lockURL)).json();
  await py!.loadPackage(bootPackages(lock), { messageCallback: () => {}, errorCallback: (m) => console.warn(m) });
  // Precompiled bytecode: dbt starts about 2 s faster (no compiling of its 1,200 modules). Only when it is already
  // in the cache: the first start does not wait for it; the page downloads it in the background afterwards.
  const bc = manifest.files.find((f) => f.group === 'bytecode');
  bytecodeUsed = false;
  if (bc && typeof caches !== 'undefined') {
    try {
      const hit = await caches.match(engineBase + bc.path, { ignoreSearch: true });
      if (hit) { await installBytecode(py!, new Uint8Array(await hit.arrayBuffer())); bytecodeUsed = true; }
    } catch (e) {
      console.warn('dbt engine: bytecode not used', e);
    }
  }
  const t3 = performance.now();
  phase = 'dbt';
  label = 'Starting dbt';
  progress({ phase, label, loaded: total, total }, true);
  const mc = await installRuntime(py!, runtimeSource);
  const bridge = createBridge(py!, mc, {
    loadPandas: async (io) => {
      if (pandasLoaded) return;
      const mb = (manifest!.groups.pandas?.size ?? 0) / 1e6;
      io.note({ text: `This project has a Python model: loading pandas and numpy (${mb.toFixed(0)} MB, only the first time).` });
      await py!.loadPackage(['numpy', 'pandas'], { messageCallback: () => {}, errorCallback: (m) => console.warn(m) });
      pandasLoaded = true;
    },
  });
  session = new Session({
    fs: py!.FS,
    py: bridge,
    loadBundle: async (rel) => {
      const r = await fetch(presetsBase + rel);
      if (!r.ok) throw new Error(`cannot load ${rel} (HTTP ${r.status})`);
      return r.json();
    },
  });
  index = msg.presets;
  const t4 = performance.now();
  // what really came over the network (0 bytes when the service worker served the files from its cache)
  const res = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((e) => e.name.startsWith(engineBase));
  return {
    versions: await versions(),
    timings: { downloadJsMs: Math.round(t1 - t0), pythonMs: Math.round(t2 - t1), packagesMs: Math.round(t3 - t2), dbtMs: Math.round(t4 - t3), totalMs: Math.round(t4 - t0) },
    resources: { files: res.length, transferBytes: res.reduce((n, e) => n + (e.transferSize || 0), 0), decodedBytes: res.reduce((n, e) => n + (e.decodedBodySize || 0), 0) },
    bytecode: bytecodeUsed,
  };
}

async function versions() {
  const v = py!.pyimport('mc_dbt').versions();
  const out = v.toJs({ dict_converter: Object.fromEntries }) as Record<string, string>;
  v.destroy();
  return out;
}

// ---- workspace files <-> IndexedDB ----------------------------------------------------------------------------------
function scan(): Map<string, { dir: boolean; mtime: number; size: number }> {
  const s = session!;
  const out = new Map<string, { dir: boolean; mtime: number; size: number }>();
  const walk = (abs: string, rel: string) => {
    for (const name of s.readdir(abs)) {
      const a = abs + '/' + name;
      const r = rel ? rel + '/' + name : name;
      const st = s.fs.stat(a);
      const dir = s.fs.isDir(st.mode);
      out.set(r, { dir, mtime: +st.mtime, size: dir ? 0 : st.size });
      if (dir) walk(a, r);
    }
  };
  walk(s.home, '');
  return out;
}

function clearHome() {
  const s = session!;
  for (const name of s.readdir(s.home)) s.rmrf(s.home + '/' + name);
}

async function sync(full = false) {
  if (!current) return;
  const s = session!;
  const cur = scan();
  const puts: store.FileRec[] = [];
  const dels: string[] = [];
  let bytes = 0;
  for (const [p, st] of cur) {
    bytes += st.size;
    const prev = snapshot.get(p);
    if (full || !prev || prev.mtime !== st.mtime || prev.size !== st.size || prev.dir !== st.dir) {
      puts.push({ ws: current.ws, path: p, dir: st.dir, mtime: st.mtime, size: st.size, data: st.dir ? undefined : (s.fs.readFile(s.home + '/' + p) as Uint8Array) });
    }
  }
  if (!full) for (const p of snapshot.keys()) if (!cur.has(p)) dels.push(p);
  const meta = current.meta;
  meta.cwd = s.cwd;
  meta.env = { ...s.env };
  meta.updatedAt = Date.now();
  meta.bytes = bytes;
  meta.files = [...cur.values()].filter((x) => !x.dir).length;
  snapshot = cur;
  if (!persistOk) return;
  try {
    await store.applyChanges(current.ws, puts, dels, meta, full);
  } catch (e) {
    persistOk = false;
    console.warn('dbt workspace: saving failed', e);
  }
}

/** One tab at a time per workspace (Web Locks), so two tabs cannot overwrite each other's files. */
async function lockWorkspace(ws: string): Promise<(() => void) | null> {
  const locks = (self.navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return () => {};
  return new Promise((resolve) => {
    locks.request(`mc-dbt-workspace:${ws}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(null); return; }
      return new Promise<void>((release) => resolve(() => release()));
    }).catch(() => resolve(() => {}));
  });
}

async function open(id: number, msg: Extract<WorkerRequest, { type: 'open' }>) {
  const s = session!;
  const preset = index!.presets.find((p) => p.id === msg.preset);
  if (!preset) throw new Error(`unknown preset ${msg.preset}`);
  const project = index!.projects[preset.project];
  if (current?.ws !== msg.ws) {
    current?.release();
    current = null;
    const release = await lockWorkspace(msg.ws);
    if (!release) return { busy: true };
    current = { ws: msg.ws, meta: null as unknown as WorkspaceMeta, release };
  }
  s.project = project;
  let meta: WorkspaceMeta | undefined;
  try {
    meta = await store.getMeta(msg.ws);
    persistOk = true;
  } catch {
    persistOk = false;
  }
  if (msg.mode === 'continue' && meta && meta.state === 'ready') {
    progress({ phase: 'workspace', label: 'Opening your saved workspace' }, true);
    const recs = await store.loadFiles(msg.ws);
    clearHome();
    recs.sort((a, b) => (a.path < b.path ? -1 : 1));
    for (const r of recs) {
      const abs = s.home + '/' + r.path;
      if (r.dir) { if (!s.exists(abs)) s.fs.mkdirTree(abs); continue; }
      s.write(abs, r.data ?? new Uint8Array());
      try { s.fs.utime?.(abs, r.mtime, r.mtime); } catch { /* mtime only matters for change detection */ }
    }
    s.cwd = s.exists(meta.cwd) ? meta.cwd : s.course;
    s.env = { ...(meta.env ?? {}) };
    s.vars = {};
    s.lastExit = 0;
    current.meta = meta;
    snapshot = scan();
    const madeFrom = index!.presets.find((p) => p.id === meta!.preset);
    return { restored: true, meta, presetChanged: !!madeFrom && meta.presetHash !== madeFrom.hash, persist: persistOk };
  }
  const now = Date.now();
  const newMeta: WorkspaceMeta = {
    ws: msg.ws, preset: preset.id, presetHash: preset.hash, state: 'preparing', cwd: s.course, env: {},
    history: meta?.history ?? [], createdAt: now, updatedAt: now, bytes: 0, files: 0,
  };
  current.meta = newMeta;
  if (persistOk) {
    try { await store.applyChanges(msg.ws, [], [], newMeta, true); } catch { persistOk = false; }
  }
  clearHome();
  prepLog = [];
  const io = ioFor(id, prepLog);
  const t = performance.now();
  const r = await s.applyPreset(preset, project, io, { cols: 100 }, (i, n, label) => progress({ phase: 'prepare', label, step: i, steps: n }, true));
  if (!r.ok) return { restored: false, ok: false, failed: r.failed, persist: persistOk };
  newMeta.state = 'ready';
  snapshot = new Map();
  await sync(true);
  return { restored: false, ok: true, meta: newMeta, prepareMs: Math.round(performance.now() - t), persist: persistOk };
}

async function exec(id: number, line: string, ctx: ExecContext) {
  const s = session!;
  const code = await s.exec(line, ioFor(id), ctx);
  if (current) {
    const h = current.meta.history;
    if (line.trim() && h[h.length - 1] !== line) h.push(line);
    if (h.length > 300) h.splice(0, h.length - 300);
  }
  await sync();
  let memoryMB: number | undefined;
  try { memoryMB = Math.round((py as unknown as { _module: { HEAPU8: Uint8Array } })._module.HEAPU8.byteLength / 1048576); } catch { /* not exposed */ }
  return { code, cwd: s.cwd, prompt: s.tilde(s.cwd), memoryMB };
}

function displayPath(abs: string) {
  return session!.tilde(abs);
}

async function handle(msg: WorkerRequest): Promise<{ result: unknown; transfer?: Transferable[] }> {
  if (msg.type === 'boot') return { result: await boot(msg) };
  if (!session) throw new Error('The engine is not started.');
  const s = session;
  switch (msg.type) {
    case 'open': return { result: await open(msg.id, msg) };
    case 'exec': return { result: await exec(msg.id, msg.line, msg.ctx) };
    case 'list': {
      const abs = s.resolve(msg.dir);
      if (!s.inHome(abs) || !s.isDir(abs)) return { result: [] };
      return { result: s.list(abs).map((e) => ({ ...e, display: displayPath(e.path) })) };
    }
    case 'read': {
      const abs = s.resolve(msg.path);
      if (!s.inHome(abs) || !s.exists(abs) || s.isDir(abs)) throw new Error(`${msg.path}: no such file`);
      if (!s.isText(abs)) return { result: { binary: true, size: s.fs.stat(abs).size, path: abs } };
      return { result: { text: s.readText(abs), path: abs, mtime: +s.fs.stat(abs).mtime } };
    }
    case 'write': {
      const abs = s.resolve(msg.path);
      if (!s.inHome(abs)) throw new Error('Files can only be saved in your home folder (~).');
      s.write(abs, msg.text);
      await sync();
      return { result: { path: abs, mtime: +s.fs.stat(abs).mtime } };
    }
    case 'export': {
      const proj = s.project ? s.course + '/' + s.project.dir : null;
      if (!proj || !s.exists(proj)) throw new Error('There is no project to export yet.');
      const entries: { name: string; data: Uint8Array; mtime?: number }[] = [];
      const skip = new Set(['target', 'logs', 'dbt_packages']);
      const walk = (abs: string, rel: string) => {
        for (const n of s.readdir(abs)) {
          if (!rel && skip.has(n)) continue;
          const a = abs + '/' + n;
          const r = rel ? rel + '/' + n : n;
          if (s.isDir(a)) walk(a, r);
          else entries.push({ name: s.project!.dir + '/' + r, data: s.readBytes(a), mtime: +s.fs.stat(a).mtime });
        }
      };
      walk(proj, '');
      const zip = await makeZip(entries);
      return { result: { bytes: zip, files: entries.length }, transfer: [zip.buffer] };
    }
    case 'workspaces': {
      try { return { result: await store.listMeta() }; } catch { return { result: [] }; }
    }
    case 'delete-workspace': {
      if (current?.ws === msg.ws) throw new Error('This workspace is open. Open another one first.');
      await store.deleteWorkspace(msg.ws);
      return { result: true };
    }
    case 'prep-log': return { result: prepLog };
    default: throw new Error('unknown request');
  }
}

// One request at a time, in order (dbt is synchronous anyway).
let queue: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  queue = queue.then(async () => {
    try {
      const { result, transfer } = await handle(msg);
      post({ type: 'reply', id: msg.id, ok: true, result }, transfer ?? []);
    } catch (e) {
      const err = e as Error;
      post({ type: 'reply', id: msg.id, ok: false, error: err?.message ? String(err.message) : String(e) });
    }
  });
};
