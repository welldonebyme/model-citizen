/**
 * Self-hosted DuckDB-WASM files (Vite `?url` imports: content-hashed files emitted to <base>_assets/).
 *
 * Only the `eh` bundle (WebAssembly exception handling) is shipped: every browser the learners use has it
 * (Chrome/Edge 95+, Firefox 100+, Safari 15.2+). The `mvp` bundle (41 MB, for pre-2022 browsers) would
 * double the size of the site, and the `coi` threads bundle needs COOP/COEP headers that GitHub Pages
 * cannot send. An older browser gets a clear message instead (see engine.ts).
 */
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const abs = (u: string) => new URL(u, self.location.href).href;

export function ehBundle(): { mainModule: string; mainWorker: string } {
  return { mainModule: abs(ehWasm), mainWorker: abs(ehWorker) };
}
