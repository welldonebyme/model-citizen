// Lists what "Keep the course available offline" (Settings) saves: every page, the build's scripts and styles,
// figures, quiz/exam/drill data and the search index. The DuckDB engine (34 MB), the dbt and Python engines,
// presets, kits and the PDF are left out: the labs cache those themselves when they are used.
// Writes dist/offline-manifest.json. Run after `astro build` (and after pagefind when there is a search index).
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = process.argv[2] ?? 'dist';
const BASE = process.env.SITE_BASE ?? '/model-citizen/';
const pages = [], files = [];
let bytes = 0;
const hash = createHash('sha256');
const FILES = /^(_assets\/(?!duckdb-)|figures\/|quiz\/data\/|exams\/data\/|practice\/drills\/|pagefind\/|delight\/|favicon\.svg$)/;
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    const rel = relative(DIST, p).split(sep).join('/');
    if (rel.startsWith('dev/')) continue;
    if (rel.endsWith('index.html')) pages.push(BASE + rel.replace(/index\.html$/, ''));
    else if (FILES.test(rel) && !rel.endsWith('.map')) files.push(BASE + rel);
    else continue;
    bytes += st.size;
    hash.update(`${rel}:${st.size}:${st.mtimeMs}\n`);
  }
})(DIST);
if (!existsSync(DIST)) process.exit(0);
pages.sort(); files.sort();
const version = hash.digest('hex').slice(0, 12);
writeFileSync(join(DIST, 'offline-manifest.json'), JSON.stringify({ version, bytes, pages, files }));
console.log(`offline-manifest: ${pages.length} pages, ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB (version ${version})`);
