#!/usr/bin/env node
/**
 * Static server that behaves like GitHub Pages for a project page (used by the labs tests and for local checks):
 *  - the site lives under BASE (default /model-citizen/), everything else is 404;
 *  - /dir -> 301 /dir/, /dir/ -> /dir/index.html;
 *  - NO Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers (GitHub Pages cannot send them);
 *  - Cache-Control: max-age=600 (what GitHub Pages sends);
 *  - gzip for text types and application/wasm (WASM_GZIP=0 to turn it off for wasm), cached in memory.
 * Test helpers outside the base path: GET /__requests (JSON list of served paths), POST /__requests/clear.
 * Node built-ins only.
 *
 *   node scripts/labs/serve.mjs                # serves .cache/labs/dist at http://127.0.0.1:4410/model-citizen/
 *   DIST=dist PORT=5000 node scripts/labs/serve.mjs
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SITE = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ROOT = resolve(SITE, process.env.DIST ?? '.cache/labs/dist');
const PORT = Number(process.env.PORT ?? 4410);
const BASE = process.env.BASE ?? '/model-citizen/';
const WASM_GZIP = process.env.WASM_GZIP !== '0';
const LOG = process.env.LOG === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8', '.sql': 'application/sql; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.zip': 'application/zip', '.whl': 'application/zip', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.py': 'text/plain; charset=utf-8', '.yml': 'text/plain; charset=utf-8',
};
const compressible = (type) => /^(text\/|application\/(json|javascript|sql)|image\/svg)/.test(type) || (WASM_GZIP && type === 'application/wasm');

const gzCache = new Map();
let requests = [];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/__requests') {
    if (req.method === 'POST') requests = [];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(requests));
    return;
  }
  if (url.pathname === '/__requests/clear') { requests = []; res.writeHead(204); res.end(); return; }
  let path = decodeURIComponent(url.pathname);
  requests.push({ path, search: url.search, t: Date.now() });
  const done = (status, extra = '') => { if (LOG) console.log(status, req.method, url.pathname, extra); };
  if (path === BASE.replace(/\/$/, '')) { res.writeHead(301, { Location: BASE }); res.end(); return done(301); }
  if (!path.startsWith(BASE)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 (outside base path)'); return done(404); }
  let file = normalize(join(ROOT, path.slice(BASE.length)));
  if (!file.startsWith(ROOT + sep) && file !== ROOT) { res.writeHead(403); res.end(); return done(403); }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(301, { Location: path + '/' + url.search }); res.end(); return done(301); }
    file = join(file, 'index.html');
  }
  if (!existsSync(file)) {
    const notFound = join(ROOT, '404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    if (existsSync(notFound)) createReadStream(notFound).pipe(res); else res.end('<h1>404</h1>');
    return done(404);
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'max-age=600', 'Access-Control-Allow-Origin': '*', Vary: 'Accept-Encoding' };
  const gzip = compressible(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (gzip) {
    const key = `${file}:${statSync(file).mtimeMs}`;
    let body = gzCache.get(key);
    if (!body) { body = gzipSync(readFileSync(file), { level: 6 }); gzCache.set(key, body); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': statSync(file).size });
    if (req.method === 'HEAD') { res.end(); return done(200); }
    createReadStream(file).pipe(res);
  }
  done(200, gzip ? 'gzip' : '');
});

server.listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}${BASE} (wasm gzip: ${WASM_GZIP})`));
