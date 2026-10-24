// Progress file: export everything to one JSON file, import it on another computer (merge, never wipe).
import { db, SCHEMA_VERSION, type ModelCitizenDB } from './db';

export const APP_ID = 'model-citizen';
const TABLES = ['settings', 'progress', 'answers', 'examAttempts', 'srs', 'notes', 'activity'] as const;
type TableName = (typeof TABLES)[number];

export interface ProgressFile {
  app: typeof APP_ID;
  schema: number;
  exportedAt: string;
  data: Record<TableName, unknown[]>;
}

export async function exportProgress(database: ModelCitizenDB = db()): Promise<ProgressFile> {
  const data = {} as Record<TableName, unknown[]>;
  for (const t of TABLES) data[t] = await database.table(t).toArray();
  return { app: APP_ID, schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
}

export function progressFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `model-citizen-progress-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export class ImportError extends Error {}

/** Checks the file shape. Returns a readable reason when the file cannot be used. */
export function validateProgressFile(raw: unknown): ProgressFile {
  if (!raw || typeof raw !== 'object') throw new ImportError('This file is not a Model Citizen progress file (it is not JSON data).');
  const f = raw as Partial<ProgressFile>;
  if (f.app !== APP_ID) throw new ImportError('This file is not a Model Citizen progress file.');
  if (typeof f.schema !== 'number') throw new ImportError('The progress file has no version number.');
  if (f.schema > SCHEMA_VERSION) throw new ImportError('This progress file comes from a newer version of the site. Reload the page to get the latest version, then import again.');
  if (!f.data || typeof f.data !== 'object') throw new ImportError('The progress file is empty.');
  for (const t of TABLES) {
    const rows = (f.data as Record<string, unknown>)[t];
    if (rows !== undefined && !Array.isArray(rows)) throw new ImportError(`The progress file is damaged (${t}).`);
  }
  return f as ProgressFile;
}

export interface ImportSummary { added: number; updated: number; skipped: number }

/**
 * Merges a progress file into this browser. Keyed rows: the newer `updatedAt` wins.
 * Answers are append-only: an answer with the same question, mode and time is not added twice.
 */
export async function importProgress(file: ProgressFile, database: ModelCitizenDB = db()): Promise<ImportSummary> {
  const sum: ImportSummary = { added: 0, updated: 0, skipped: 0 };
  await database.transaction('rw', TABLES.map((t) => database.table(t)), async () => {
    for (const t of TABLES) {
      const rows = (file.data[t] ?? []) as Record<string, unknown>[];
      const table = database.table(t);
      if (t === 'answers') {
        for (const r of rows) {
          const { id: _drop, ...rest } = r as { id?: number; qid: string; mode: string; at: number };
          void _drop;
          const dup = await table.where('[qid+at]').equals([rest.qid, rest.at]).filter((x: { mode: string }) => x.mode === rest.mode).first();
          if (dup) sum.skipped++;
          else { await table.add(rest); sum.added++; }
        }
        continue;
      }
      const pk = table.schema.primKey.keyPath as string;
      for (const r of rows) {
        const old = (await table.get(r[pk] as string)) as { updatedAt?: number } | undefined;
        if (!old) { await table.put(r); sum.added++; }
        else if (((r.updatedAt as number) ?? 0) > (old.updatedAt ?? 0)) { await table.put(r); sum.updated++; }
        else sum.skipped++;
      }
    }
  });
  return sum;
}

/** Triggers a download of the progress file in the browser. */
export async function downloadProgress() {
  const file = await exportProgress();
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = progressFileName();
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
