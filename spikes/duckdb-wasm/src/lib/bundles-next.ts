/**
 * Variant for the `next` npm dist-tag (@duckdb/duckdb-wasm 1.33.1-dev110.0 = DuckDB 2.0.0-dev):
 * the bundles are renamed `base` (single-threaded, needs WebAssembly exceptions; MVP is gone) and
 * `threads` (needs cross-origin isolation, not shipped). Selected with DUCKDB_CHANNEL=next.
 */
import baseWasm from 'duckdb-wasm-next/dist/duckdb-base.wasm?url';
import baseWorker from 'duckdb-wasm-next/dist/duckdb-browser-base.worker.js?url';

const abs = (u: string) => new URL(u, self.location.href).href;

export const CHANNEL = 'next';
export function bundles() {
  return { base: { mainModule: abs(baseWasm), mainWorker: abs(baseWorker) } };
}
export const bundleName = (_mainModule: string) => 'base';
