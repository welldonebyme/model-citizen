/**
 * YAML playground: live validation with PyYAML in Pyodide, messages like dbt parse or like yaml.safe_load,
 * line/column highlighting, "fix the broken file" exercises checked automatically, and the book's examples.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { yaml as yamlLanguage } from '@codemirror/lang-yaml';
import { CodeEditor, type CodeEditorHandle, type EditorDiagnostic } from './CodeEditor';
import { getPy, onPyProgress, stageText, type PyProgress } from '../../lib/py/shared-py.ts';
import type { ValidateResult } from '../../lib/py/client.ts';
import { gradeYaml, yamlRequest, type Graded, type YamlCase } from '../../lib/py/grade.ts';
import exercisesData from '../../lib/py/cases/yaml-exercises.json';
import casesData from '../../lib/py/cases/yaml-cases.json';
import './labs.css';

type Engine = 'dbt' | 'pyyaml';
interface Exercise {
  id: string; group: string; title: string; task: string; engine: Engine; path?: string; filename?: string; project?: string; start: string; solution: string;
  checks: { values?: { expr: string; equals: string; print?: boolean; label: string }[]; noWarnings?: boolean; sameDataAsSolution?: boolean };
  hint: string; why: string; source: { codeId?: string; label: string }; derived?: string;
}
type VResult = ValidateResult & { values?: { expr: string; text?: string; error?: string }[] };

const EXERCISES = exercisesData.exercises as Exercise[];
const CASES = casesData.cases as unknown as YamlCase[];
const GROUPS: [string, string][] = [['fix', 'Fix the broken file'], ['jinja', 'Quote the Jinja'], ['indent', 'Indentation traps'], ['values', 'Values that YAML changes']];
const SOLVED_KEY = 'mc:labs:yaml:solved';
const PYODIDE_MB = '6';

/** What a learner should do about the most common PyYAML / libyaml problems. */
function explain(problem: string | null | undefined, context: string | null | undefined): string | null {
  const p = `${context ?? ''} ${problem ?? ''}`;
  if (/mapping values are not allowed/.test(p)) return 'A colon followed by a space (": ") appears where YAML does not expect a new key: inside a value (quote the value) or after a key without a space ("name:x").';
  if (/found a tab character/.test(p)) return 'A TAB character is used for indentation. YAML accepts only spaces.';
  if (/found unhashable key|while parsing a flow mapping|did not find expected ',' or '\}'/.test(p)) return 'A value starts with { : YAML reads it as an inline mapping. Put Jinja such as {{ target.schema }} in quotes.';
  if (/did not find expected '-' indicator|expected <block end>/.test(p)) return 'The indentation is wrong: a line is not in the same column as the other keys of its block, or a list item is out of line.';
  if (/did not find expected key/.test(p)) return 'A line is indented more or less than the keys around it.';
  if (/could not find expected ':'/.test(p)) return 'A key has no colon, or a quote is not closed.';
  if (/found character '\\t'|found character that cannot start/.test(p)) return 'This character cannot start a value here. Quote the value.';
  if (/expected indentation/.test(p)) return 'A block scalar (| or >) needs its text on the next lines, indented.';
  return null;
}

