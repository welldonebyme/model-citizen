/**
 * Jinja playground: render templates with jinja2 in Pyodide (plain, like the book's render.py, or with a
 * dbt-like context: ref, source, config, var, env_var, target, this, is_incremental, log, return, macros,
 * adapter.dispatch, run_query answered by DuckDB-WASM), show the compiled SQL, then run it on the practice data.
 * Exercises from Chapters 5 and 11 and every Jinja example of the book, checked against the book's output.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StreamLanguage } from '@codemirror/language';
import { CodeEditor, type CodeEditorHandle, type EditorDiagnostic } from './CodeEditor';
import { ResultGrid } from './ResultGrid';
import { jinjaSql } from './jinja-mode';
import { getPy, onPyProgress, stageText, type PyProgress } from '../../lib/py/shared-py.ts';
import type { RenderResult } from '../../lib/py/client.ts';
import { compareText, gradeJinja, jinjaRequest, type Graded, type JinjaCase, type TextMatch } from '../../lib/py/grade.ts';
import type { RunResult } from '../../lib/sql/engine.ts';
import exercisesData from '../../lib/py/cases/jinja-exercises.json';
import casesData from '../../lib/py/cases/jinja-cases.json';
import './labs.css';

type Ctx = 'plain' | 'ch05' | 'ch11';
interface Exercise {
  id: string; title: string; task: string; mode: 'plain' | 'dbt'; project?: 'ch05' | 'ch11'; node?: { name: string; resource_type: string; path?: string };
  extra_models?: Record<string, Record<string, unknown>>; template: string; macros?: string; solution: { template: string; macros?: string };
  goal: { book: string; cmp: 'ws' | 'lines' | 'exact' | 'segments' | 'within' }; run?: boolean; hint: string; why: string; source: { codeId?: string; label: string }; derived?: string;
}
const EXERCISES = exercisesData.exercises as Exercise[];
const CASES = casesData.cases as unknown as JinjaCase[];
const SOLVED_KEY = 'mc:labs:jinja:solved';
const MACRO_FILE = 'macros/playground.sql';

const CTX_LABEL: Record<Ctx, string> = {
  plain: 'Plain Jinja (render.py, Chapter 5)',
  ch05: 'dbt: Chapter 5 project (jaffle_practice)',
  ch11: 'dbt: Chapter 11 project (jaffle_dbt)',
};

function loadSolved(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SOLVED_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveSolved(s: Set<string>) {
  try { localStorage.setItem(SOLVED_KEY, JSON.stringify([...s])); } catch { /* private mode */ }
}

/** Are the Chapter 11 models in the browser database? (one build per page; a reset of the data clears it) */
let modelsPromise: Promise<string[]> | null = null;
async function ensureModels(onStep?: (n: string) => void): Promise<string[]> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const [{ getEngine, onDataChange }, { buildModels }] = await Promise.all([import('../../lib/sql/shared-engine.ts'), import('../../lib/py/models.ts')]);
      const engine = await getEngine();
      onDataChange(() => { modelsPromise = null; });
      const built = await buildModels(engine, 'all', (n) => onStep?.(n));
      return built.map((b) => b.name);
    })().catch((e) => { modelsPromise = null; throw e; });
  }
  return modelsPromise;
}

