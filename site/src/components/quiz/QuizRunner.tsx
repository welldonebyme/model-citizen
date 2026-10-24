// Practice session with instant feedback (chapter quizzes, lesson checkpoints, drills): one question at a
// time, "Check answer", feedback, next. Score at the end, then "Retry the wrong ones".
// With a sessionKey, the session (current question, answers, retries) survives a reload.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Question } from '../../lib/content-types';
import { grade, type Response } from '../../lib/scoring';
import type { AnswerMode } from '../../lib/store/db';
import { domcInit, domcJudge, domcResponse, type DomcRules, type DomcState } from '../../lib/exam/domc';
import { isComplete, blanksOf } from '../../lib/exam/engine';
import { recordOutcome } from '../../lib/exam/learning';
import { sourceLabel } from '../../lib/exam/describe';
import { mss } from '../../lib/exam/time';
import { QuestionView } from './QuestionView';
import { Feedback } from './Feedback';
import { useDomcRules, scrollIntoViewIfNeeded } from './hooks';
import { IconCheck, IconCross } from './icons';

interface QState { response?: Response; domc?: DomcState; checked: boolean; correct: boolean; ms: number; shownAt: number; timeUp?: boolean }

/** What is saved for a session (localStorage: a per-browser convenience; answers themselves go to IndexedDB). */
interface Saved { v: 1; ids: string[]; round: string[]; roundNo: number; index: number; phase: 'question' | 'summary'; states: Record<string, QState>; solved: string[]; at: number }
const SESSION_PREFIX = 'mc:quiz-session:';
const SESSION_TTL = 30 * 24 * 3600_000;

function loadSession(key: string | undefined, questions: Question[]): Saved | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    const ids = new Set(questions.map((q) => q.id));
    if (s.v !== 1 || Date.now() - s.at > SESSION_TTL || s.phase === 'summary' || !s.round.length || !s.round.every((id) => ids.has(id))) return null;
    return s;
  } catch { return null; }
}
function saveSession(key: string | undefined, s: Saved | null) {
  if (!key || typeof window === 'undefined') return;
  try {
    if (s) window.localStorage.setItem(SESSION_PREFIX + key, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_PREFIX + key);
  } catch { /* storage blocked: the session just does not survive a reload */ }
}

export interface QuizFinish { score: number; total: number; roundNo: number; roundScore: number; roundTotal: number }

export interface QuizRunnerProps {
  questions: Question[];
  mode: Extract<AnswerMode, 'quiz' | 'drill' | 'checkpoint'>;
  title: string;
  /** DOMC: shuffle the options and hide the letters (exam-like), or book order with letters */
  domcExamLike: boolean;
  /** override the DOMC rules from Settings (drills) */
  domcRules?: DomcRules;
  /** speed round: time limit per question */
  timePerQuestionMs?: number;
  seed: number;
  backHref?: string;
  backLabel?: string;
  onExit?: () => void;
  exitLabel?: string;
  /** question id to open first (deep link ?q=<id>) */
  startAt?: string;
  /** save the session in this browser under this key, and resume it after a reload */
  sessionKey?: string;
  /** called when the score is shown: score = questions right at least once in this session */
  onFinish?: (r: QuizFinish) => void;
  /** small version for the end of a lesson (h3 headings, no question dots for 1 question) */
  compact?: boolean;
  /** compact summary: link to the full chapter quiz */
  moreHref?: string;
  moreLabel?: string;
}

function PaceTimer({ limitMs, running, onTimeUp }: { limitMs: number; running: boolean; onTimeUp: () => void }) {
  const [left, setLeft] = useState(limitMs);
  const start = useRef(Date.now());
  const fired = useRef(false);
  const cb = useRef(onTimeUp);
  cb.current = onTimeUp;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const l = Math.max(0, limitMs - (Date.now() - start.current));
      setLeft(l);
      if (l === 0 && !fired.current) { fired.current = true; cb.current(); }
    }, 250);
    return () => clearInterval(t);
  }, [running, limitMs]);
  const low = left <= 20_000;
  return (
    <p className="qz-pace" data-low={low || undefined}>
      <span className="qz-pace-bar" aria-hidden="true"><span style={{ width: `${(left / limitMs) * 100}%` }} /></span>
      <span>{running ? <><b>{mss(left)}</b> left for this question</> : 'Timer stopped'}</span>
    </p>
  );
}

