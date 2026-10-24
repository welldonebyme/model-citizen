import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { compareResults, hasTopLevelOrderBy, parseBookOutput, type CompareReport, type Expected } from '../lib/compare';
import type { Progress, RunResult } from '../lib/engine';
import { getEngine, onEngineProgress } from '../lib/shared-engine';
import './SqlLab.css';

interface Props {
  id: string;
  title?: string;
  initialSql: string;
  expectedRaw?: string;
  /** default: computed from the SQL (top-level ORDER BY) */
  ordered?: boolean;
  columnSubset?: boolean;
  rowPrefix?: boolean;
}

const MAX_SHOWN = 200;

function progressLabel(p: Progress): string {
  switch (p.phase) {
    case 'worker': return p.message ?? 'Starting the SQL engine…';
    case 'download': {
      if (!p.total) return 'Downloading the SQL engine…';
      return `Downloading the SQL engine… ${(p.loaded! / 1e6).toFixed(1)} / ${(p.total / 1e6).toFixed(1)} MB`;
    }
    case 'open': return 'Starting DuckDB…';
    case 'data': return 'Loading the practice data…';
    case 'setup': return 'Running setup.sql…';
    case 'ready': return 'Ready';
    case 'error': return `The SQL engine failed to start: ${p.message}`;
  }
}

function Grid({ columns, rows, testId }: { columns: string[]; rows: (string | null)[][]; testId: string }) {
  return (
    <div className="sqllab-grid-wrap">
      <table className="sqllab-grid" data-testid={testId}>
        <thead><tr>{columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, MAX_SHOWN).map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j} className={v === null ? 'null' : /^-?\d/.test(v) ? 'num' : ''}>{v ?? 'NULL'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SqlLab({ id, title, initialSql, expectedRaw, ordered, columnSubset, rowPrefix }: Props) {
  const editorHost = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'worker' });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [report, setReport] = useState<CompareReport | null>(null);
  const [showExpected, setShowExpected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const expected: Expected | null = useMemo(() => (expectedRaw ? parseBookOutput(expectedRaw) : null), [expectedRaw]);

  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!editorHost.current) return;
    const v = new EditorView({
      parent: editorHost.current,
      state: EditorState.create({
        doc: initialSql,
        extensions: [
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(),
          sql({ dialect: PostgreSQL, upperCaseKeywords: false }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([{ key: 'Mod-Enter', run: () => { runRef.current(); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ 'aria-label': 'SQL editor', 'data-testid': 'sql-editor' }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [initialSql]);

  useEffect(() => {
    const off = onEngineProgress(setProgress);
    getEngine().then(() => setReady(true)).catch(() => setReady(false));
    return off;
  }, []);

  const currentSql = () => view.current?.state.doc.toString() ?? initialSql;

  async function run() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const engine = await getEngine();
      const text = currentSql();
      const res = await engine.run(text);
      setResult(res);
      if (expected) {
        setReport(compareResults(expected, res.kind === 'table' ? { kind: 'table', columns: res.columns, rows: res.rows } : res, {
          ordered: ordered ?? hasTopLevelOrderBy(text), columnSubset, rowPrefix,
        }));
      }
    } finally {
      setBusy(false);
    }
  }
  runRef.current = run;

  async function action(kind: 'reset' | 'day2') {
    setBusy(true);
    try {
      const engine = await getEngine();
      if (kind === 'reset') { await engine.reset(); setNotice('Database reset to day 1 (setup.sql).'); }
      else {
        const r = await engine.run(engine.text('updates/day2.sql'));
        setNotice(r.kind === 'table' ? `day2.sql applied: ${r.rows.map((x) => `${x[0]} = ${x[1]}`).join(', ')}` : `day2.sql failed: ${r.message}`);
      }
    } finally { setBusy(false); }
  }

  function restoreSql() {
    const v = view.current;
    if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: initialSql } });
  }

  const matchErrors = report?.diffs.filter((d) => d.severity === 'error') ?? [];
  const matchWarnings = report?.diffs.filter((d) => d.severity === 'warning') ?? [];

  return (
    <section className="sqllab" aria-label={title ?? 'SQL lab'} data-testid={`lab-${id}`}>
      {title && <h3 className="sqllab-title">{title}</h3>}
      <div className="sqllab-editor" ref={editorHost} />
      <div className="sqllab-toolbar">
        <button type="button" className="primary" onClick={run} disabled={!ready || busy} data-testid="run">
          {busy ? 'Running…' : 'Run'} <kbd>Ctrl/⌘ Enter</kbd>
        </button>
        {expected && <button type="button" onClick={() => setShowExpected((s) => !s)} data-testid="toggle-expected">{showExpected ? 'Hide' : 'Show'} expected</button>}
        <button type="button" onClick={restoreSql}>Restore query</button>
        <button type="button" onClick={() => action('day2')} disabled={!ready || busy} data-testid="apply-day2">Apply day 2</button>
        <button type="button" onClick={() => action('reset')} disabled={!ready || busy} data-testid="reset">Reset data</button>
      </div>
      {!ready && (
        <div className="sqllab-progress" role="status" data-testid="engine-status" data-phase={progress.phase}>
          <span>{progressLabel(progress)}</span>
          {progress.phase === 'download' && progress.total ? (
            <progress max={progress.total} value={progress.loaded} />
          ) : progress.phase !== 'error' ? <progress /> : null}
        </div>
      )}
      {ready && <div className="sqllab-progress ready" role="status" data-testid="engine-status" data-phase="ready">Engine ready</div>}
      {notice && <p className="sqllab-notice" data-testid="notice">{notice}</p>}
      {result && result.kind === 'table' && (
        <div className="sqllab-result">
          {result.columns.length > 0 ? <Grid columns={result.columns} rows={result.rows} testId="result-grid" /> : <p>OK (no result set)</p>}
          <p className="sqllab-meta" data-testid="result-meta">
            {result.totalRows} row{result.totalRows === 1 ? '' : 's'}
            {result.totalRows > MAX_SHOWN ? `, ${MAX_SHOWN} shown` : ''} · {result.elapsedMs.toFixed(0)} ms
            {result.statements > 1 ? ` · ${result.statements} statements, last result shown` : ''}
          </p>
        </div>
      )}
      {result && result.kind === 'error' && (
        <pre className="sqllab-error" data-testid="result-error">{result.message}</pre>
      )}
      {report && (
        <div className={`sqllab-check ${report.match ? 'ok' : 'bad'}`} data-testid="match-status" data-match={String(report.match)}>
          <strong>{report.match ? '✓ Matches the book' : '✗ Differs from the book'}</strong>
          {matchErrors.length > 0 && <ul>{matchErrors.map((d, i) => <li key={i}>{d.detail}</li>)}</ul>}
          {matchWarnings.length > 0 && <ul className="warn">{matchWarnings.map((d, i) => <li key={i}>{d.detail}</li>)}</ul>}
        </div>
      )}
      {showExpected && expected && (
        <div className="sqllab-expected" data-testid="expected">
          <p className="sqllab-meta">Expected (from the book)</p>
          {expected.kind === 'table'
            ? <><Grid columns={expected.columns} rows={expected.rows} testId="expected-grid" />{expected.truncated && <p className="sqllab-meta">({expected.totalRows} rows, {expected.rows.length} shown)</p>}</>
            : <pre className="sqllab-error">{expected.errorType}: {expected.message}</pre>}
        </div>
      )}
    </section>
  );
}
