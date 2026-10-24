/**
 * SQL workspace: a real DuckDB (DuckDB-WASM) with the practice database, in the browser.
 *
 * Mount it once per page (lesson right column, SQL playground). It listens for
 *  - clicks on [data-send-to-workspace="<code id>"] buttons (rendered by CodeBlock for book SQL blocks with a
 *    Result): the SQL and the expected Result are read from the page (figure#<code id>, and the Result block);
 *  - window/document CustomEvent 'mc:workspace-run' with detail { codeId?, sql?, expectedText?, run? }.
 * It runs the query, shows the result grid and says whether it matches the book, in plain English.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sql as sqlLanguage, PostgreSQL } from '@codemirror/lang-sql';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { ResultGrid } from './ResultGrid';
import { compareResults, hasTopLevelOrderBy, tryParseBookOutput, type CompareReport, type Expected } from '../../lib/sql/compare.ts';
import type { Progress, RunResult } from '../../lib/sql/engine.ts';
import { getEngine, onDataChange, onEngineProgress, notifyDataChange, restartEngine, ENGINE_DOWNLOAD_BYTES, engineStarted } from '../../lib/sql/shared-engine.ts';
import meta from '../../lib/sql/book-sql-meta.json';
import './labs.css';

export interface WorkspaceRunDetail {
  /** book code id (e.g. "ch04-c12"): SQL and Result read from the page */
  codeId?: string;
  /** SQL to load (wins over the page text) */
  sql?: string;
  /** book Result text to compare with */
  expectedText?: string;
  /** run at once (default true) */
  run?: boolean;
  /** short label shown above the editor, e.g. "Lesson 4.4" */
  label?: string;
}

export interface SqlWorkspaceProps {
  /** first query in the editor (free mode) */
  initialSql?: string;
  /** or a book example to load first */
  initialCodeId?: string;
  /** Result text to compare the first query with */
  expectedText?: string;
  heading?: string;
  description?: string;
  /** handle [data-send-to-workspace] clicks and 'mc:workspace-run' events (default true; one workspace per page) */
  listen?: boolean;
  /** start the engine when the workspace is mounted (default true, except with Data Saver on) */
  autostart?: boolean;
  /** element id (default "workspace") */
  id?: string;
}

type ExampleMeta = {
  lesson: string; kind: string; ordered: boolean; expectedId?: string; expectedRaw?: string; sql?: string; setup?: string;
  columnSubset?: boolean; rowPrefix?: boolean; expectRowCount?: number; needsModels?: string[]; annotation?: string;
};
const EXAMPLES = meta.examples as Record<string, ExampleMeta>;
const SKIPPED = meta.skipped as Record<string, { category: string; reason: string }>;

interface Loaded {
  codeId?: string;
  label?: string;
  restoreSql: string;
  expected: Expected | null;
  expectedRaw?: string;
  expectRowCount?: number;
  columnSubset?: boolean;
  rowPrefix?: boolean;
  annotation?: string;
  skipReason?: string;
  needsModels?: string[];
}

const DEFAULT_SQL = 'select id, first_name, email\nfrom jaffle_shop.customers\nwhere email is null;';
const mb = (n: number) => `${(n / 1e6).toFixed(n > 10e6 ? 0 : 1)} MB`;
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let listenerTaken = false;

/** The text of a code block of the page (the book's text, without highlighting). */
function pageCodeText(id: string): string | null {
  const fig = document.getElementById(id);
  if (!fig) return null;
  const pre = fig.querySelector('pre[data-copy-text]');
  return pre?.getAttribute('data-copy-text') ?? fig.querySelector('pre')?.textContent ?? null;
}

/** The Result block that belongs to a SQL block: from the index, else the next "Result" figure on the page. */
function pageExpectedText(codeId: string, expectedId?: string): string | null {
  if (expectedId) {
    const t = pageCodeText(expectedId);
    if (t !== null) return t;
  }
  const fig = document.getElementById(codeId);
  let el: Element | null = fig?.nextElementSibling ?? null;
  for (let hops = 0; el && hops < 3; hops++, el = el.nextElementSibling) {
    if (el.matches('figure[data-code]')) {
      return el.getAttribute('data-lang') === 'output' ? pageCodeText(el.id) : null;
    }
  }
  return null;
}

