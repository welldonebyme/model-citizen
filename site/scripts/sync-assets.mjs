// Copies generated or book-owned assets into public/ before a build (idempotent, never edits sources).
//  - the book PDF  → public/pdf/dbt-bible.pdf, only with MC_INCLUDE_PDF=1: the PDF carries the author's name and
//    local paths, so it ships only once he has said it may be published (otherwise any old copy is removed)
//  - figure SVGs   → public/figures/ (fallback <img> for islands; pages inline them)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
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

const pdf = join(site, 'public/pdf/dbt-bible.pdf');
if (process.env.MC_INCLUDE_PDF === '1') copyIfNewer(join(book, 'dbt-bible.pdf'), pdf);
else if (existsSync(pdf)) { rmSync(pdf); console.log('sync-assets: removed public/pdf/dbt-bible.pdf (set MC_INCLUDE_PDF=1 to ship it)'); }
const figs = join(site, 'src/generated/figures');
if (existsSync(figs)) for (const f of readdirSync(figs)) if (f.endsWith('.svg')) copyIfNewer(join(figs, f), join(site, 'public/figures', f));
