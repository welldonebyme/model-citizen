/**
 * One Python engine (Pyodide worker) per page, shared by the YAML and Jinja playgrounds and the model builder.
 * Lazy: nothing is downloaded until a tool asks for it. run_query / adapter.* calls of a render are answered
 * by the page's SQL engine (DuckDB-WASM), started on demand.
 */
import type { PyClient, PyInfo } from './client.ts';
import { ensureServiceWorker } from '../sw-register.ts';

export type PyPhase = 'idle' | 'loading' | 'ready' | 'error';
export interface PyProgress { phase: PyPhase; stage?: string; message?: string }

let client: Promise<PyClient> | null = null;
let last: PyProgress = { phase: 'idle' };
const listeners = new Set<(p: PyProgress) => void>();
const emit = (p: PyProgress) => { last = p; listeners.forEach((l) => l(p)); };

export function onPyProgress(fn: (p: PyProgress) => void): () => void {
  listeners.add(fn);
  fn(last);
  return () => { listeners.delete(fn); };
}

const STAGES: Record<string, string> = {
  imported: 'Starting Python…',
  core: 'Loading jinja2 and PyYAML…',
  packages: 'Loading the dbt-like context…',
  modules: 'Loading the example projects…',
  fixtures: 'Ready',
};
export const stageText = (stage?: string) => (stage ? STAGES[stage] ?? 'Starting Python…' : 'Downloading Python (Pyodide)…');

export function getPy(): Promise<PyClient> {
  if (!client) {
    emit({ phase: 'loading' });
    client = (async () => {
      await ensureServiceWorker({ waitMs: 2000 }).catch(() => 'failed');
      const { PyClient } = await import('./client.ts');
      const py = new PyClient({
        onProgress: (m) => emit(m.stage === 'fixtures' ? { phase: 'ready' } : { phase: 'loading', stage: m.stage }),
        onQuery: async (sql) => {
          const { getEngine } = await import('../sql/shared-engine.ts');
          const engine = await getEngine();
          return engine.queryJson(sql);
        },
        onRestart: () => emit({ phase: 'loading', message: 'Restarting Python…' }),
      });
      const info: PyInfo = await py.ready;
      emit({ phase: 'ready' });
      const g = globalThis as Record<string, unknown>;
      g.__mcPy = py; // e2e tests / debugging
      g.__mcPyInfo = info;
      return py;
    })().catch((e: unknown) => {
      emit({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      client = null;
      throw e;
    });
  }
  return client;
}

export function pyStarted(): boolean {
  return client !== null;
}