export function QuizRunner(props: QuizRunnerProps) {
  const { questions, mode, title, domcExamLike, timePerQuestionMs, seed, backHref, backLabel, onExit, exitLabel, startAt, sessionKey, onFinish, compact, moreHref, moreLabel } = props;
  const settings = useDomcRules();
  const rules = props.domcRules ?? settings.rules;
  const byId = useMemo(() => new Map(questions.map((x) => [x.id, x])), [questions]);
  const [saved] = useState(() => loadSession(sessionKey, questions));
  const [round, setRound] = useState<Question[]>(() => (saved ? saved.round.map((id) => byId.get(id)!) : questions));
  const [roundNo, setRoundNo] = useState(saved?.roundNo ?? 1);
  const [index, setIndex] = useState(() => {
    const list = saved ? saved.round : questions.map((x) => x.id);
    const at = startAt ? list.indexOf(startAt) : -1;
    return at >= 0 ? at : Math.min(saved?.index ?? 0, list.length - 1);
  });
  const [phase, setPhase] = useState<'question' | 'summary'>('question');
  const [states, setStates] = useState<Record<string, QState>>(() => {
    if (!saved) return {};
    const now = Date.now();
    return Object.fromEntries(Object.entries(saved.states).map(([k, v]) => [k, v.checked ? v : { ...v, shownAt: now - (v.ms || 0) }]));
  });
  const [solved, setSolved] = useState<Set<string>>(() => new Set(saved?.solved ?? []));
  const [saveError, setSaveError] = useState('');
  const uid = useId().replace(/:/g, '');
  const H = compact ? 'h3' : 'h2';
  const qHeadingId = compact ? `${uid}-q-h` : 'qz-q-h';
  const sumHeadingId = compact ? `${uid}-sum-h` : 'qz-sum-h';
  const rootRef = useRef<HTMLElement>(null);
  const finishedRound = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const q = round[index];
  const st: QState = states[q?.id] ?? { checked: false, correct: false, ms: 0, shownAt: Date.now() };
  const domcState = useMemo(() => (q?.format === 'domc' ? st.domc ?? domcInit(q, { shuffle: domcExamLike, seed: seed + roundNo }) : undefined), [q, st.domc, domcExamLike, seed, roundNo]);

  // A question's clock starts when it is first shown.
  useEffect(() => {
    if (!q || phase !== 'question') return;
    setStates((s) => (s[q.id] ? s : { ...s, [q.id]: { checked: false, correct: false, ms: 0, shownAt: Date.now() } }));
    if (first.current) { first.current = false; return; }
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: Math.max(0, (headingRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY - 90), behavior: 'auto' });
  }, [q, phase]);

  // Save the session after every change (resume after a reload); a finished session is not resumed.
  useEffect(() => {
    if (!sessionKey) return;
    saveSession(sessionKey, { v: 1, ids: questions.map((x) => x.id), round: round.map((x) => x.id), roundNo, index, phase, states, solved: [...solved], at: Date.now() });
  }, [sessionKey, questions, round, roundNo, index, phase, states, solved]);

  const update = (patch: Partial<QState>) => setStates((s) => ({ ...s, [q.id]: { ...(s[q.id] ?? st), ...patch } }));

  const check = useCallback((timeUp = false, domcOverride?: DomcState) => {
    if (!q) return;
    const cur = states[q.id] ?? st;
    if (cur.checked) return;
    const response = q.format === 'domc' ? domcResponse(domcOverride ?? domcState!) : cur.response;
    const correct = grade(q, response).correct;
    const ms = Date.now() - cur.shownAt;
    setStates((s) => ({ ...s, [q.id]: { ...cur, domc: domcOverride ?? cur.domc, response, checked: true, correct, ms, timeUp } }));
    if (correct) setSolved((x) => (x.has(q.id) ? x : new Set([...x, q.id])));
    recordOutcome(q, response, correct, { mode, ms }).catch(() => setSaveError('Your answers cannot be saved in this browser (storage is blocked). The quiz still works.'));
    requestAnimationFrame(() => { feedbackRef.current?.focus({ preventScroll: true }); scrollIntoViewIfNeeded(feedbackRef.current); });
  }, [q, states, st, domcState, mode]);

  const onJudge = (yes: boolean) => {
    if (!q || !domcState || st.checked) return;
    const next = domcJudge(q, domcState, rules, yes);
    update({ domc: next, response: domcResponse(next) });
    if (next.done) check(false, next);
  };

  const answered = q ? isComplete(q, st.response, domcState, blanksOf(q)) : false;
  const [hint, setHint] = useState('');
  useEffect(() => setHint(''), [q]);

  const next = () => {
    if (index + 1 < round.length) { setIndex(index + 1); return; }
    setPhase('summary');
    requestAnimationFrame(() => {
      summaryRef.current?.focus({ preventScroll: true });
      if (compact) rootRef.current?.scrollIntoView({ block: 'start' }); else window.scrollTo({ top: 0 });
    });
  };

  // Tell the page once per round that the score is shown (progress: chapter quiz done).
  useEffect(() => {
    if (phase !== 'summary' || !onFinish || finishedRound.current === roundNo) return;
    finishedRound.current = roundNo;
    const roundScore = round.filter((x) => states[x.id]?.correct).length;
    onFinish({ score: questions.filter((x) => solved.has(x.id)).length, total: questions.length, roundNo, roundScore, roundTotal: round.length });
  }, [phase, onFinish, roundNo, round, states, questions, solved]);

  const results = round.map((x) => ({ q: x, s: states[x.id] }));
  const right = results.filter((r) => r.s?.correct).length;
  const wrong = results.filter((r) => !r.s?.correct).map((r) => r.q);

  const restart = (list: Question[]) => {
    setStates((s) => { const n = { ...s }; for (const x of list) delete n[x.id]; return n; });
    setRound(list);
    setRoundNo((r) => r + 1);
    setIndex(0);
    setPhase('question');
  };

  if (!q && phase === 'question') return <p className="qz-empty">There are no questions here yet.</p>;
  const sectionCls = compact ? ' qz-compact' : '';

  if (phase === 'summary') {
    const pct = round.length ? Math.round((right / round.length) * 100) : 0;
    const timed = timePerQuestionMs ? results.filter((r) => r.s?.checked && !r.s.timeUp).length : 0;
    const avg = results.length ? results.reduce((t, r) => t + (r.s?.ms ?? 0), 0) / results.length : 0;
    return (
      <section className={`qz-summary${sectionCls}`} aria-labelledby={sumHeadingId} ref={rootRef}>
        <H id={sumHeadingId} ref={summaryRef} tabIndex={-1}>{roundNo > 1 ? 'Score for this retry' : 'Your score'}</H>
        <p className="qz-score"><b>{right}</b> of {round.length} correct <span className="qz-score-pct">({pct}%)</span></p>
        <p className="qz-score-note">
          {compact
            ? (right === round.length ? 'You understood this lesson. Go on to the next one.' : 'Read the explanation again, or the part of the lesson it points to, then retry. The question is in your error notebook.')
            : pct >= 90 ? 'Very good. Redo this quiz in a few days to keep it fresh.' : pct >= 80 ? 'Good. Review the questions you missed: they are in your error notebook.' : 'Read the explanations of the questions you missed, then retry them. They are in your error notebook and come back in your reviews.'}
        </p>
        {timePerQuestionMs && <p className="qz-score-note">Answered in time: <b>{timed} of {round.length}</b>. Average time per question: <b>{mss(avg)}</b> (target {mss(timePerQuestionMs)}).</p>}
        {!compact && <ol className="qz-sum-list">
          {results.map((r, i) => (
            <li key={r.q.id} data-ok={r.s?.correct || undefined}>
              <span className="qz-sum-mark">{r.s?.correct ? <IconCheck /> : <IconCross />}<span className="visually-hidden">{r.s?.correct ? 'Correct' : r.s?.checked ? 'Not correct' : 'Skipped'}</span></span>
              <button type="button" className="qz-linkbtn" onClick={() => { setIndex(i); setPhase('question'); }}>
                Question {i + 1}
              </button>
              <span className="qz-muted">{r.s?.checked ? '' : 'Skipped. '}{sourceLabel(r.q)}</span>
            </li>
          ))}
        </ol>}
        <div className="qz-actions">
          {wrong.length > 0 && <button type="button" className="btn btn-primary" onClick={() => restart(wrong)}>Retry the {wrong.length === 1 ? 'question you missed' : `${wrong.length} questions you missed`}</button>}
          <button type="button" className="btn btn-quiet" onClick={() => restart(questions)}>{compact ? 'Start again' : 'Start again with all questions'}</button>
          {moreHref && <a className="btn btn-quiet" href={moreHref}>{moreLabel ?? 'The full chapter quiz'}</a>}
          {onExit && <button type="button" className="btn btn-quiet" onClick={onExit}>{exitLabel ?? 'Back'}</button>}
          {backHref && <a className="btn btn-quiet" href={backHref}>{backLabel ?? 'Back to the lesson'}</a>}
        </div>
      </section>
    );
  }

  const done = Object.values(states).filter((s) => s.checked).length;
  return (
    <section className={`qz-runner${sectionCls}`} aria-labelledby={qHeadingId} ref={rootRef}>
      <div className="qz-progress">
        <H id={qHeadingId} ref={headingRef} tabIndex={-1}>Question {index + 1} <span className="qz-of">of {round.length}</span></H>
        <span className="qz-muted">{title}{roundNo > 1 ? `, retry ${roundNo - 1}` : ''}</span>
        {(!compact || round.length > 1) && <ol className="qz-dots" aria-label="Questions">
          {round.map((x, i) => {
            const s = states[x.id];
            const state = s?.checked ? (s.correct ? 'right' : 'wrong') : i === index ? 'current' : undefined;
            return (
              <li key={x.id}>
                <button type="button" data-state={state} aria-current={i === index ? 'step' : undefined} onClick={() => setIndex(i)}
                  aria-label={`Question ${i + 1}${s?.checked ? (s.correct ? ', correct' : ', not correct') : ''}`}>{i + 1}</button>
              </li>
            );
          })}
        </ol>}
        <span className="visually-hidden" aria-live="polite">{done} of {round.length} checked.</span>
      </div>

      {timePerQuestionMs && <PaceTimer key={`${roundNo}-${q.id}`} limitMs={timePerQuestionMs} running={!st.checked} onTimeUp={() => check(true)} />}

      <div className="qz-card">
        <QuestionView
          key={`${roundNo}-${q.id}`}
          q={q}
          name={`q-${q.id}-${roundNo}${compact ? `-${uid}` : ''}`}
          response={st.response}
          onResponse={(r) => { if (!st.checked) update({ response: r }); }}
          domc={domcState ? { state: domcState, rules, onJudge, letters: !domcExamLike || st.checked, keys: !st.checked } : undefined}
          review={st.checked}
          onEnter={() => (answered ? check() : setHint('Type your answer first.'))}
        />
        {st.checked && <Feedback ref={feedbackRef} q={q} response={st.response} correct={st.correct} timeUp={st.timeUp} />}
        <div className="qz-actions">
          {!st.checked && q.format !== 'domc' && (
            <>
              <button type="button" className="btn btn-primary" aria-disabled={!answered || undefined}
                onClick={() => (answered ? check() : setHint(q.format === 'ms' ? `Choose ${q.choose ?? 2} answers first.` : 'Answer the question first. A blank answer is always wrong on the exam.'))}>
                Check answer
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => check()}>I do not know: show the answer</button>
            </>
          )}
          {st.checked && <button type="button" className="btn btn-primary" onClick={next}>{index + 1 < round.length ? 'Next question' : 'See your score'}</button>}
          {!st.checked && index + 1 < round.length && <button type="button" className="btn btn-quiet qz-skip" onClick={next}>Skip for now</button>}
          <span className="qz-hint" role="status">{hint}</span>
        </div>
        {saveError && <p className="qz-warn" role="alert">{saveError}</p>}
      </div>
    </section>
  );
}
