/**
 * One engine per page, shared by every lab island. Tiny on purpose: the heavy module
 * (./engine -> @duckdb/duckdb-wasm) is only fetched when the first island asks for it.
 */
import type { Progress, SqlEngine } from './engine';

let promise: Promise<SqlEngine> | null = null;
let last: Progress = { phase: 'worker', message: 'waiting' };
const listeners = new Set<(p: Progress) => void>();

export function onEngineProgress(fn: (p: Progress) => void): () => void {
  listeners.add(fn);
  fn(last);
  return () => { listeners.delete(fn); };
}

export function getEngine(): Promise<SqlEngine> {
  if (!promise) {
    const emit = (p: Progress) => { last = p; listeners.forEach((l) => l(p)); };
    emit({ phase: 'worker', message: 'loading engine code' });
    promise = import('./engine')
      .then((m) => m.SqlEngine.create(emit))
      .then((engine) => {
        (globalThis as Record<string, unknown>).__sqlEngine = engine; // for e2e tests / debugging
        return engine;
      })
      .catch((e: unknown) => {
        emit({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
        promise = null;
        throw e;
      });
  }
  return promise;
}
