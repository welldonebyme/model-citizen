// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// GitHub Pages project site: https://welldonebyme.github.io/<repo>/  (repo name decided at launch).
// The base path is used in dev too, so base-path bugs show up before launch.
const base = process.env.SITE_BASE ?? '/model-citizen/';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://welldonebyme.github.io',
  base,
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_assets' },
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    worker: { format: 'es' },
  },
});
