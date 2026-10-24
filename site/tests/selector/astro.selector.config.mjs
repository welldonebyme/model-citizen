// Astro config for the selector playground checks (dev server and screenshots): the site config with its own
// Vite cache folder, so this server can run next to the normal dev server without both rewriting node_modules/.vite.
import { fileURLToPath } from 'node:url';
import base from '../../astro.config.mjs';

export default {
  ...base,
  root: fileURLToPath(new URL('../..', import.meta.url)),
  vite: { ...(base.vite ?? {}), cacheDir: fileURLToPath(new URL('../../node_modules/.vite-selector', import.meta.url)) },
};