function loadFor(detail: WorkspaceRunDetail): Loaded {
  const id = detail.codeId;
  const m = id ? EXAMPLES[id] : undefined;
  const bookText = id ? pageCodeText(id) : null;
  const sql = detail.sql ?? m?.sql ?? bookText ?? '';
  const expectedRaw = detail.expectedText ?? m?.expectedRaw ?? (id ? pageExpectedText(id, m?.expectedId) ?? undefined : undefined);
  return {
    codeId: id,
    label: detail.label ?? (m ? `From lesson ${m.lesson}` : id ? 'From the lesson' : undefined),
    restoreSql: sql,
    expectedRaw,
    expected: m?.expectRowCount === undefined && expectedRaw ? tryParseBookOutput(expectedRaw) : null,
    expectRowCount: m?.expectRowCount,
    columnSubset: m?.columnSubset,
    rowPrefix: m?.rowPrefix,
    annotation: m?.annotation,
    skipReason: id ? SKIPPED[id]?.reason : undefined,
    needsModels: m?.needsModels,
  };
}

function progressText(p: Progress): string {
  switch (p.phase) {
    case 'code': return 'Starting the SQL engine…';
    case 'worker': return 'Starting the SQL engine…';
    case 'download': return `Downloading the SQL engine: ${Math.round(100 * (p.fraction ?? 0))}% of about ${mb(ENGINE_DOWNLOAD_BYTES)}`;
    case 'open': return 'Starting DuckDB…';
    case 'data': return 'Loading the practice data…';
    case 'setup': return 'Creating the practice database (setup.sql)…';
    case 'ready': return 'Ready';
    case 'error': return `The SQL engine could not start. ${p.message ?? ''}`;
  }
}

function errorHint(message: string): string | null {
  if (/Table with name \w+ does not exist|Catalog Error: Table/i.test(message)) {
    return 'Check the table name and its schema: jaffle_shop.customers, jaffle_shop.orders, jaffle_shop.order_items, jaffle_shop.products, stripe.payments.';
  }
  if (/already exists/i.test(message)) return 'You created this object before. Reset data removes everything you created.';
  if (/Referenced column .* not found|column .* not found/i.test(message)) return 'A column name is wrong. Open "Tables in the practice database" below to see the columns.';
  if (/syntax error at end of input/i.test(message)) return 'The query is not finished: a word, a bracket or a quote is missing.';
  return null;
}

