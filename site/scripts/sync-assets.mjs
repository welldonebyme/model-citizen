// Copies generated or book-owned assets into public/ before a build (idempotent, never edits sources).
//  - the book PDF  → public/pdf/dbt-bible.pdf
//  - figure SVGs   → public/figures/ (fallback <img> for islands; pages inline them)
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const book = resolve(site, '../../dbt-bible');

function copyIfNewer(src, dst) {
  if (!existsSync(src)) { console.warn(`sync-assets: missing ${src}`); return; }
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs && statSync(dst).size === statSync(src).size) return;
  cpSync(src, dst);
  console.log(`sync-assets: ${dst.replace(site + '/', '')}`);
}

copyIfNewer(join(book, 'dbt-bible.pdf'), join(site, 'public/pdf/dbt-bible.pdf'));
const figs = join(site, 'src/generated/figures');
if (existsSync(figs)) for (const f of readdirSync(figs)) if (f.endsWith('.svg')) copyIfNewer(join(figs, f), join(site, 'public/figures', f));
