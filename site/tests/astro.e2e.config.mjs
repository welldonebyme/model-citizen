// Astro config for the end-to-end tests: the site config, with its own Vite cache folder so a test
// server can run next to the normal dev server without both rewriting node_modules/.vite, and test pages:
// /test/checkpoints/<lesson id>/ mounts the lesson checkpoints like a lesson page will; /test/delight/ mounts
// the delight islands (XP and badges, celebrations, focus timer, explain it back, shortcuts).
// The test pages exist only in this test build, never in the site.
import { fileURLToPath } from 'node:url';
import base from '../astro.config.mjs';

const testPages = {
  name: 'model-citizen-test-pages',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      injectRoute({ pattern: '/test/checkpoints/[lesson]', entrypoint: fileURLToPath(new URL('./e2e/pages/checkpoints.astro', import.meta.url)) });
      injectRoute({ pattern: '/test/delight', entrypoint: fileURLToPath(new URL('./e2e/pages/delight.astro', import.meta.url)) });
    },
  },
};

export default {
  ...base,
  root: fileURLToPath(new URL('..', import.meta.url)),
  integrations: [...(base.integrations ?? []), testPages],
  vite: { ...(base.vite ?? {}), cacheDir: fileURLToPath(new URL('../node_modules/.vite-e2e', import.meta.url)) },
};
