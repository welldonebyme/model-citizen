// "Keep the course available offline" (Settings). Saves every page and the files they need, listed in
// offline-manifest.json at build time, into Cache Storage; the service worker (public/sw.js, section 4) then
// serves the saved copy whenever the network fails. Off by default; turning it off deletes the copies.
import { ensureServiceWorker } from './sw-register';
import { url } from './url';

const MARKER = 'mc-offline-on';
const PAGES = 'mc-offline-pages';
const ASSETS = 'mc-offline-assets';
const VERSION_KEY = 'mc:offline-version';

export interface Manifest { version: string; bytes: number; pages: string[]; files: string[] }
export interface OfflineStatus { supported: boolean; on: boolean; savedVersion: string | null; usedBytes?: number }

export const offlineSupported = () => typeof window !== 'undefined' && 'caches' in window && 'serviceWorker' in navigator;

async function tellWorker() {
  const reg = await navigator.serviceWorker.getRegistration(url('')).catch(() => undefined);
  for (const w of [reg?.active, navigator.serviceWorker.controller]) w?.postMessage({ type: 'mc:offline' });
}

export async function offlineStatus(): Promise<OfflineStatus> {
  if (!offlineSupported()) return { supported: false, on: false, savedVersion: null };
  const on = await caches.has(MARKER).catch(() => false);
  let savedVersion: string | null = null;
  try { savedVersion = localStorage.getItem(VERSION_KEY); } catch { /* storage blocked */ }
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  return { supported: true, on, savedVersion: on ? savedVersion : null, usedBytes: est?.usage };
}

export async function fetchManifest(): Promise<Manifest> {
  const r = await fetch(url('offline-manifest.json'), { cache: 'no-cache' });
  if (!r.ok) throw new Error('The list of files to save is missing from this build.');
  return r.json();
}

/**
 * Turn offline reading on and save everything (or only what changed since the last save).
 * onProgress(done, total) is called as files are saved. Resolves with the number of files that failed.
 */
export async function saveOffline(onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<number> {
  const state = await ensureServiceWorker({ waitMs: 3000 });
  if (state === 'unsupported' || state === 'failed') throw new Error('This browser does not allow offline copies here (a private window, or blocked storage).');
  await navigator.storage?.persist?.().catch(() => false);
  const m = await fetchManifest();
  await caches.open(MARKER);
  await tellWorker();
  const pages = await caches.open(PAGES);
  const assets = await caches.open(ASSETS);
  // hashed build files never change: keep the ones already saved; pages and data are saved again
  const have = new Set((await assets.keys()).map((r) => new URL(r.url).pathname));
  const jobs: { u: string; cache: Cache }[] = [
    ...m.files.filter((f) => f.includes('/_assets/')).filter((f) => !have.has(f)).map((u) => ({ u, cache: assets })),
    ...m.files.filter((f) => !f.includes('/_assets/')).map((u) => ({ u, cache: pages })),
    ...m.pages.map((u) => ({ u, cache: pages })),
  ];
  let done = 0, failed = 0;
  onProgress(0, jobs.length);
  const queue = [...jobs];
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      if (signal?.aborted) return;
      try {
        const res = await fetch(j.u, { cache: 'no-cache', credentials: 'same-origin' });
        if (res.ok) await j.cache.put(j.u, res); else failed++;
      } catch { failed++; }
      onProgress(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (!signal?.aborted) { try { localStorage.setItem(VERSION_KEY, m.version); } catch { /* storage blocked */ } }
  return failed;
}

/** Turn offline reading off and delete the saved copies (the labs' engine caches are kept). */
export async function removeOffline(): Promise<void> {
  if (!offlineSupported()) return;
  await Promise.all([MARKER, PAGES, ASSETS].map((c) => caches.delete(c).catch(() => false)));
  try { localStorage.removeItem(VERSION_KEY); } catch { /* storage blocked */ }
  await tellWorker();
}
