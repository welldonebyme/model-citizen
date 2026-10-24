// QA gate: every internal link and #anchor of the built site resolves (dist/, base /model-citizen/).
// Usage: node scripts/qa/check-links.mjs [distDir]. Exit code 1 when something is broken.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const BASE = '/model-citizen/';
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.html')) files.push(p); } })(DIST);

const ids = new Map();       // page path → Set of ids
const pageOf = (file) => '/' + posix.relative(DIST, file).replace(/index\.html$/, '');
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  ids.set(pageOf(f), new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}
const broken = [];
let checked = 0;
for (const f of files) {
  const from = pageOf(f);
  const html = readFileSync(f, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
    let href = m[1].replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|data:|javascript:)/.test(href)) continue;
    checked++;
    const [pathPart, hash] = href.split('#');
    let path = pathPart.split('?')[0];
    if (path === '') path = from === '/' ? '/' : from;            // same page
    else if (!path.startsWith('/')) path = posix.join(posix.dirname(from.endsWith('/') ? from + 'x' : from), path);
    if (!path.startsWith(BASE) && path !== from) { broken.push(`${from} → ${href} (outside the base)`); continue; }
    const rel = path.startsWith(BASE) ? path.slice(BASE.length - 1) : path;
    const target = join(DIST, rel);
    const page = rel.endsWith('/') ? join(target, 'index.html') : target;
    const exists = existsSync(page) || existsSync(join(target, 'index.html'));
    if (!exists) { broken.push(`${from} → ${href} (no page)`); continue; }
    if (hash) {
      const key = rel.endsWith('/') ? rel : existsSync(join(target, 'index.html')) ? rel + '/' : rel;
      const set = ids.get(key);
      if (set && !set.has(decodeURIComponent(hash))) broken.push(`${from} → ${href} (no #${hash})`);
    }
  }
}
const uniq = [...new Set(broken)];
console.log(`${files.length} pages, ${checked} internal links checked, ${uniq.length} broken`);
for (const b of uniq.slice(0, 80)) console.log('  ' + b);
process.exit(uniq.length ? 1 : 0);
