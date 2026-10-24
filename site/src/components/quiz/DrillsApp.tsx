// Drills (/practice/drills/): a custom quiz from the whole question bank, by topic, objective, format,
// source, difficulty (when the bank has it), only your mistakes or only questions you never answered.
// Modes: practice with feedback, DOMC training, speed round (1 min 50 s per question).
import { useEffect, useMemo, useState } from 'react';
import type { Format, Question } from '../../lib/content-types';
import { EMPTY_FILTER, difficultyOf, filterBank, pick, questionObjectives, sourceKey, type DrillFilter, type SourceKey } from '../../lib/exam/bank';
import { answerHistory } from '../../lib/exam/learning';
import { questionTopic } from '../../lib/exam/results';
import { OBJECTIVES, TOPICS } from '../../lib/exam/objectives';
import { FORMAT_NAME } from '../../lib/exam/describe';
import { PACE_MS } from '../../lib/exam/engine';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../../lib/store/db';
import { QuizRunner } from './QuizRunner';

type Mode = 'practice' | 'domc' | 'speed';
const FORMATS: Format[] = ['mc', 'ms', 'fill', 'match', 'hotspot', 'order', 'domc'];
const SOURCES: { id: SourceKey; label: string }[] = [
  { id: 'chapters', label: 'Chapter quizzes' }, { id: 'mock1', label: 'Mock exam 1' }, { id: 'mock2', label: 'Mock exam 2' }, { id: 'mock3', label: 'Mock exam 3' },
];
const SIZES = [10, 20, 30, 65, 0];

interface Props { bankUrl: string }

