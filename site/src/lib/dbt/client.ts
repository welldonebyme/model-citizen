// Main-thread API of "dbt in the browser". One engine (one Web Worker) per page; the UI (components/dbt/) uses it.
//
//   const engine = DbtEngine.shared();
//   const m = await engine.manifest();               // sizes for the start card (small JSON, no engine download)
//   await engine.boot((p) => ...);                   // downloads (or reads from cache) and starts Python + dbt
//   await engine.open('jaffle-ch07', 'ch07-start', 'continue', handlers);
//   const { code } = await engine.exec('dbt build', { cols: 100 }, handlers);
//   await engine.cancel();                           // stop a long command: terminate the worker, start again
import { url } from '../url';
import { ensureServiceWorker } from '../sw-register';
import { pruneEngineCaches } from './engine-cache';
import type { EngineManifest, ExecContext, FileEntry, Note, PresetIndex, Progress, WorkerEvent, WorkerRequest, WorkspaceMeta } from './types';

export interface OutputHandlers {
  line?: (kind: 'out' | 'err', text: string) => void;
  note?: (note: Note) => void;
  cmd?: (text: string) => void;
  clear?: () => void;
}

export interface BootInfo {
  versions: Record<string, string>;
  timings: Record<string, number>;
  resources?: { files: number; transferBytes: number; decodedBytes: number };
  /** false when every engine file was already in the service worker cache before the start */
  cold: boolean;
  /** wall time from the click to a started engine (ms) */
  wallMs: number;
}

export interface OpenResult {
  busy?: boolean;
  restored: boolean;
  ok?: boolean;
  failed?: string;
  meta?: WorkspaceMeta;
  presetChanged?: boolean;
  prepareMs?: number;
  persist?: boolean;
}

export interface ExecResult { code: number; cwd: string; prompt: string; memoryMB?: number }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; handlers?: OutputHandlers };
type Request = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export const ENGINE_BASE = () => new URL(url('engines/'), location.href).href;
export const PRESETS_BASE = () => new URL(url('presets/dbt/'), location.href).href;

let sharedEngine: DbtEngine | null = null;
let manifestPromise: Promise<EngineManifest> | null = null;
let presetsPromise: Promise<PresetIndex> | null = null;

/** The engine manifest (public/engines/dbt/current.json): versions, file list and sizes. */
export function loadManifest(): Promise<EngineManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(url('engines/dbt/current.json'), { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`The dbt engine is missing from this build (HTTP ${r.status}).`);
      return r.json();
    });
    manifestPromise.catch(() => { manifestPromise = null; });
  }
  return manifestPromise;
}

/** The preset index (public/presets/dbt/index.json). */
export function loadPresets(): Promise<PresetIndex> {
  if (!presetsPromise) {
    presetsPromise = fetch(url('presets/dbt/index.json'), { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`The lab presets are missing (HTTP ${r.status}).`);
      return r.json();
    });
    presetsPromise.catch(() => { presetsPromise = null; });
  }
  return presetsPromise;
}

/** Workspace id for a preset: one workspace per chapter ("ch07-start" and "ch07-end" share "jaffle-ch07"). */
export function workspaceFor(presetId: string, project = 'jaffle'): string {
  const m = presetId.match(/^(ch\d\d|m\d\d)-/);
  return `${project}-${m ? m[1] : presetId}`;
}

export class DbtEngine extends EventTarget {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private bootPromise: Promise<BootInfo> | null = null;
  private lastOpen: { ws: string; preset: string } | null = null;
  state: 'idle' | 'booting' | 'ready' | 'error' = 'idle';
  info: BootInfo | null = null;
  lastProgress: Progress | null = null;

  static shared(): DbtEngine {
    if (!sharedEngine) {
      sharedEngine = new DbtEngine();
      // read-only handle for the end-to-end tests and for curious learners (devtools): window.__mcDbt.info
      try { (globalThis as unknown as { __mcDbt?: DbtEngine }).__mcDbt = sharedEngine; } catch { /* no window */ }
    }
    return sharedEngine;
  }

  private spawn() {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dbt-engine' });
    w.onmessage = (ev: MessageEvent<WorkerEvent>) => this.onEvent(ev.data);
    w.onerror = (ev) => {
      const err = new Error(ev.message || 'The dbt engine stopped (worker error).');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.state = 'error';
      this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
    };
    this.worker = w;
  }

