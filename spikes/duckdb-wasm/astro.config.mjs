// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

import { fileURLToPath } from 'node:url';

// GitHub Pages "project page": https://<user>.github.io/<repo>/  ->  base = "/<repo>/"
export const BASE = process.env.SITE_BASE ?? '/dbt-academy/';
// DUCKDB_CHANNEL=next builds the comparison variant with the `next` dist-tag (DuckDB 2.0-dev) into dist-next/
const NEXT = process.env.DUCKDB_CHANNEL === 'next';

export default defineConfig({
  site: 'https://welldonebyme.github.io',
  base: BASE,
  trailingSlash: 'always', // GitHub Pages serves /dir/ -> /dir/index.html; keeps BASE_URL = "/dbt-academy/"
  output: 'static',
  outDir: NEXT ? './dist-next' : './dist',
  build: { format: 'directory' },
  integrations: [react()],
  vite: {
    // duckdb-wasm ships pre-bundled ESM + its own workers: do not let the dep optimizer touch it
    optimizeDeps: { exclude: ['@duckdb/duckdb-wasm', 'duckdb-wasm-next'] },
    resolve: {
      alias: NEXT
        ? [
            { find: /^@duckdb\/duckdb-wasm$/, replacement: 'duckdb-wasm-next' },
            { find: /^\.\/bundles$/, replacement: fileURLToPath(new URL('./src/lib/bundles-next.ts', import.meta.url)) },
          ]
        : [],
    },
    build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 2048 },
  },
});
