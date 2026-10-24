// Workspaces saved in IndexedDB (database "mc-dbt-workspaces"): every file of the learner's home folder in the
// virtual file system (project, profile, practice database), so that a reload keeps the work.
// Used in the Web Worker. One record per file; after each command only the changed files are written.
import type { WorkspaceMeta } from './types.ts';

export interface FileRec {
  ws: string;
  path: string;          // relative to the home folder, e.g. "dbt-course/jaffle_dbt/dbt_project.yml"
  dir: boolean;
  data?: Uint8Array;
  mtime: number;
  size: number;
}

const DB = 'mc-dbt-workspaces';
let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function openStore(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('meta', { keyPath: 'ws' });
        const files = db.createObjectStore('files', { keyPath: ['ws', 'path'] });
        files.createIndex('ws', 'ws');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

export async function getMeta(ws: string): Promise<WorkspaceMeta | undefined> {
  const db = await openStore();
  return req(db.transaction('meta').objectStore('meta').get(ws));
}

export async function listMeta(): Promise<WorkspaceMeta[]> {
  const db = await openStore();
  return req(db.transaction('meta').objectStore('meta').getAll());
}

export async function putMeta(meta: WorkspaceMeta): Promise<void> {
  const db = await openStore();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(meta);
  await done(tx);
}

export async function loadFiles(ws: string): Promise<FileRec[]> {
  const db = await openStore();
  return req(db.transaction('files').objectStore('files').index('ws').getAll(IDBKeyRange.only(ws)));
}

/** Write changed files and remove deleted ones, together with the metadata, in one transaction. */
export async function applyChanges(ws: string, puts: FileRec[], dels: string[], meta: WorkspaceMeta | null, replaceAll = false): Promise<void> {
  const db = await openStore();
  const tx = db.transaction(['files', 'meta'], 'readwrite');
  const files = tx.objectStore('files');
  if (replaceAll) files.delete(IDBKeyRange.bound([ws, ''], [ws, '￿']));
  for (const p of dels) files.delete([ws, p]);
  for (const r of puts) files.put(r);
  if (meta) tx.objectStore('meta').put(meta);
  await done(tx);
}

export async function deleteWorkspace(ws: string): Promise<void> {
  const db = await openStore();
  const tx = db.transaction(['files', 'meta'], 'readwrite');
  tx.objectStore('files').delete(IDBKeyRange.bound([ws, ''], [ws, '￿']));
  tx.objectStore('meta').delete(ws);
  await done(tx);
}
