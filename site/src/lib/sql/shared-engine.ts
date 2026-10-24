/**
 * One SQL engine per page, shared by every island (workspace, playground, Jinja playground).
 * Tiny on purpose: the heavy module (./engine -> @duckdb/duckdb-wasm) is only fetched when the first
 * island asks for it.
 */
import type { Progress, SqlEngine } from './engine.ts';
import { ensureServiceWorker } from '../sw-register.ts';
import manifest from './data-manifest.json';

let promise: Promise<SqlEngine> | null = null;
let current: SqlEngine | null = null;
let last: Progress = { phase: 'code' };
const listeners = new Set<(p: Progress) => void>();
const changeListeners = new Set<(why: string) => void>();

export function onEngineProgress(fn: (p: Progress) => void): () => void {
  listeners.add(fn);
  fn(last);
  return () => { listeners.delete(fn); };
}

/** Called after something changed the data for every island (reset, day 2, restart...). */
export function onDataChange(fn: (why: string) => void): () => void {
  changeListeners.add(fn);
  return () => { changeListeners.delete(fn); };
}
export function notifyDataChange(why: string): void {
  changeListeners.forEach((l) => l(why));
}

export function engineProgress(): Progress {
  return last;
}

/** Download size of the engine (gzip), for labels like "about 8 MB, once". */
export const ENGINE_DOWNLOAD_BYTES = manifest.wasm.eh.wasm.gzip + manifest.wasm.eh.worker.gzip
  + manifest.files.reduce((s, f) => s + f.gzip, 0);

const emit = (p: Progress) => { last = p; listeners.forEach((l) => l(p)); };

/** Remove cache entries of older engine / data versions (only the page knows what is current). */
async function pruneCaches(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    for (const name of await caches.keys()) {
      if (name.startsWith('mc-sql-data-') && name !== `mc-sql-data-${manifest.version}`) await caches.delete(name);
      if (name.startsWith('mc-sql-ext-') && name !== `mc-sql-ext-${manifest.duckdbVersion}`) await caches.delete(name);
    }
    const { ehBundle } = await import('./bundles.ts');
    const keep = new Set(Object.values(ehBundle()));
    const c = await caches.open('mc-sql-duckdb');
    for (const req of await c.keys()) if (!keep.has(req.url)) await c.delete(req);
  } catch { /* storage blocked: nothing to prune */ }
}

export function getEngine(): Promise<SqlEngine> {
  if (!promise) {
    emit({ phase: 'code' });
    promise = (async () => {
      // let the service worker control this page first (max 2 s), so that even the first download is cached
      await ensureServiceWorker({ waitMs: 2000 }).catch(() => 'failed');
      const m = await import('./engine.ts');
      const engine = await m.SqlEngine.create(emit);
      current = engine;
      const g = globalThis as Record<string, unknown>;
      g.__mcSqlEngine = engine; // e2e tests / debugging
      g.__mcSqlReadyAt = performance.now();
      setTimeout(() => { void pruneCaches(); }, 3000);
      return engine;
    })().catch((e: unknown) => {
      emit({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      promise = null;
      throw e;
    });
  }
  return promise;
}

/** Already started (or ready)? Islands use it to decide whether to start the engine on their own. */
export function engineStarted(): boolean {
  return promise !== null;
}

/**
 * Stop a query that runs too long: the DuckDB worker cannot be interrupted, so it is terminated and a new
 * engine is started (from the cache: about 1 s). All data goes back to day 1.
 */
export async function restartEngine(): Promise<SqlEngine> {
  const old = current;
  current = null;
  promise = null;
  if (old) void old.terminate();
  const e = await getEngine();
  notifyDataChange('restart');
  return e;
}