function loadSolved(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SOLVED_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveSolved(s: Set<string>) {
  try { localStorage.setItem(SOLVED_KEY, JSON.stringify([...s])); } catch { /* private mode */ }
}

interface CheckLine { label: string; ok: boolean; detail?: string }

export default function YamlPlayground() {
  const editor = useRef<CodeEditorHandle | null>(null);
  const language = useMemo(() => yamlLanguage(), []);
  const first = EXERCISES[0];
  const [exercise, setExercise] = useState<Exercise | null>(first);
  const [bookCase, setBookCase] = useState<YamlCase | null>(null);
  const [engine, setEngine] = useState<Engine>(first.engine);
  const [filePath, setFilePath] = useState(first.path ?? 'models/schema.yml');
  const [text, setText] = useState(first.start);
  const [py, setPy] = useState<PyProgress>({ phase: 'idle' });
  const [res, setRes] = useState<VResult | null>(null);
  const [checks, setChecks] = useState<CheckLine[] | null>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [solved, setSolved] = useState<Set<string>>(() => new Set());
  const [fatal, setFatal] = useState<string | null>(null);
  /** bumped by open(): "Start again" on the same text must validate again */
  const [nonce, setNonce] = useState(0);
  const solutionData = useRef(new Map<string, string>());
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSolved(loadSolved());
    const off = onPyProgress(setPy);
    getPy().catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
    (window as unknown as Record<string, unknown>).__mcYaml = { cases: CASES, exercises: EXERCISES, grade: gradeYaml, request: yamlRequest };
    return off;
  }, []);

  const validate = useCallback(async (t: string, eng: Engine, p: string, ex: Exercise | null, bc: YamlCase | null) => {
    const my = ++seq.current;
    let client;
    try { client = await getPy(); } catch { return; }
    const project = ex?.project ?? bc?.project ?? 'my_project';
    const exprs = ex?.checks.values?.map((v) => ({ expr: v.expr, print: !!v.print })) ?? (bc?.expect.kind === 'value' ? [{ expr: bc.expect.expr!, print: !!bc.expect.print }] : undefined);
    const req = {
      text: t, engine: eng,
      ...(eng === 'dbt' ? { path: p.startsWith('models/') ? p : `models/${p}` } : { filename: ex?.filename ?? bc?.filename ?? 'broken.yml' }),
      project: project === 'jaffle_practice' ? 'ch05' : 'ch11', project_name: project,
      ...(exprs ? { exprs } : {}),
    };
    try {
      const r = await client.validate<VResult>(req as never, { timeoutMs: 8000 });
      if (my !== seq.current) return;
      setRes(r);
      setFatal(null);
      // exercise checks
      if (ex) {
        const lines: CheckLine[] = [];
        lines.push({ label: 'The file is valid YAML' + (eng === 'dbt' ? ' and dbt accepts it' : ''), ok: r.ok, detail: r.ok ? undefined : r.error?.problem ?? r.error?.message.split('\n')[0] });
        if (r.ok && ex.checks.noWarnings) lines.push({ label: 'No warning from dbt', ok: !(r.warnings?.length) });
        if (r.ok) {
          (ex.checks.values ?? []).forEach((v, i) => {
            const got = r.values?.[i];
            const ok = !!got && !got.error && (got.text ?? '').replace(/\s+/g, ' ') === v.equals.replace(/\s+/g, ' ');
            lines.push({ label: `Python reads ${v.label} as ${v.equals}`, ok, detail: ok ? undefined : got?.error ?? `now: ${got?.text ?? '(nothing)'}` });
          });
          if (ex.checks.sameDataAsSolution) {
            let want = solutionData.current.get(ex.id);
            if (want === undefined) {
              const s = await client.validate<VResult>({ ...req, text: ex.solution, exprs: undefined } as never);
              want = s.repr ?? '';
              solutionData.current.set(ex.id, want);
            }
            if (my !== seq.current) return;
            lines.push({ label: 'Same content as the original file of the project', ok: r.repr === want, detail: r.repr === want ? undefined : 'a value or a key is still different' });
          }
        }
        setChecks(lines);
        if (lines.every((l) => l.ok)) {
          setSolved((s) => { const n = new Set(s); n.add(ex.id); saveSolved(n); return n; });
        }
      } else setChecks(null);
      setGraded(bc ? gradeYaml(bc, r) : null);
    } catch (e) {
      if (my !== seq.current) return;
      setRes(null);
      setFatal(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // live validation (debounced)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void validate(text, engine, filePath, exercise, bookCase); }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [text, engine, filePath, exercise, bookCase, validate, py.phase, nonce]);

  function open(ex: Exercise | null, bc: YamlCase | null) {
    const t = ex?.start ?? bc?.text ?? '';
    setExercise(ex);
    setBookCase(bc);
    setEngine(ex?.engine ?? bc?.engine ?? 'dbt');
    const p = ex?.path ?? bc?.path ?? 'models/schema.yml';
    setFilePath(p.startsWith('models/') ? p : `models/${p}`);
    setText(t);
    editor.current?.setValue(t);
    setShowHint(false);
    setShowSolution(false);
    setChecks(null);
    setGraded(null);
    setRes(null);
    setNonce((n) => n + 1);
    const tool = document.getElementById('yaml-tool');
    const top = tool?.getBoundingClientRect().top ?? 0;
    if (tool && (top < 0 || top > window.innerHeight * 0.6)) tool.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    editor.current?.focus();
  }

  const err = res && !res.ok ? res.error : undefined;
  const offset = err?.line_offset ?? 0;
  const diagnostics: EditorDiagnostic[] = useMemo(() => {
    const d: EditorDiagnostic[] = [];
    if (err?.problem_mark) d.push({ line: err.problem_mark.line + (engine === 'dbt' ? offset : 0), column: err.problem_mark.column, message: err.problem ?? err.message, severity: 'error' });
    if (err?.context_mark && err.context_mark.line !== err.problem_mark?.line) d.push({ line: err.context_mark.line + (engine === 'dbt' ? offset : 0), column: err.context_mark.column, message: err.context ?? '', severity: 'warning' });
    for (const w of res?.warnings ?? []) d.push({ line: w.line, column: w.column, message: w.message, severity: 'warning' });
    return d;
  }, [err, res, engine, offset]);

  const allOk = checks?.every((c) => c.ok);
  const fullMessage = err ? (engine === 'dbt' ? err.dbt_message ?? err.message : err.traceback_tail ?? err.message) : null;
  const where = err?.problem_mark ? `Line ${err.problem_mark.line + (engine === 'dbt' ? offset : 0)}, column ${err.problem_mark.column}` : null;
  const tip = err ? explain(err.problem, err.context) : null;

  return (
    <div className="mcl-split yamlp">
      <div className="mcl-pane mcl-pane-pad mcl-list-pane" id="yaml-exercises">
        <h2 className="mcl-pane-h">Exercises</h2>
        <p className="mcl-note">{solved.size} of {EXERCISES.length} solved. Each check runs while you type.</p>
        {GROUPS.map(([g, label]) => (
          <div key={g}>
            <h3 className="mcl-group-h">{label}</h3>
            <ul className="mcl-ex-list">
              {EXERCISES.filter((e) => e.group === g).map((e) => (
                <li key={e.id}>
                  <button type="button" aria-current={exercise?.id === e.id} onClick={() => open(e, null)} data-exercise={e.id}>
                    <span className="mcl-ex-state" data-state={solved.has(e.id) ? 'solved' : undefined} aria-label={solved.has(e.id) ? 'solved' : 'not solved yet'}>{solved.has(e.id) ? '✓' : ''}</span>
                    <span className="t">{e.title}</span>
                    <span className="s">{e.source.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <details className="mcl-book-cases">
          <summary><h3 className="mcl-group-h">Every YAML example of the book ({CASES.length})</h3></summary>
          <p className="mcl-note">Load an example and compare the message with the book.</p>
          <ul className="mcl-ex-list">
            {CASES.map((c) => (
              <li key={c.id}>
                <button type="button" aria-current={bookCase?.id === c.id} onClick={() => open(null, c)} data-case={c.id}>
                  <span className="mcl-ex-state" />
                  <span className="t">{c.title}</span>
                  <span className="s">{c.engine === 'dbt' ? 'dbt parse' : 'yaml.safe_load'}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <section className="mcl mcl-pane" id="yaml-tool" aria-labelledby="yaml-tool-h" data-testid="yaml-tool">
        <header className="mcl-head">
          <h2 id="yaml-tool-h">{exercise ? exercise.title : bookCase ? bookCase.title : 'Your YAML'}</h2>
          <p>PyYAML {py.phase === 'ready' ? '6.0.3 ' : ''}runs in your browser, with the words of {engine === 'dbt' ? 'dbt parse (dbt-core 1.11)' : "Python's yaml.safe_load"}.</p>
        </header>

        {exercise && (
          <div className="mcl-task" data-testid="exercise-task">
            <p>{exercise.task}</p>
            {exercise.derived && <p className="mcl-note">Start file: {exercise.derived}.</p>}
            <p className="mcl-row" style={{ marginTop: 8 }}>
              <button type="button" className="mcl-btn mcl-btn-small" aria-expanded={showHint} onClick={() => setShowHint((v) => !v)}>Hint</button>
              <button type="button" className="mcl-btn mcl-btn-small" aria-expanded={showSolution} onClick={() => setShowSolution((v) => !v)}>Show a solution</button>
              <button type="button" className="mcl-btn mcl-btn-small" onClick={() => open(exercise, null)}>Start again</button>
              <a className="mcl-btn mcl-btn-small mcl-jump" href="#yaml-exercises">All exercises</a>
            </p>
            {showHint && <p className="mcl-note" data-testid="hint">{exercise.hint}</p>}
            {showSolution && <pre className="mcl-solution" data-testid="solution">{exercise.solution}</pre>}
          </div>
        )}

        <div className="mcl-row mcl-mode" style={{ margin: '14px var(--mcl-pad) 0' }}>
          <div className="seg" role="group" aria-label="Messages like">
            <button type="button" aria-pressed={engine === 'dbt'} onClick={() => setEngine('dbt')} data-testid="mode-dbt">dbt parse</button>
            <button type="button" aria-pressed={engine === 'pyyaml'} onClick={() => setEngine('pyyaml')} data-testid="mode-pyyaml">yaml.safe_load</button>
          </div>
          {engine === 'dbt' && (
            <label className="mcl-field">File
              <input className="mcl-select mcl-path" value={filePath} onChange={(e) => setFilePath(e.target.value)} spellCheck={false} aria-label="File path in the project" />
            </label>
          )}
        </div>

        <div className="mcl-editor">
          <div className="mcl-bar"><span className="mcl-file">{engine === 'dbt' ? filePath : exercise?.filename ?? bookCase?.filename ?? 'broken.yml'}</span><span className="mcl-sp" />
            <span aria-live="polite" data-testid="yaml-state" data-state={!res ? 'pending' : res.ok ? 'valid' : 'error'}>{!res ? '' : res.ok ? 'Valid YAML' : where ?? 'Error'}</span>
          </div>
          <CodeEditor lang="yaml" language={language} initial={first.start} ariaLabel="YAML editor" onChange={setText} handle={editor} diagnostics={diagnostics} testId="yaml-editor" minLines={8} />
        </div>

        {py.phase !== 'ready' && !fatal && (
          <div className="mcl-status" role="status" data-testid="py-status" data-phase={py.phase}>
            <div className="mcl-progress"><span>{py.message ?? stageText(py.stage)} {py.stage ? '' : `(about ${PYODIDE_MB} MB, once)`}</span><progress aria-label="Python engine loading" /></div>
          </div>
        )}
        {fatal && <p className="mcl-notice bad" role="alert">The Python engine could not run: {fatal}</p>}

        <div aria-live="polite">
          {res && res.ok && (
            <div className="mcl-msg ok" data-testid="yaml-ok">
              <p><strong>Valid YAML.</strong> {engine === 'dbt' ? 'dbt can read this file.' : 'yaml.safe_load reads it without an error.'}</p>
              {(res.warnings ?? []).map((w, i) => <pre key={i} className="mcl-warn-text" data-testid="yaml-warning">{w.dbt_message}</pre>)}
            </div>
          )}
          {err && (
            <div className="mcl-msg bad" data-testid="yaml-error">
              <p><strong>{where ? `${where}:` : 'Error:'}</strong> {err.problem ?? err.message.split('\n')[0]}</p>
              {tip && <p>{tip}</p>}
              <pre data-testid="yaml-message">{fullMessage}</pre>
              {engine === 'dbt' && offset > 0 && <p className="mcl-note">dbt removes the {offset} empty line{offset > 1 ? 's' : ''} at the start of the file, so its line numbers are {offset} less than in the editor.</p>}
              {err.wording_patched && <p className="mcl-note">The wording is the one of the libyaml version dbt users get (0.2.5); the browser has 0.1.7, which writes "violate".</p>}
            </div>
          )}
          {res?.ok && res.repr !== undefined && (
            <details className="mcl-out" open={!exercise}>
              <summary className="mcl-out-head">What Python reads</summary>
              <pre data-testid="yaml-repr" tabIndex={0} aria-label="What Python reads">{res.repr}</pre>
            </details>
          )}
          {checks && (
            <div className={`mcl-msg ${allOk ? 'ok' : 'warn'}`} data-testid="exercise-check" data-solved={String(!!allOk)}>
              <p><strong>{allOk ? 'Solved.' : 'Not yet.'}</strong> {allOk ? exercise?.why : 'The checks below run while you type.'}</p>
              <ul className="mcl-checks">
                {checks.map((c, i) => <li key={i} data-ok={String(c.ok)}><span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> {c.label}{c.detail ? ` (${c.detail})` : ''}</li>)}
              </ul>
            </div>
          )}
          {graded && bookCase && (
            <div className={`mcl-msg ${graded.passed ? 'ok' : 'bad'}`} data-testid="case-grade" data-passed={String(graded.passed)}>
              <p><strong>{graded.passed ? 'Same as the book.' : 'Different from the book.'}</strong> {graded.byteExact ? 'Byte for byte.' : graded.detail ?? ''}</p>
              <p className="mcl-note">The book{bookCase.ref ? ` (${bookCase.ref})` : ''}:</p>
              <pre>{graded.book}</pre>
              {bookCase.reconstructed && <p className="mcl-note">File: {bookCase.reconstructed}.</p>}
            </div>
          )}
        </div>
        <p className="mcl-foot">The check runs while you type. Tab indents with 2 spaces; Esc then Tab moves to the next control.</p>
      </section>
    </div>
  );
}