export default function DrillsApp({ bankUrl }: Props) {
  const [bank, setBank] = useState<Question[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [history, setHistory] = useState<{ seen: Set<string>; mistakes: Set<string> }>({ seen: new Set(), mistakes: new Set() });
  const [mode, setMode] = useState<Mode>('practice');
  const [f, setF] = useState<DrillFilter>(EMPTY_FILTER);
  const [size, setSize] = useState(20);
  const [rules, setRules] = useState({ earlyEnd: DEFAULT_SETTINGS.domcEarlyEnd, extraOption: DEFAULT_SETTINGS.domcExtraOption });
  const [run, setRun] = useState<{ questions: Question[]; seed: number; mode: Mode } | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(bankUrl).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { questions: Question[] }) => setBank(d.questions))
      .catch(() => setLoadError('The questions could not be loaded. Check your connection, then reload the page.'));
    answerHistory().then(setHistory).catch(() => undefined);
    getSettings().then((s) => setRules({ earlyEnd: s.domcEarlyEnd, extraOption: s.domcExtraOption })).catch(() => undefined);
  }, [bankUrl]);

  const effective: DrillFilter = useMemo(() => (mode === 'domc' ? { ...f, formats: ['domc'] } : f), [mode, f]);
  const matching = useMemo(() => (bank ? filterBank(bank, effective, history) : []), [bank, effective, history]);
  const difficulties = useMemo(() => [...new Set((bank ?? []).map(difficultyOf).filter((d): d is string => !!d))].sort(), [bank]);
  const count = (patch: Partial<DrillFilter>) => (bank ? filterBank(bank, { ...effective, ...patch }, history).length : 0);

  const toggle = <K extends 'topics' | 'formats' | 'sources' | 'difficulties'>(key: K, v: DrillFilter[K][number]) => {
    setF((x) => {
      const list = x[key] as unknown[];
      return { ...x, [key]: list.includes(v) ? list.filter((y) => y !== v) : [...list, v] };
    });
  };

  const setRule = async (patch: Partial<typeof rules>) => {
    const next = { ...rules, ...patch };
    setRules(next);
    try { await saveSettings({ domcEarlyEnd: next.earlyEnd, domcExtraOption: next.extraOption }); } catch { /* storage blocked: the choice still applies to this drill */ }
  };

  const start = () => {
    if (!matching.length) { setMsg('No question matches these filters. Remove a filter to get questions.'); return; }
    const seed = Math.floor(Math.random() * 1e9);
    const n = mode === 'speed' && size === 0 ? matching.length : size;
    setRun({ questions: pick(matching, n, seed), seed, mode });
    window.scrollTo({ top: 0 });
  };

  if (run) {
    const title = run.mode === 'domc' ? 'DOMC training' : run.mode === 'speed' ? 'Speed round' : 'Drill';
    return (
      <div className="dr-run">
        <p className="dr-run-head">
          <b>{title}</b> · {run.questions.length} questions{run.mode === 'speed' ? ' · 1 min 50 s per question' : ''}
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setRun(null)}>Stop and change the drill</button>
        </p>
        <QuizRunner
          key={run.seed}
          questions={run.questions}
          mode="drill"
          title={title}
          domcExamLike
          domcRules={rules}
          timePerQuestionMs={run.mode === 'speed' ? PACE_MS : undefined}
          seed={run.seed}
          onExit={() => { setRun(null); answerHistory().then(setHistory).catch(() => undefined); }}
          exitLabel="Build another drill"
        />
      </div>
    );
  }

  return (
    <form className="dr" onSubmit={(e) => { e.preventDefault(); start(); }} aria-describedby="dr-count">
      <fieldset className="dr-box">
        <legend>Kind of drill</legend>
        <div className="dr-modes">
          {([
            ['practice', 'Practice', 'Feedback and the explanation after each answer.'],
            ['domc', 'DOMC training', 'Only DOMC questions: one option at a time, in a random order, like the real exam.'],
            ['speed', 'Speed round', 'A timer of 1 min 50 s per question, the pace of the real exam. At 0 the answer is checked.'],
          ] as [Mode, string, string][]).map(([id, label, text]) => (
            <label key={id} className="dr-mode" data-checked={mode === id || undefined}>
              <input type="radio" name="dr-mode" value={id} checked={mode === id} onChange={() => setMode(id)} />
              <span><b>{label}</b><span className="dr-sub">{text}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="dr-grid">
        <fieldset className="dr-box">
          <legend>Topics</legend>
          {[...TOPICS.map((t) => ({ n: t.n, label: `${t.n}. ${t.title}` })), { n: 0, label: 'Prerequisites (SQL and Git)' }].map((t) => (
            <label key={t.n} className="dr-check">
              <input type="checkbox" checked={f.topics.includes(t.n)} onChange={() => toggle('topics', t.n)} />
              <span>{t.label}</span>
              <span className="dr-n">{bank ? (bank.filter((q) => questionTopic(q) === t.n).length) : ''}</span>
            </label>
          ))}
          <p className="dr-hint">None ticked: every topic.</p>
        </fieldset>

        <div className="dr-col">
          <fieldset className="dr-box">
            <legend>Objective</legend>
            <label className="visually-hidden" htmlFor="dr-obj">Objective</label>
            <select id="dr-obj" value={f.objectives[0] ?? ''} onChange={(e) => setF((x) => ({ ...x, objectives: e.target.value ? [e.target.value] : [] }))}>
              <option value="">All objectives</option>
              {OBJECTIVES.map((o) => <option key={o.id} value={o.id}>{o.id}: {o.title}</option>)}
            </select>
            <p className="dr-hint">Chapter questions count for the objectives their chapter teaches.</p>
          </fieldset>

          <fieldset className="dr-box" disabled={mode === 'domc'}>
            <legend>Formats{mode === 'domc' ? ' (DOMC only)' : ''}</legend>
            <div className="dr-chips">
              {FORMATS.map((fm) => (
                <label key={fm} className="dr-chip">
                  <input type="checkbox" checked={mode === 'domc' ? fm === 'domc' : f.formats.includes(fm)} onChange={() => toggle('formats', fm)} />
                  <span>{FORMAT_NAME[fm]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="dr-box">
            <legend>Where the questions come from</legend>
            <div className="dr-chips">
              {SOURCES.map((s) => (
                <label key={s.id} className="dr-chip">
                  <input type="checkbox" checked={f.sources.includes(s.id)} onChange={() => toggle('sources', s.id)} />
                  <span>{s.label} <span className="dr-n">{bank ? bank.filter((q) => sourceKey(q) === s.id).length : ''}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          {difficulties.length > 0 && (
            <fieldset className="dr-box">
              <legend>Difficulty</legend>
              <div className="dr-chips">
                {difficulties.map((d) => (
                  <label key={d} className="dr-chip"><input type="checkbox" checked={f.difficulties.includes(d)} onChange={() => toggle('difficulties', d)} /><span>{d}</span></label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="dr-box">
            <legend>Which questions</legend>
            <div className="dr-chips">
              {([['all', 'All', {}], ['mistakes', 'Only my mistakes', { only: 'mistakes' }], ['unseen', 'Only questions I never answered', { only: 'unseen' }]] as [DrillFilter['only'], string, Partial<DrillFilter>][]).map(([id, label, patch]) => (
                <label key={id} className="dr-chip">
                  <input type="radio" name="dr-only" checked={f.only === id} onChange={() => setF((x) => ({ ...x, only: id }))} />
                  <span>{label} <span className="dr-n">{bank ? count({ only: 'all', ...patch }) : ''}</span></span>
                </label>
              ))}
            </div>
            <p className="dr-hint">“My mistakes” are the questions whose last answer was wrong.</p>
          </fieldset>
        </div>
      </div>

      <fieldset className="dr-box">
        <legend>DOMC rules</legend>
        <label className="dr-check"><input type="checkbox" checked={rules.earlyEnd} onChange={(e) => setRule({ earlyEnd: e.target.checked })} /><span>End a DOMC question as soon as its result is known (like the real exam)</span></label>
        <label className="dr-check"><input type="checkbox" checked={rules.extraOption} onChange={(e) => setRule({ extraOption: e.target.checked })} /><span>Show one more option after the question is decided, so the end does not tell you if you were right</span></label>
        <p className="dr-hint">These are your Settings: they also apply to chapter quizzes. Mock exams in exam mode always end DOMC questions early.</p>
      </fieldset>

      <div className="dr-start">
        <label htmlFor="dr-size">Number of questions</label>
        <select id="dr-size" value={size} onChange={(e) => setSize(Number(e.target.value))}>
          {SIZES.map((n) => <option key={n} value={n}>{n === 0 ? 'All' : n}</option>)}
        </select>
        <button type="submit" className="btn btn-primary" aria-disabled={!bank || matching.length === 0 || undefined}>Start the drill</button>
        <p id="dr-count" className="dr-count" role="status">
          {loadError || (bank === null ? 'Loading the questions…' : matching.length === 0 ? 'No question matches these filters.' : matching.length === 1 ? '1 question matches.' : `${matching.length} questions match. You get ${size === 0 || size >= matching.length ? 'all of them' : size}, in a random order.`)}
        </p>
        {msg && <p className="dr-msg" role="alert">{msg}</p>}
      </div>
      {bank && f.objectives.length > 0 && <p className="dr-hint">{matching.filter((q) => questionObjectives(q).length > 1).length} of these questions come from chapter quizzes that teach this objective.</p>}
    </form>
  );
}