export default function SqlWorkspace(props: SqlWorkspaceProps) {
  const { heading = 'Workspace', description = 'Practice database jaffle_shop and stripe, running in your browser.', listen = true, id = 'workspace' } = props;
  // the same on the server and at hydration (the page DOM is read after mounting, see initialCodeId below)
  const initial = useMemo<Loaded>(() => {
    const sql = props.initialSql ?? DEFAULT_SQL;
    return { restoreSql: sql, expectedRaw: props.expectedText, expected: props.expectedText ? tryParseBookOutput(props.expectedText) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const language = useMemo(() => sqlLanguage({ dialect: PostgreSQL, upperCaseKeywords: false }), []);
  const editor = useRef<CodeEditorHandle | null>(null);
  const root = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [loaded, setLoaded] = useState<Loaded>(initial);
  const [progress, setProgress] = useState<Progress>({ phase: 'code' });
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [report, setReport] = useState<CompareReport | null>(null);
  const [showExpected, setShowExpected] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone?: 'ok' | 'bad' } | null>(null);
  const [dataState, setDataState] = useState({ day2: false, freshLoads: 0 });
  const [modelsReady, setModelsReady] = useState<string | null>(null);
  const runSeq = useRef(0);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const start = useCallback(() => {
    setStarted(true);
    getEngine().then((e) => { setReady(true); setDataState({ ...e.state }); }).catch(() => setReady(false));
  }, []);

  useEffect(() => {
    const off = onEngineProgress((p) => { setProgress(p); if (p.phase === 'ready') setReady(true); });
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (engineStarted() || (props.autostart ?? true) && !saveData) start();
    const offData = onDataChange(async (why) => {
      const e = await getEngine();
      setDataState({ ...e.state });
      if (why === 'restart') setModelsReady(null);
    });
    return () => { off(); offData(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async () => {
    const sql = editor.current?.getValue() ?? loadedRef.current.restoreSql;
    if (!sql.trim()) { setNotice({ text: 'Type a query first.' }); return; }
    const seq = ++runSeq.current;
    const L = loadedRef.current;
    setBusy(true);
    setSlow(false);
    setNotice(null);
    if (!engineStarted()) start();
    const slowTimer = setTimeout(() => { if (runSeq.current === seq) setSlow(true); }, 1500);
    try {
      const engine = await getEngine();
      if (L.needsModels && modelsReady !== L.needsModels.join(',')) {
        setNotice({ text: `This query reads the dbt model ${L.needsModels.join(', ')}. Create it first with the button below.` });
      }
      const res = await engine.run(sql);
      if (runSeq.current !== seq) return; // stopped, or another run started
      setResult(res);
      setDataState({ ...engine.state });
      if (L.expectRowCount !== undefined) {
        const n = res.kind === 'table' ? res.totalRows : -1;
        const ok = n === L.expectRowCount;
        setReport({
          match: ok, more: 0,
          summary: ok ? `${n} rows, like the ${L.expectRowCount} failures in the book's dbt log.` : res.kind === 'error' ? 'Your query stopped with an error.' : `The book's dbt log says ${L.expectRowCount} rows fail. Your query returns ${n} rows.`,
          diffs: [],
        });
      } else if (L.expected) {
        setReport(compareResults(L.expected, res.kind === 'table' ? { kind: 'table', columns: res.columns, rows: res.rows } : res, {
          ordered: hasTopLevelOrderBy(sql), columnSubset: L.columnSubset, rowPrefix: L.rowPrefix, maxDiffs: 8,
        }));
      } else setReport(null);
    } catch (e) {
      if (runSeq.current === seq) setNotice({ text: `The query could not run: ${e instanceof Error ? e.message : String(e)}`, tone: 'bad' });
    } finally {
      clearTimeout(slowTimer);
      if (runSeq.current === seq) { setBusy(false); setSlow(false); }
    }
  }, [start, modelsReady]);
  const runRef = useRef(run);
  runRef.current = run;

  const loadExample = useCallback((detail: WorkspaceRunDetail, quiet = false) => {
    const L = loadFor(detail);
    setLoaded(L);
    loadedRef.current = L;
    editor.current?.setValue(L.restoreSql);
    setResult(null);
    setReport(null);
    setShowExpected(false);
    setNotice(null);
    // bring the workspace into view (on phones it is below the lesson) and move the focus to it
    const el = root.current;
    if (el && !quiet) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      headingRef.current?.focus({ preventScroll: true });
    }
    if (detail.run !== false) void runRef.current();
  }, []);

  useEffect(() => {
    if (props.initialCodeId) loadExample({ codeId: props.initialCodeId, sql: props.initialSql, expectedText: props.expectedText, run: false }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // page-wide API: "Run in workspace" buttons and the mc:workspace-run event
  useEffect(() => {
    if (!listen || listenerTaken) return;
    listenerTaken = true;
    const seen = new WeakSet<Event>();
    const onEvent = (ev: Event) => {
      if (seen.has(ev)) return;
      seen.add(ev);
      const d = (ev as CustomEvent<WorkspaceRunDetail>).detail ?? {};
      loadExample(d);
    };
    const onClick = (ev: MouseEvent) => {
      const btn = (ev.target as Element | null)?.closest?.('[data-send-to-workspace]');
      if (!btn) return;
      ev.preventDefault();
      loadExample({ codeId: btn.getAttribute('data-send-to-workspace') ?? undefined });
    };
    window.addEventListener('mc:workspace-run', onEvent);
    document.addEventListener('mc:workspace-run', onEvent);
    document.addEventListener('click', onClick);
    (window as unknown as Record<string, unknown>).__mcWorkspace = { load: loadExample };
    document.documentElement.dataset.workspace = 'ready';
    return () => {
      listenerTaken = false;
      window.removeEventListener('mc:workspace-run', onEvent);
      document.removeEventListener('mc:workspace-run', onEvent);
      document.removeEventListener('click', onClick);
      delete document.documentElement.dataset.workspace;
    };
  }, [listen, loadExample]);

  async function dataAction(kind: 'day2' | 'fresh' | 'reset') {
    runSeq.current++;
    setBusy(true);
    setNotice(null);
    try {
      const engine = await getEngine();
      if (kind === 'reset') {
        await engine.reset();
        setModelsReady(null);
        setNotice({ text: 'The data is back to day 1 (setup.sql). Tables and views you created are gone.', tone: 'ok' });
      } else if (kind === 'day2') {
        const r = await engine.applyDay2();
        setNotice(r.kind === 'table'
          ? { text: `Day 2 applied (updates/day2.sql): ${r.rows.map((x) => `${x[0]} ${x[1]} rows`).join(', ')}.`, tone: 'ok' }
          : { text: `day2.sql failed: ${r.message}`, tone: 'bad' });
      } else {
        const r = await engine.freshLoad();
        setNotice(r.kind === 'table'
          ? { text: `Fresh load done (updates/fresh_load.sql): 2 orders loaded now. ${r.rows.map((x) => `${x[0]}: ${x[1]} rows, newest ${x[2]}`).join('; ')}.`, tone: 'ok' }
          : { text: `Fresh load needs the time zone extension of DuckDB (ICU), which could not be loaded. Everything else works. Details: ${r.message.split('\n')[0]}`, tone: 'bad' });
      }
      setDataState({ ...engine.state });
      notifyDataChange(kind);
      setResult(null);
      setReport(null);
    } catch (e) {
      setNotice({ text: `This did not work: ${e instanceof Error ? e.message : String(e)}`, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    runSeq.current++;
    setBusy(false);
    setSlow(false);
    setReady(false);
    await restartEngine();
    setReady(true);
    setModelsReady(null);
    setNotice({ text: 'The query was stopped. The SQL engine restarted, and the data is back to day 1.' });
  }

  async function createModels() {
    const names = loadedRef.current.needsModels;
    if (!names) return;
    setBusy(true);
    setNotice({ text: `Compiling ${names.join(', ')} with the Jinja engine (about 6 MB to download once)…` });
    try {
      const engine = await getEngine();
      const { createModels: build } = await import('../../lib/py/models.ts');
      const made = await build(engine, names);
      setModelsReady(names.join(','));
      setNotice({ text: `Created in practice.dbt_adnane: ${made.join(', ')}. Now run the query.`, tone: 'ok' });
    } catch (e) {
      setNotice({ text: `The models could not be created: ${e instanceof Error ? e.message : String(e)}`, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  function restore() {
    editor.current?.setValue(loadedRef.current.restoreSql);
    editor.current?.focus();
  }

  const errs = report?.diffs.filter((d) => d.severity === 'error') ?? [];
  const warns = report?.diffs.filter((d) => d.severity === 'warning') ?? [];
  const hasCheck = loaded.expected !== null || loaded.expectRowCount !== undefined;
  const dataLabel = `Data: day 1${dataState.day2 ? ' + day 2' : ''}${dataState.freshLoads ? ` + ${dataState.freshLoads} fresh load${dataState.freshLoads > 1 ? 's' : ''}` : ''}`;
  const hid = `${id}-h`;

  return (
    <section className="mcl mcw" id={id} ref={root} aria-labelledby={hid} data-testid="sql-workspace">
      <header className="mcl-head">
        <h2 id={hid} ref={headingRef} tabIndex={-1}>{heading}</h2>
        <p>{description}</p>
      </header>

      {(loaded.label || loaded.annotation || loaded.skipReason) && (
        <div className="mcl-task" data-testid="example-info">
          {loaded.label && <p><b>{loaded.label}.</b> {hasCheck ? 'Run the query and compare with the book.' : 'Run the query.'}</p>}
          {loaded.annotation && <p className="mcl-note">{loaded.annotation}</p>}
          {loaded.skipReason && <p className="mcl-note">Not checked here: {loaded.skipReason}. Run it on your computer after the dbt step of the lesson.</p>}
          {loaded.needsModels && (
            <p className="mcl-note">
              This query reads the dbt model {loaded.needsModels.join(', ')}.{' '}
              {modelsReady === loaded.needsModels.join(',')
                ? <span>It exists now.</span>
                : <button type="button" className="mcl-btn mcl-btn-small" onClick={createModels} disabled={busy} data-testid="create-models">Create it in the browser</button>}
            </p>
          )}
        </div>
      )}

      <div className="mcl-editor">
        <div className="mcl-bar">
          <span className="mcl-file">query.sql</span>
          <span className="mcl-sp" />
          {loaded.codeId && <button type="button" className="mcl-btn mcl-btn-small" onClick={restore} data-testid="restore">Restore the book's query</button>}
          {busy && slow
            ? <button type="button" className="mcl-btn mcl-btn-small mcl-btn-stop" onClick={stop} data-testid="stop">Stop</button>
            : <button type="button" className="mcl-run" onClick={() => void run()} disabled={busy || progress.phase === 'error'} data-testid="run" aria-keyshortcuts="Control+Enter Meta+Enter">
                {busy ? 'Running…' : 'Run'}
              </button>}
        </div>
        <CodeEditor lang="sql" language={language} initial={initial.restoreSql}
          ariaLabel="SQL editor. Control Enter runs the query." onRun={() => void run()} handle={editor} testId="sql-editor" minLines={5} />
      </div>

      <div className="mcl-tools" role="group" aria-label="Practice data">
        <span className="mcl-data" data-testid="data-state">{dataLabel}</span>
        <button type="button" className="mcl-btn mcl-btn-small" onClick={() => dataAction('day2')} disabled={busy || !ready} data-testid="apply-day2" title="Run updates/day2.sql: the next loading day (Chapters 13 and 14)">Apply day 2</button>
        <button type="button" className="mcl-btn mcl-btn-small" onClick={() => dataAction('fresh')} disabled={busy || !ready} data-testid="fresh-load" title="Run updates/fresh_load.sql: 2 orders loaded now (Chapter 21)">Fresh load</button>
        <button type="button" className="mcl-btn mcl-btn-small" onClick={() => dataAction('reset')} disabled={busy || !ready} data-testid="reset" title="Load day 1 again (setup.sql)">Reset data</button>
      </div>

      <div className="mcl-status" role="status" data-testid="engine-status" data-phase={ready ? 'ready' : progress.phase}>
        {!started && !ready && (
          <p>The SQL engine downloads about {mb(ENGINE_DOWNLOAD_BYTES)} once. <button type="button" className="mcl-btn mcl-btn-small" onClick={start} data-testid="start-engine">Start the SQL engine</button></p>
        )}
        {started && !ready && progress.phase !== 'error' && (
          <div className="mcl-progress">
            <span>{progressText(progress)}</span>
            <progress max={1} value={progress.phase === 'download' ? progress.fraction ?? 0 : undefined} aria-label="SQL engine loading" />
          </div>
        )}
        {progress.phase === 'error' && !ready && (
          <p className="mcl-bad">{progressText(progress)} <button type="button" className="mcl-btn mcl-btn-small" onClick={start}>Try again</button></p>
        )}
      </div>

      {notice && <p className={`mcl-notice ${notice.tone ?? ''}`} data-testid="notice" role="status">{notice.text}</p>}

      <div className="mcl-result" aria-live="polite">
        {result?.kind === 'table' && (
          <>
            {result.noResultSet
              ? <p className="mcl-done" data-testid="result-done">Done. {result.statements > 1 ? `${result.statements} statements ran.` : 'The statement ran.'}{result.columns[0] === 'Count' && result.rows[0] ? ` ${result.rows[0][0]} rows changed.` : ''}</p>
              : <ResultGrid columns={result.columns} rows={result.rows} numeric={result.numeric} totalRows={result.totalRows} testId="result-grid" caption="Result of your query" />}
            <p className="mcl-meta" data-testid="result-meta">
              {!result.noResultSet && `${result.totalRows} row${result.totalRows === 1 ? '' : 's'} · `}{Math.max(1, Math.round(result.elapsedMs))} ms
              {result.statements > 1 && ` · ${result.statements} statements, the result of the last one is shown`}
            </p>
          </>
        )}
        {result?.kind === 'error' && (
          <div className="mcl-error" data-testid="result-error">
            {result.statements > 1 && <p className="mcl-meta">Statement {result.failedStatement} of {result.statements} failed.</p>}
            <pre>{result.message}</pre>
            {errorHint(result.message) && <p className="mcl-hint">{errorHint(result.message)}</p>}
          </div>
        )}
        {report && result && (
          <div className={`mcl-check ${report.match ? 'ok' : 'bad'}`} data-testid="match-status" data-match={String(report.match)}>
            <p><strong>{report.match ? 'Matches the book:' : 'Differs from the book:'}</strong> {report.summary}</p>
            {errs.length > 0 && <ul>{errs.map((d, i) => <li key={i}>{d.plain}</li>)}{report.more > 0 && <li>And {report.more} more differences.</li>}</ul>}
            {report.match && warns.length > 0 && <p className="mcl-note">{warns.map((d) => d.plain).join(' ')}</p>}
          </div>
        )}
      </div>

      {hasCheck && (
        <div className="mcl-expected-wrap">
          <button type="button" className="mcl-link" aria-expanded={showExpected} onClick={() => setShowExpected((s) => !s)} data-testid="toggle-expected">
            {showExpected ? 'Hide the book\'s result' : 'Show the book\'s result'}
          </button>
          {showExpected && (
            <div className="mcl-expected" data-testid="expected">
              {loaded.expectRowCount !== undefined && <p>The book shows a dbt log: the test fails with {loaded.expectRowCount} rows.</p>}
              {loaded.expected?.kind === 'table' && (
                <>
                  <ResultGrid columns={loaded.expected.columns} rows={loaded.expected.rows} testId="expected-grid" caption="Result printed in the book" />
                  <p className="mcl-meta">
                    {loaded.expected.truncated ? `${loaded.expected.totalRows} rows, ${loaded.expected.rows.length} shown in the book` : loaded.rowPrefix ? `the first ${loaded.expected.rows.length} rows, as printed in the book` : `${loaded.expected.totalRows} row${loaded.expected.totalRows === 1 ? '' : 's'}`}
                    {loaded.expected.notes.length > 0 && ` · ${loaded.expected.notes.join(' ')}`}
                  </p>
                </>
              )}
              {loaded.expected?.kind === 'error' && <pre className="mcl-error-text">{loaded.expected.errorType}: {loaded.expected.message}</pre>}
            </div>
          )}
        </div>
      )}

      <details className="mcl-tables">
        <summary>Tables in the practice database</summary>
        <ul>
          <li><code>jaffle_shop.customers</code>: id, first_name, last_name, email, country, signup_date</li>
          <li><code>jaffle_shop.orders</code>: id, user_id, order_date, status, _loaded_at</li>
          <li><code>jaffle_shop.order_items</code>: id, order_id, product_id, quantity</li>
          <li><code>jaffle_shop.products</code>: id, name, category, price_cents</li>
          <li><code>stripe.payments</code>: id, orderid, paymentmethod, status, amount (cents), created, _loaded_at</li>
        </ul>
      </details>

      <p className="mcl-foot">Ctrl + Enter (⌘ + Enter on a Mac) runs the query. In the editor, Esc then Tab moves to the next control.</p>
    </section>
  );
}
