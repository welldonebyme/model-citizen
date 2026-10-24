// Registers the site's ONE service worker (public/sw.js), shared by every feature that caches heavy files
// (dbt engine, Pyodide, DuckDB-WASM). Call ensureServiceWorker() only when a feature is about to load such
// files: reading pages never register it. Safe to call many times (one registration per page).
import { url } from './url';

export type SwState = 'controlled' | 'registered' | 'unsupported' | 'failed';

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

function register(): Promise<ServiceWorkerRegistration | null> {
  if (!registration) {
    registration = (async () => {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
      try {
        // updateViaCache 'none': a new sw.js is picked up on the next visit, whatever the HTTP cache says
        return await navigator.serviceWorker.register(url('sw.js'), { scope: url(''), updateViaCache: 'none' });
      } catch {
        return null; // e.g. Firefox private windows, or blocked by the browser
      }
    })();
  }
  return registration;
}

/**
 * Register the service worker and, if asked, wait (at most `waitMs`) until it controls this page, so that the
 * requests that follow (including those of Web Workers started afterwards) go through its cache.
 */
export async function ensureServiceWorker(opts: { waitMs?: number } = {}): Promise<SwState> {
  const reg = await register();
  if (!reg) return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? 'failed' : 'unsupported';
  if (navigator.serviceWorker.controller) return 'controlled';
  const waitMs = opts.waitMs ?? 0;
  if (waitMs <= 0) return 'registered';
  const controlled = await new Promise<boolean>((resolve) => {
    const done = (v: boolean) => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', onChange); resolve(v); };
    const onChange = () => done(true);
    const timer = setTimeout(() => done(!!navigator.serviceWorker.controller), waitMs);
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
  return controlled ? 'controlled' : 'registered';
}
