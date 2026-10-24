/**
 * Self-hosted DuckDB-WASM bundles (Vite `?url` imports: hashed files emitted to /<base>/_astro/).
 * Only the single-threaded bundles: `eh` (WebAssembly exceptions, every current browser) and `mvp`
 * (fallback for old browsers). The `coi` threads bundle needs COOP/COEP headers that GitHub Pages
 * cannot send, so it is not shipped at all.
 */
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

const abs = (u: string) => new URL(u, self.location.href).href;

export const CHANNEL = 'latest';
export function bundles() {
  return {
    mvp: { mainModule: abs(mvpWasm), mainWorker: abs(mvpWorker) },
    eh: { mainModule: abs(ehWasm), mainWorker: abs(ehWorker) },
  };
}
export const bundleName = (mainModule: string) => (mainModule.includes('duckdb-eh') ? 'eh' : 'mvp');
