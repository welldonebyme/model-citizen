// Astro config for the end-to-end tests: the site config, with its own Vite cache folder so a test
// server can run next to the normal dev server without both rewriting node_modules/.vite.
import { fileURLToPath } from 'node:url';
import base from '../astro.config.mjs';

export default {
  ...base,
  root: fileURLToPath(new URL('..', import.meta.url)),
  vite: { ...(base.vite ?? {}), cacheDir: fileURLToPath(new URL('../node_modules/.vite-e2e', import.meta.url)) },
};
