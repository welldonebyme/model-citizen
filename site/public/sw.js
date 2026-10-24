/* Model Citizen service worker: the ONE service worker of the site (registered by src/lib/sw-register.ts).
 *
 * It only makes heavy, immutable files fast on repeat visits (and available offline once downloaded).
 * Pages, search, progress and everything not listed in RULES go to the network untouched: the fetch handler
 * does nothing unless a rule matches.
 *
 * How to add a feature: add one entry to RULES (keep sections separated, one owner per section).
 *   match(url, request) -> boolean         which GET requests the rule handles (same origin only)
 *   cacheName(url)      -> string           Cache Storage name; put a version in it, so a new version = a new cache
 *   strategy            'cache-first'       serve from the cache, else fetch, store a copy if the response is OK
 * Old caches of a rule are removed by the feature itself (see pruneEngineCaches in src/lib/dbt/engine-cache.ts),
 * because only the page knows which version is current.
 */
const SW_VERSION = 2; // 2: SQL labs rules (sections 2 and 3)
const BASE = new URL('./', self.location).pathname; // "/model-citizen/" on GitHub Pages, "/" elsewhere

const RULES = [
  // ---------------------------------------------------------------------------------------------------------
  // Section 1: Pyodide core + dbt engine (owner: dbt in the browser, src/lib/dbt/). Folders are version-named
  // and immutable: engines/pyodide/<pyodide version>/... (shared with the YAML/Jinja playgrounds) and
  // engines/dbt/<engine id>/... . engines/dbt/current.json (which engine is current) is NOT cached.
  {
    id: 'engines-pyodide',
    match: (url) => url.pathname.startsWith(BASE + 'engines/pyodide/'),
    cacheName: (url) => 'mc-engines-pyodide-' + url.pathname.slice((BASE + 'engines/pyodide/').length).split('/')[0],
    strategy: 'cache-first',
  },
  {
    id: 'engines-dbt',
    match: (url) => url.pathname.startsWith(BASE + 'engines/dbt/dbt-'),
    cacheName: (url) => 'mc-engines-dbt-' + url.pathname.slice((BASE + 'engines/dbt/').length).split('/')[0],
    strategy: 'cache-first',
  },
  // ---------------------------------------------------------------------------------------------------------
  // Section 2: DuckDB-WASM (owner: SQL labs, src/lib/sql/). Only the two big content-hashed files emitted by
  // Vite from @duckdb/duckdb-wasm: _assets/duckdb-eh.<hash>.wasm and _assets/duckdb-browser-eh.worker.<hash>.js.
  // A new DuckDB version = new file names; shared-engine.ts deletes entries that are no longer current.
  {
    id: 'sql-duckdb',
    match: (url) => url.pathname.startsWith(BASE + '_assets/') && /\/duckdb-(eh|browser-eh\.worker)\.[\w-]+\.(wasm|js)$/.test(url.pathname),
    cacheName: () => 'mc-sql-duckdb',
    strategy: 'cache-first',
  },
  // ---------------------------------------------------------------------------------------------------------
  // Section 3: practice data + self-hosted DuckDB extensions (owner: SQL labs). Data URLs carry the content
  // hash of the data (data/practice/...?v=<hash>), one cache per hash; extensions live in a folder named after
  // the DuckDB version (data/duckdb-ext/v1.5.4/...), one cache per version. Old caches: see shared-engine.ts.
  {
    id: 'sql-data',
    match: (url) => url.pathname.startsWith(BASE + 'data/practice/') && url.searchParams.has('v'),
    cacheName: (url) => 'mc-sql-data-' + url.searchParams.get('v'),
    strategy: 'cache-first',
  },
  {
    id: 'sql-extensions',
    match: (url) => url.pathname.startsWith(BASE + 'data/duckdb-ext/v'),
    cacheName: (url) => 'mc-sql-ext-' + url.pathname.slice((BASE + 'data/duckdb-ext/').length).split('/')[0],
    strategy: 'cache-first',
  },
  // ---------------------------------------------------------------------------------------------------------
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function cacheFirst(rule, url, request) {
  let cache = null;
  try {
    cache = await caches.open(rule.cacheName(url));
  } catch {
    return fetch(request); // Cache Storage unavailable (some private modes): plain network
  }
  const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.status === 200 && response.type === 'basic') {
    try {
      await cache.put(request, response.clone());
    } catch {
      /* quota exceeded or private mode: serve without caching */
    }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  const rule = RULES.find((r) => r.match(url, request));
  if (!rule) return; // not ours: the browser handles it as if there were no service worker
  if (rule.strategy === 'cache-first') event.respondWith(cacheFirst(rule, url, request));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'mc:sw-version') {
    event.source && event.source.postMessage({ type: 'mc:sw-version', version: SW_VERSION, rules: RULES.map((r) => r.id) });
  }
  // a page loaded with a hard reload (Shift+Reload, or some automated browsers) is not controlled: take it back,
  // so the Web Workers it starts use the caches above (sw-register.ts asks for it before a heavy engine starts)
  if (event.data && event.data.type === 'mc:claim') event.waitUntil(self.clients.claim());
});
