// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// GitHub Pages project site: https://welldonebyme.github.io/<repo>/  (repo name decided at launch).
// The base path is used in dev too, so base-path bugs show up before launch.
const base = process.env.SITE_BASE ?? '/model-citizen/';

// The converter keeps the book's original wording next to some rewritten text (textBook, titleBook: e.g. the
// author's own folder before it became /Users/you). The site never shows it, so it is removed from every
// generated JSON file before anything reads it, and cannot end up in a page or an island's props.
const BOOK_ONLY = new Set(['textBook', 'titleBook']);
const stripBookText = {
  name: 'mc-strip-book-text',
  enforce: 'pre',
  transform(code, id) {
    if (!/\/src\/generated\/.*\.json$/.test(id.split('?')[0])) return null;
    return { code: JSON.stringify(JSON.parse(code, (k, v) => (BOOK_ONLY.has(k) ? undefined : v))), map: null };
  },
};

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://welldonebyme.github.io',
  base,
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_assets' },
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [stripBookText],
    worker: { format: 'es' },
  },
});
