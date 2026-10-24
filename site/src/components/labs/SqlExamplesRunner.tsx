/**
 * "Check every example" on the SQL playground: runs every book example in book order on a fresh database,
 * compares with the book and marks each example of the page. It is also the browser parity suite
 * (window.__mcSqlParity / __mcSqlDay2, used by the Playwright tests).
 */
import { useEffect, useState } from 'react';
import type { ExampleCheck, BookExample, Day2Report } from '../../lib/sql/checks.ts';
import { getEngine, notifyDataChange } from '../../lib/sql/shared-engine.ts';

export interface ParityReport {
  info: Record<string, unknown>;
  userAgent: string;
  rows: ExampleCheck[];
  passed: number;
  total: number;
  totalMs: number;
}

declare global {
  interface Window {
    __mcSqlParity?: (opts?: { ids?: string[] }) => Promise<ParityReport>;
    __mcSqlDay2?: () => Promise<Day2Report>;
  }
}

function mark(id: string, state: 'running' | 'ok' | 'bad' | 'clear', text = '') {
  document.querySelectorAll<HTMLElement>(`[data-example-status="${CSS.escape(id)}"]`).forEach((el) => {
    el.dataset.state = state;
    el.textContent = text;
  });
}

async function runAll(onStep?: (done: number, total: number) => void, ids?: string[]): Promise<ParityReport> {
  const t0 = performance.now();
  const [{ default: data }, checks] = await Promise.all([import('../../lib/sql/book-sql.json'), import('../../lib/sql/checks.ts')]);
  const examples = (data.examples as BookExample[]).filter((e) => !ids || ids.includes(e.id));
  const engine = await getEngine();
  await engine.reset();
  const rows: ExampleCheck[] = [];
  let modelsBuilt = false;
  for (const ex of examples) {
    mark(ex.codeId, 'running', 'Running…');
    if (ex.needsModels && !modelsBuilt) {
      const { createModels } = await import('../../lib/py/models.ts');
      await createModels(engine, ex.needsModels);
      modelsBuilt = true;
    }
    const r = await checks.checkExample(engine, ex);
    rows.push(r);
    const primary = rows.filter((x) => x.id === ex.codeId || x.id.startsWith(ex.codeId + '#'));
    const ok = primary.every((x) => x.match);
    mark(ex.codeId, ok ? 'ok' : 'bad', ok ? 'Matches the book' : 'Differs from the book');
    onStep?.(rows.length, examples.length);
  }
  await engine.reset();
  notifyDataChange('reset');
  return {
    info: { ...engine.info },
    userAgent: navigator.userAgent,
    rows,
    passed: rows.filter((r) => r.match).length,
    total: rows.length,
    totalMs: Math.round(performance.now() - t0),
  };
}

export default function SqlExamplesRunner({ total }: { total: number }) {
  const [state, setState] = useState<{ phase: 'idle' | 'running' | 'done' | 'error'; done: number; report?: ParityReport; error?: string }>({ phase: 'idle', done: 0 });

  useEffect(() => {
    window.__mcSqlParity = (opts) => runAll(undefined, opts?.ids);
    window.__mcSqlDay2 = async () => {
      const [engine, checks] = await Promise.all([getEngine(), import('../../lib/sql/checks.ts')]);
      const r = await checks.checkDay2(engine);
      notifyDataChange('reset');
      return r;
    };
    document.documentElement.dataset.sqlRunner = 'ready';
  }, []);

  async function go() {
    setState({ phase: 'running', done: 0 });
    try {
      const report = await runAll((done) => setState((s) => ({ ...s, done })));
      setState({ phase: 'done', done: report.total, report });
    } catch (e) {
      setState({ phase: 'error', done: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const r = state.report;
  return (
    <div className="mcl-runner" data-testid="examples-runner">
      <button type="button" className="btn btn-quiet btn-small" onClick={go} disabled={state.phase === 'running'} data-testid="check-all">
        {state.phase === 'running' ? `Checking… ${state.done} of ${total}` : 'Check every example'}
      </button>
      <span role="status" className="mcl-runner-status">
        {state.phase === 'idle' && `Runs the ${total} checks one after the other on a fresh database (about 10 seconds), then resets the data.`}
        {state.phase === 'done' && r && (
          <span data-testid="check-all-result" data-passed={r.passed} data-total={r.total}>
            {r.passed === r.total ? `All ${r.total} checks match the book.` : `${r.passed} of ${r.total} checks match the book.`}
            {` DuckDB ${String(r.info.duckdbVersion)}, ${(r.totalMs / 1000).toFixed(1)} s.`}
          </span>
        )}
        {state.phase === 'error' && <span className="mcl-bad">The check stopped: {state.error}</span>}
      </span>
    </div>
  );
}