function needsModelsError(r: RenderResult): boolean {
  return r.status === 'error' && r.error?.kind === 'database' && /dbt_adnane/.test(r.pending_sql ?? '');
}
/** Templates that read the warehouse while compiling: the Chapter 11 models must exist first. */
const READS_DB = /run_query|adapter\.|statement\(|load_relation|load_result|get_column_values|\bstar\(|print_row_counts|describe_relation|is_incremental/;

export default function JinjaPlayground() {
  const tplEditor = useRef<CodeEditorHandle | null>(null);
  const macroEditor = useRef<CodeEditorHandle | null>(null);
  const language = useMemo(() => StreamLanguage.define(jinjaSql), []);
  const first = EXERCISES[0];
  const [exercise, setExercise] = useState<Exercise | null>(first);
  const [bookCase, setBookCase] = useState<JinjaCase | null>(null);
  const [ctx, setCtx] = useState<Ctx>('plain');
  const [target, setTarget] = useState<'dev' | 'prod'>('dev');
  const [tab, setTab] = useState<'template' | 'macros'>('template');
  const [py, setPy] = useState<PyProgress>({ phase: 'idle' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [out, setOut] = useState<RenderResult | null>(null);
  const [match, setMatch] = useState<{ passed: boolean; m: TextMatch } | null>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [sqlRes, setSqlRes] = useState<RunResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [showBook, setShowBook] = useState(false);
  const [solved, setSolved] = useState<Set<string>>(() => new Set());
  const [fatal, setFatal] = useState<string | null>(null);
  const state = useRef({ exercise, bookCase, ctx, target });
  state.current = { exercise, bookCase, ctx, target };

  useEffect(() => {
    setSolved(loadSolved());
    const off = onPyProgress(setPy);
    getPy().catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
    (window as unknown as Record<string, unknown>).__mcJinja = { cases: CASES, exercises: EXERCISES, grade: gradeJinja, request: jinjaRequest, ensureModels };
    return off;
  }, []);

  const render = useCallback(async () => {
    const { exercise: ex, bookCase: bc, ctx: c, target: tg } = state.current;
    const template = tplEditor.current?.getValue() ?? '';
    const macros = macroEditor.current?.getValue() ?? '';
    setBusy(true);
    setNotice(null);
    setSqlRes(null);
    try {
      const client = await getPy();
      const req = bc ? { ...jinjaRequest(bc), template } : {
        mode: c === 'plain' ? 'plain' as const : 'dbt' as const,
        template, project: (c === 'plain' ? 'ch11' : c) as 'ch05' | 'ch11', target: c === 'ch11' ? tg : undefined,
        node: ex?.node, extra_models: ex?.extra_models,
        extra_macro_files: c !== 'plain' && macros.trim() ? { [MACRO_FILE]: macros } : undefined,
      };
      if (bc && macros.trim() && bc.extra_macro_files) req.extra_macro_files = { [Object.keys(bc.extra_macro_files)[0]]: macros };
      if (req.mode === 'dbt' && req.project === 'ch11' && (bc?.db || READS_DB.test(template + macros))) {
        await ensureModels((n) => setNotice(`Creating the Chapter 11 models in the browser database: ${n}…`));
        setNotice(null);
      }
      let r = await client.render(req, { timeoutMs: 15_000 });
      if (needsModelsError(r)) {
        setNotice('This template reads models of the project: creating the Chapter 11 models in the browser database…');
        await ensureModels((n) => setNotice(`Creating the Chapter 11 models in the browser database: ${n}…`));
        r = await client.render(req, { timeoutMs: 15_000 });
        setNotice('The Chapter 11 models now exist in practice.dbt_adnane (compiled here, created in DuckDB).');
      }
      setOut(r);
      if (ex) {
        const mode = ex.goal.cmp === 'within' ? 'within' : ex.goal.cmp === 'segments' ? 'segments' : 'equal';
        const m = compareText(ex.goal.book, r.status === 'ok' ? r.compiled : null, mode);
        const passed = ex.goal.cmp === 'exact' ? m.exact : ex.goal.cmp === 'lines' ? m.lines : m.ws;
        setMatch({ passed, m });
        if (passed) setSolved((s) => { const n = new Set(s); n.add(ex.id); saveSolved(n); return n; });
      } else setMatch(null);
      setGraded(bc ? gradeJinja(bc, r) : null);
      setFatal(null);
    } catch (e) {
      setOut(null);
      setFatal(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  async function runSql() {
    if (!out?.compiled) return;
    setBusy(true);
    setNotice(null);
    try {
      const { getEngine } = await import('../../lib/sql/shared-engine.ts');
      setNotice('Starting the SQL engine (DuckDB, about 8 MB once)…');
      const engine = await getEngine();
      if (/"dbt_adnane"/.test(out.compiled)) {
        await ensureModels((n) => setNotice(`Creating the Chapter 11 models in the browser database: ${n}…`));
      }
      setNotice(null);
      setSqlRes(await engine.run(out.compiled));
    } catch (e) {
      setNotice(`The SQL could not run: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function open(ex: Exercise | null, bc: JinjaCase | null) {
    setExercise(ex);
    setBookCase(bc);
    const c: Ctx = ex ? (ex.mode === 'plain' ? 'plain' : ex.project ?? 'ch11') : bc ? (bc.mode === 'plain' ? 'plain' : bc.project ?? 'ch11') : 'plain';
    setCtx(c);
    setTarget((bc?.target as 'dev' | 'prod' | undefined) ?? 'dev');
    tplEditor.current?.setValue(ex?.template ?? bc?.template ?? '');
    macroEditor.current?.setValue(ex?.macros ?? (bc?.extra_macro_files ? Object.values(bc.extra_macro_files)[0] : ''));
    setTab('template');
    setOut(null);
    setMatch(null);
    setGraded(null);
    setSqlRes(null);
    setShowHint(false);
    setShowSolution(false);
    setShowBook(false);
    setNotice(null);
    document.getElementById('jinja-tool')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  const err = out?.status === 'error' || out?.status === 'timeout' ? out.error : null;
  const diagnostics: EditorDiagnostic[] = err?.lineno ? [{ line: err.lineno, message: err.message, severity: 'error' }] : [];
  const logs = (out?.logs ?? []).filter((l) => l.info);
  const macrosCount = ctx === 'plain' ? 0 : 1;
  const goalBook = exercise?.goal.book ?? graded?.book ?? null;

  return (
    <div className="mcl-split jinjap">
      <div className="mcl-pane mcl-pane-pad mcl-list-pane">
        <h2 className="mcl-pane-h">Exercises</h2>
        <p className="mcl-note">{solved.size} of {EXERCISES.length} solved. Compile (Ctrl + Enter) to check.</p>
        <ul className="mcl-ex-list">
          {EXERCISES.map((e) => (
            <li key={e.id}>
              <button type="button" aria-current={exercise?.id === e.id} onClick={() => open(e, null)} data-exercise={e.id}>
                <span className="mcl-ex-state" data-state={solved.has(e.id) ? 'solved' : undefined} aria-label={solved.has(e.id) ? 'solved' : 'not solved yet'}>{solved.has(e.id) ? '✓' : ''}</span>
                <span className="t">{e.title}</span>
                <span className="s">{e.source.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <details className="mcl-book-cases">
          <summary><h3 className="mcl-group-h">Every Jinja example of the book ({CASES.length})</h3></summary>
          <p className="mcl-note">Load an example, compile it and compare with the book.</p>
          <ul className="mcl-ex-list">
            {CASES.map((c) => (
              <li key={c.id}>
                <button type="button" aria-current={bookCase?.id === c.id} onClick={() => open(null, c)} data-case={c.id}>
                  <span className="mcl-ex-state" />
                  <span className="t">{c.title}</span>
                  <span className="s">{c.mode === 'plain' ? 'plain Jinja' : `dbt, ${c.project === 'ch05' ? 'Chapter 5' : 'Chapter 11'} project`}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <section className="mcl mcl-pane" id="jinja-tool" aria-labelledby="jinja-tool-h" data-testid="jinja-tool">
        <header className="mcl-head">
          <h2 id="jinja-tool-h">{exercise ? exercise.title : bookCase ? bookCase.title : 'Your template'}</h2>
          <p>jinja2 3.1.6 in your browser. In dbt mode the context imitates dbt-core 1.11 (it is not dbt): ref, source, config, var, target, this, macros, run_query.</p>
        </header>

        {exercise && (
          <div className="mcl-task" data-testid="exercise-task">
            <p>{exercise.task}</p>
            {exercise.derived && <p className="mcl-note">Start: {exercise.derived}.</p>}
            <p className="mcl-row" style={{ marginTop: 8 }}>
              <button type="button" className="mcl-btn mcl-btn-small" aria-expanded={showHint} onClick={() => setShowHint((v) => !v)}>Hint</button>
              <button type="button" className="mcl-btn mcl-btn-small" aria-expanded={showSolution} onClick={() => setShowSolution((v) => !v)}>Show a solution</button>
              <button type="button" className="mcl-btn mcl-btn-small" onClick={() => open(exercise, null)}>Start again</button>
            </p>
            {showHint && <p className="mcl-note" data-testid="hint">{exercise.hint}</p>}
            {showSolution && <pre className="mcl-solution" data-testid="solution">{exercise.solution.macros ? `-- ${MACRO_FILE}\n${exercise.solution.macros}\n-- template\n` : ''}{exercise.solution.template}</pre>}
          </div>
        )}

        <div className="mcl-row" style={{ margin: '14px var(--mcl-pad) 0' }}>
          <label className="mcl-field">Context
            <select className="mcl-select" value={ctx} onChange={(e) => { setCtx(e.target.value as Ctx); setBookCase(null); }} data-testid="jinja-context" disabled={!!bookCase}>
              {(Object.keys(CTX_LABEL) as Ctx[]).map((k) => <option key={k} value={k}>{CTX_LABEL[k]}</option>)}
            </select>
          </label>
          {ctx === 'ch11' && (
            <label className="mcl-field">Target
              <select className="mcl-select" value={target} onChange={(e) => setTarget(e.target.value as 'dev' | 'prod')} disabled={!!bookCase}>
                <option value="dev">dev (schema dbt_adnane)</option>
                <option value="prod">prod</option>
              </select>
            </label>
          )}
        </div>
        {(exercise?.node ?? bookCase?.node)?.resource_type === 'model' && <p className="mcl-note" style={{ margin: '6px var(--mcl-pad) 0' }}>Compiled as the model {(exercise?.node ?? bookCase?.node)!.name} ({(exercise?.node ?? bookCase?.node)!.path}).</p>}

        <div className="mcl-editor">
          <div className="mcl-bar">
            {macrosCount > 0 ? (
              <div className="seg" role="tablist" aria-label="Files">
                <button type="button" role="tab" aria-selected={tab === 'template'} aria-pressed={tab === 'template'} onClick={() => setTab('template')} data-testid="tab-template">{(exercise?.node ?? bookCase?.node)?.resource_type === 'model' ? 'model.sql' : 'template'}</button>
                <button type="button" role="tab" aria-selected={tab === 'macros'} aria-pressed={tab === 'macros'} onClick={() => setTab('macros')} data-testid="tab-macros">{MACRO_FILE}</button>
              </div>
            ) : <span className="mcl-file">template.sql</span>}
            <span className="mcl-sp" />
            <button type="button" className="mcl-run" onClick={() => void render()} disabled={busy || py.phase === 'error'} data-testid="compile" aria-keyshortcuts="Control+Enter Meta+Enter">{busy ? 'Working…' : ctx === 'plain' ? 'Render' : 'Compile'}</button>
          </div>
          <div hidden={tab !== 'template'}>
            <CodeEditor lang="jinja" language={language} initial={first.template} ariaLabel="Jinja template editor. Control Enter compiles." onRun={() => void render()} handle={tplEditor} diagnostics={diagnostics} testId="jinja-editor" minLines={9} />
          </div>
          <div hidden={tab !== 'macros'}>
            <CodeEditor lang="jinja" language={language} initial={first.macros ?? ''} ariaLabel="Macros file editor. Control Enter compiles." onRun={() => void render()} handle={macroEditor} testId="macros-editor" minLines={9}
              placeholder="{% macro my_macro(x) %} ... {% endmacro %}" />
          </div>
        </div>

        {py.phase !== 'ready' && !fatal && (
          <div className="mcl-status" role="status" data-testid="py-status" data-phase={py.phase}>
            <div className="mcl-progress"><span>{py.message ?? stageText(py.stage)} {py.stage ? '' : '(about 6 MB, once)'}</span><progress aria-label="Python engine loading" /></div>
          </div>
        )}
        {fatal && <p className="mcl-notice bad" role="alert">The Python engine could not run: {fatal}</p>}
        {notice && <p className="mcl-notice" role="status" data-testid="notice">{notice}</p>}

        <div aria-live="polite">
          {out?.status === 'ok' && (
            <div className="mcl-out" data-testid="compiled">
              <div className="mcl-out-head"><span>{ctx === 'plain' ? 'Rendered text' : 'Compiled SQL'}</span><span className="mcl-sp" />
                {out.python_ms !== undefined && <span>{out.python_ms} ms{out.query_rounds ? `, ${out.query_rounds} quer${out.query_rounds === 1 ? 'y' : 'ies'} to DuckDB` : ''}</span>}
                <button type="button" className="mcl-btn mcl-btn-small" onClick={() => void runSql()} disabled={busy || !out.compiled?.trim()} data-testid="run-compiled">Run the compiled SQL</button>
              </div>
              <pre data-testid="compiled-text">{out.compiled}</pre>
            </div>
          )}
          {logs.length > 0 && (
            <div className="mcl-out" data-testid="logs">
              <div className="mcl-out-head"><span>log() and print() output ({logs.length} line{logs.length > 1 ? 's' : ''})</span></div>
              <pre>{logs.map((l) => `${l.phase === 'parse' ? '[parse] ' : ''}${l.msg}`).join('\n')}</pre>
            </div>
          )}
          {err && (
            <div className="mcl-msg bad" data-testid="jinja-error">
              <p><strong>{out?.status === 'timeout' ? 'Stopped:' : `${err.phase === 'parse' ? 'Error while parsing' : 'Compilation error'}${err.lineno ? ` (line ${err.lineno})` : ''}:`}</strong> {err.message.split('\n')[0]}</p>
              {out?.status === 'timeout' && <p>The template ran for more than 3 seconds (an endless loop?). The engine stopped it and is ready again.</p>}
              {err.dbt_message && <pre>{err.dbt_message}</pre>}
            </div>
          )}
          {match && exercise && out && (
            <div className={`mcl-msg ${match.passed ? 'ok' : 'warn'}`} data-testid="exercise-check" data-solved={String(match.passed)}>
              <p><strong>{match.passed ? 'Matches the book' : 'Differs from the book'}</strong>
                {match.passed ? ` (${exercise.goal.cmp === 'exact' ? 'byte for byte' : match.m.exact ? 'byte for byte' : exercise.goal.cmp === 'lines' ? 'same lines, spaces at the ends ignored' : 'spaces and empty lines ignored'}). ${exercise.why}` : `. ${exercise.goal.cmp === 'exact' ? 'Here every space and every new line counts.' : 'Spaces and empty lines do not count.'}`}
              </p>
              {match.passed && match.m.exact && exercise.goal.cmp !== 'exact' && <p><span className="mcl-badge ok">Byte-exact</span></p>}
            </div>
          )}
          {graded && bookCase && (
            <div className={`mcl-msg ${graded.passed ? 'ok' : 'bad'}`} data-testid="case-grade" data-passed={String(graded.passed)}>
              <p><strong>{graded.passed ? 'Same as the book' : 'Different from the book'}</strong>{graded.passed ? (graded.byteExact ? ', byte for byte.' : ' (spaces and empty lines ignored).') : '.'}</p>
              {bookCase.note && <p className="mcl-note">{bookCase.note}.</p>}
            </div>
          )}
          {goalBook && (out || graded) && (
            <div className="mcl-expected-wrap">
              <button type="button" className="mcl-link" aria-expanded={showBook} onClick={() => setShowBook((v) => !v)} data-testid="toggle-book">{showBook ? "Hide the book's output" : "Show the book's output"}</button>
              {showBook && <pre className="mcl-solution" data-testid="book-output">{goalBook}</pre>}
            </div>
          )}
          {sqlRes?.kind === 'table' && (
            <div className="mcl-result">
              {sqlRes.noResultSet ? <p className="mcl-done">Done.</p> : <ResultGrid columns={sqlRes.columns} rows={sqlRes.rows} numeric={sqlRes.numeric} totalRows={sqlRes.totalRows} testId="result-grid" caption="Result of the compiled SQL" />}
              <p className="mcl-meta" data-testid="result-meta">{sqlRes.totalRows} row{sqlRes.totalRows === 1 ? '' : 's'} · {Math.max(1, Math.round(sqlRes.elapsedMs))} ms · DuckDB in your browser</p>
            </div>
          )}
          {sqlRes?.kind === 'error' && <div className="mcl-result"><div className="mcl-error" data-testid="result-error"><pre>{sqlRes.message}</pre></div></div>}
        </div>
        <p className="mcl-foot">Ctrl + Enter (⌘ + Enter on a Mac) compiles. A template that runs more than 3 seconds is stopped. Esc then Tab moves to the next control.</p>
      </section>
    </div>
  );
}
