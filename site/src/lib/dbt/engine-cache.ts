// Download progress for engine files, and cleanup of old engine caches.
// The caching itself is done by the site's service worker (public/sw.js, section 1): engine folders are
// version-named and immutable, so they are served cache-first. This module has no dbt-specific code and can be
// used by any feature that loads files from engines/ (for example the YAML/Jinja playgrounds).

export interface TrackedFile { url: string; size: number }

/**
 * Wrap fetch (in a worker: self.fetch) so that every response for a tracked URL reports its bytes as they arrive
 * (decoded bytes, so they add up to the file sizes of the manifest, whatever the transfer encoding).
 * Returns a function that restores the original fetch.
 */
export function trackFetchProgress(scope: { fetch: typeof fetch }, files: TrackedFile[], onBytes: (delta: number, url: string) => void): () => void {
  const real = scope.fetch.bind(scope);
  const tracked = new Map(files.map((f) => [new URL(f.url).href, f.size]));
  scope.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await real(input, init);
    const href = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, (scope as unknown as { location?: Location }).location?.href).href;
    if (!tracked.has(href) || !res.body) return res;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        onBytes(chunk.byteLength, href);
        ctrl.enqueue(chunk);
      },
    });
    return new Response(res.body.pipeThrough(counter), { status: res.status, statusText: res.statusText, headers: res.headers });
  }) as typeof fetch;
  return () => { scope.fetch = real; };
}

/** Delete caches of older engine versions (names written by public/sw.js). Call it after a successful boot. */
export async function pruneEngineCaches(keep: string[]): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  const deleted: string[] = [];
  try {
    for (const name of await caches.keys()) {
      const family = name.match(/^(mc-engines-(?:pyodide|dbt)-)/)?.[1];
      if (!family) continue;
      if (!keep.some((k) => k.startsWith(family)) || keep.includes(name)) continue;
      if (await caches.delete(name)) deleted.push(name);
    }
  } catch {
    /* Cache Storage blocked: nothing to clean */
  }
  return deleted;
}

/** True when all the given URLs are already in Cache Storage (so the next start needs no download). */
export async function allCached(urls: string[], cacheNames: string[]): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const opened = await Promise.all(cacheNames.map((n) => caches.open(n)));
    for (const u of urls) {
      let hit = false;
      for (const c of opened) if (await c.match(u, { ignoreSearch: true })) { hit = true; break; }
      if (!hit) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Raised when the network fails and there is no saved copy: the first start needs a connection. */
export class OfflineError extends Error {
  constructor(message = 'dbt needs an internet connection the first time: connect, then start again. After one start it also works offline.') {
    super(message);
    this.name = 'OfflineError';
  }
}

/**
 * GET a small JSON file that must stay fresh online (which engine is current, the preset index, a preset bundle):
 * from the network (revalidated), and keep a copy in Cache Storage; when the network fails, use the last copy.
 */
export async function fetchJsonWithCopy<T>(url: string, cacheName = 'mc-dbt-meta'): Promise<T> {
  let res: Response | null = null;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch {
    res = null; // offline, or the server cannot be reached
  }
  if (res?.ok) {
    try {
      const c = await caches.open(cacheName);
      await c.put(url, res.clone());
    } catch {
      /* Cache Storage blocked: no offline copy, online works anyway */
    }
    return res.json() as Promise<T>;
  }
  try {
    const hit = await (await caches.open(cacheName)).match(url);
    if (hit) return hit.json() as Promise<T>;
  } catch {
    /* no Cache Storage */
  }
  if (!res) throw new OfflineError();
  throw new Error(`HTTP ${res.status} for ${new URL(url, typeof location !== 'undefined' ? location.href : 'http://x/').pathname}`);
}