  private onEvent(m: WorkerEvent) {
    if (m.type === 'progress') {
      this.lastProgress = m.progress;
      this.dispatchEvent(new CustomEvent('progress', { detail: m.progress }));
      return;
    }
    const p = this.pending.get(m.id);
    if (m.type === 'reply') {
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
      return;
    }
    const h = p?.handlers;
    if (!h) return;
    if (m.type === 'line') h.line?.(m.kind, m.text);
    else if (m.type === 'note') h.note?.(m.note);
    else if (m.type === 'cmd') h.cmd?.(m.text);
    else if (m.type === 'clear') h.clear?.();
  }

  private request<T>(req: Request, handlers?: OutputHandlers): Promise<T> {
    if (!this.worker) this.spawn();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, handlers });
      this.worker!.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  /** Start the engine (idempotent). Progress events: 'progress' (detail: Progress). */
  boot(onProgress?: (p: Progress) => void): Promise<BootInfo> {
    const listener = onProgress ? (e: Event) => onProgress((e as CustomEvent<Progress>).detail) : null;
    if (listener) this.addEventListener('progress', listener);
    if (!this.bootPromise) {
      this.state = 'booting';
      this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
      this.bootPromise = (async () => {
        const t0 = performance.now();
        const [manifest, presets] = await Promise.all([loadManifest(), loadPresets()]);
        // the service worker caches engine files: let it control the page before the worker starts (first visit)
        await ensureServiceWorker({ waitMs: 3000 });
        const cold = !(await this.isCached(manifest));
        const r = await this.request<Omit<BootInfo, 'cold' | 'wallMs'>>({
          type: 'boot', engineBase: ENGINE_BASE(), presetsBase: PRESETS_BASE(), manifest, presets,
        });
        void pruneEngineCaches([`mc-engines-dbt-${manifest.id}`, `mc-engines-pyodide-${manifest.versions.pyodide}`]);
        this.info = { ...r, cold, wallMs: Math.round(performance.now() - t0) };
        this.state = 'ready';
        this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
        return this.info;
      })();
      this.bootPromise.catch(() => {
        this.bootPromise = null;
        this.state = 'error';
        this.worker?.terminate();
        this.worker = null;
        this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
      });
    }
    return this.bootPromise.finally(() => { if (listener) this.removeEventListener('progress', listener); });
  }

  /** True if the engine files of the boot are all in the service worker cache (no download needed). */
  async isCached(manifest?: EngineManifest): Promise<boolean> {
    try {
      const m = manifest ?? (await loadManifest());
      if (typeof caches === 'undefined') return false;
      const names = [`mc-engines-dbt-${m.id}`, `mc-engines-pyodide-${m.versions.pyodide}`];
      const opened = await Promise.all(names.map((n) => caches.open(n)));
      const base = ENGINE_BASE();
      for (const f of m.files) {
        if (f.group === 'pandas') continue;
        let hit = false;
        for (const c of opened) if (await c.match(base + f.path)) { hit = true; break; }
        if (!hit) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async open(ws: string, preset: string, mode: 'continue' | 'reset', handlers?: OutputHandlers): Promise<OpenResult> {
    await this.boot();
    const r = await this.request<OpenResult>({ type: 'open', ws, preset, mode }, handlers);
    if (!r.busy) this.lastOpen = { ws, preset };
    return r;
  }

  exec(line: string, ctx: ExecContext, handlers: OutputHandlers): Promise<ExecResult> {
    return this.request<ExecResult>({ type: 'exec', line, ctx }, handlers);
  }

  /** Stop what is running: the worker is terminated and started again (files come back from the last save). */
  async cancel(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    w?.terminate();
    const err = new Error('Stopped.');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.bootPromise = null;
    this.state = 'idle';
    await this.boot();
    if (this.lastOpen) await this.request<OpenResult>({ type: 'open', ws: this.lastOpen.ws, preset: this.lastOpen.preset, mode: 'continue' });
  }

  list(dir: string) { return this.request<(FileEntry & { display: string })[]>({ type: 'list', dir }); }
  read(path: string) { return this.request<{ text?: string; binary?: boolean; size?: number; path: string; mtime?: number }>({ type: 'read', path }); }
  write(path: string, text: string) { return this.request<{ path: string; mtime: number }>({ type: 'write', path, text }); }
  async exportZip(): Promise<Blob> {
    const r = await this.request<{ bytes: Uint8Array; files: number }>({ type: 'export' });
    return new Blob([r.bytes as BlobPart], { type: 'application/zip' });
  }
  prepLog() { return this.request<string[]>({ type: 'prep-log' }); }
  workspaces() { return this.request<WorkspaceMeta[]>({ type: 'workspaces' }); }
  deleteWorkspace(ws: string) { return this.request<boolean>({ type: 'delete-workspace', ws }); }
  get running() { return this.worker !== null && this.state === 'ready'; }
}
