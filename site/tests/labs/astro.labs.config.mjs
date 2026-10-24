// Astro config for the labs tests: the site config, built into .cache/labs/dist (not dist/, which other
// builds use) with its own Vite cache, so the labs suite can build and serve the site on its own.
import { fileURLToPath } from 'node:url';
import base from '../../astro.config.mjs';

// builds the test-only pages (src/pages/labs/sql/[test].astro)
process.env.LABS_TEST_PAGES ??= '1';

export default {
  ...base,
  root: fileURLToPath(new URL('../..', import.meta.url)),
  outDir: fileURLToPath(new URL('../../.cache/labs/dist', import.meta.url)),
  vite: { ...(base.vite ?? {}), cacheDir: fileURLToPath(new URL('../../node_modules/.vite-labs', import.meta.url)) },
};
