// Mock exam simulator island (/exams/mockN/).
// Exam mode: 120:00 countdown, one question per screen, flag for review, navigator, no feedback until the
// end, autosave of every answer and of the time left (resume after a reload or a closed tab), time-up
// auto-submit, review screen before submitting, DOMC rules enforced. Practice mode: same questions with
// feedback after each one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '../../lib/content-types';
import { grade } from '../../lib/scoring';
import { getSettings, DEFAULT_SETTINGS } from '../../lib/store/db';
import { domcJudge, type DomcRules } from '../../lib/exam/domc';
import {
  newAttempt, goTo, setResponse, setDomc, toggleFlag, markChecked, finishAttempt, progressOf, responseOf, domcOf,
  isComplete, blanksOf, remainingMs, catchUp, elapsedAt, openReview, EXAM_MINUTES, type Attempt,
} from '../../lib/exam/engine';
import { shuffleView } from '../../lib/exam/shuffle';
import { activeAttempt, abandonAttempt, listAttempts, makeSaver, saveAttempt } from '../../lib/exam/persist';
import { recordMany, recordOutcome } from '../../lib/exam/learning';
import { clock, dateTime, spoken } from '../../lib/exam/time';
import { isAnswered } from '../../lib/scoring';
import type { ObjectiveLinks } from '../../lib/exam/links-types';
import { QuestionView } from '../quiz/QuestionView';
import { Feedback } from '../quiz/Feedback';
import { IconFlag } from '../quiz/icons';
import { Timer } from './Timer';
import { Navigator, type NavItem } from './Navigator';
import { Results } from './Results';

export interface ExamAppProps {
  mock: { n: number; title: string; description: string; durationMin: number };
  questions: Question[];
  links: ObjectiveLinks;
  examsHref: string;
  homeHref: string;
  settingsHref: string;
  sample: boolean;
  /** questions of the book's mock that cannot be shown yet (key still being checked) */
  missing: number;
}

type Phase = 'loading' | 'start' | 'resume' | 'running' | 'review' | 'results' | 'nostorage';

export default function ExamApp(props: ExamAppProps) {
  const { mock, questions, links, examsHref, homeHref, settingsHref, sample, missing } = props;
  const [phase, setPhase] = useState<Phase>('loading');
  const [a, setA] = useState<Attempt | null>(null);
  const [pending, setPending] = useState<Attempt | null>(null);   // active attempt found on load
  const [history, setHistory] = useState<Attempt[]>([]);
  const [rules, setRules] = useState<DomcRules>({ earlyEnd: true, extraOption: DEFAULT_SETTINGS.domcExtraOption });
  const [navOpen, setNavOpen] = useState(false);
  const [confirm, setConfirm] = useState<'submit' | 'restart' | null>(null);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [pauseOnClose, setPauseOnClose] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const aRef = useRef<Attempt | null>(null);
  aRef.current = a;
  const clockRef = useRef({ base: 0, since: 0, running: false });
  const saver = useMemo(() => makeSaver(150), []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLHeadingElement>(null);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  /** The questions as this attempt shows them (MC/MS options and build-list starts in the attempt's seeded order). */
  const viewCache = useRef(new Map<number, Question[]>());
  const viewOf = useCallback((x: Attempt) => {
    if (!x.shuffle) return questions;
    let v = viewCache.current.get(x.seed);
    if (!v) { v = questions.map((q) => shuffleView(q, x.seed)); viewCache.current.set(x.seed, v); }
    return v;
  }, [questions]);
  const durationMs = (mock.durationMin || EXAM_MINUTES) * 60_000;

  const elapsed = useCallback(() => {
    const c = clockRef.current;
    return c.running ? c.base + (Date.now() - c.since) : c.base;
  }, []);

  const startClock = (from: number) => { clockRef.current = { base: from, since: Date.now(), running: true }; };
  const stopClock = () => { clockRef.current = { base: elapsed(), since: Date.now(), running: false }; };

  // ---------------------------------------------------------------- load
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [s, act, all] = await Promise.all([getSettings(), activeAttempt(mock.n), listAttempts()]);
        if (!live) return;
        setRules({ earlyEnd: true, extraOption: s.domcExtraOption });
        setPauseOnClose(!!s.examPauseOnClose);
        setHistory(all.filter((x) => x.status === 'finished'));
        const usable = act && act.questionIds.every((id) => byId.has(id)) ? act : undefined;
        if (act && !usable) await abandonAttempt(act.id); // the questions changed since: cannot resume
        if (usable && usable.mode === 'exam' && elapsedAt(usable, Date.now()) >= usable.durationMs) {
          // the time ran out while the page was closed (realistic clock): submit, like the real exam
          submitCaughtUp(usable);
          return;
        }
        if (usable) { setPending(usable); setPhase('resume'); } else setPhase('start');
      } catch {
        if (live) setPhase('nostorage');
      }
    })();
    return () => { live = false; };
  }, [mock.n, byId]);

  // ---------------------------------------------------------------- one tab at a time
  // Two tabs on the same attempt would overwrite each other's answers. The tab that starts or resumes an
  // attempt says so on a BroadcastChannel; any other tab on that attempt stops saving and says why.
  const tabId = useMemo(() => Math.random().toString(36).slice(2), []);
  const channel = useMemo(() => (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mc-exam') : null), []);
  const [elsewhere, setElsewhere] = useState(false);
  const elsewhereRef = useRef(false);
  useEffect(() => {
    if (!channel) return;
    channel.onmessage = (ev: MessageEvent<{ type: string; id: string; tab: string }>) => {
      const cur = aRef.current;
      if (ev.data?.type === 'claim' && ev.data.tab !== tabId && cur && cur.id === ev.data.id && cur.status === 'active') {
        elsewhereRef.current = true;
        setElsewhere(true);
        stopClock();
      }
    };
    return () => { channel.onmessage = null; };
  }, [channel, tabId]);
  const claim = (id: string) => { elsewhereRef.current = false; setElsewhere(false); channel?.postMessage({ type: 'claim', id, tab: tabId }); };

  // ---------------------------------------------------------------- autosave
  const commit = useCallback((fn: (x: Attempt) => Attempt) => {
    const cur = aRef.current;
    if (!cur || elsewhereRef.current) return;
    const next0 = fn({ ...cur, elapsedMs: elapsed(), clockAt: Date.now() });
    const next = { ...next0, answered: progressOf(next0, viewOf(next0)).answered };
    aRef.current = next;
    setA(next);
    saver.push(next);
  }, [elapsed, saver, viewOf]);

  useEffect(() => {
    if (phase !== 'running' && phase !== 'review') return;
    const t = setInterval(() => { const cur = aRef.current; if (cur && !elsewhereRef.current) saver.push({ ...cur, elapsedMs: elapsed(), clockAt: Date.now() }); }, 5000);
    const flush = () => { const cur = aRef.current; if (cur && cur.status === 'active' && !elsewhereRef.current) { saver.push({ ...cur, elapsedMs: elapsed(), clockAt: Date.now() }); saver.flush(); } };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onVis); };
  }, [phase, elapsed, saver]);

  // ---------------------------------------------------------------- start / resume / finish
  const begin = async (mode: 'exam' | 'practice') => {
    try {
      if (pending) await abandonAttempt(pending.id);
      const s = await getSettings().catch(() => DEFAULT_SETTINGS);
      const domcRules = mode === 'exam' ? { earlyEnd: true, extraOption: s.domcExtraOption } : { earlyEnd: s.domcEarlyEnd, extraOption: s.domcExtraOption };
      const fresh = newAttempt({ mock: mock.n, mode, questions, now: Date.now(), durationMs: mode === 'exam' ? durationMs : 0, domcRules, pauseOnClose: !!s.examPauseOnClose });
      setRules(domcRules);
      await saveAttempt(fresh);
      aRef.current = fresh;
      setA(fresh);
      setPending(null);
      startClock(0);
      claim(fresh.id);
      setPhase('running');
      focusQuestion();
    } catch {
      setPhase('nostorage');
    }
  };

  // While the resume prompt is shown, a realistic clock keeps going: show it, and submit at 0.
  useEffect(() => {
    if (phase !== 'resume' || !pending || pending.mode !== 'exam' || pending.clock !== 'wall') return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (elapsedAt(pending, n) >= pending.durationMs) { clearInterval(t); setPending(null); submitCaughtUp(pending, 'prompt'); }
    }, 1000);
    return () => clearInterval(t);
  });

  /** The time is over for an attempt that was not open: submit it. `where` says what the learner was doing. */
  function submitCaughtUp(x: Attempt, where: 'closed' | 'prompt' = 'closed') {
    const r = catchUp(x, Date.now());
    if (r.domcRules) setRules(r.domcRules);
    aRef.current = r;
    setA(r);
    clockRef.current = { base: r.elapsedMs, since: Date.now(), running: false };
    finishRef.current(true, where);
  }

  const resume = () => {
    if (!pending) return;
    const r0 = catchUp(pending, Date.now());
    if (r0.mode === 'exam' && r0.elapsedMs >= r0.durationMs) { setPending(null); submitCaughtUp(pending, 'prompt'); return; }
    const r = { ...r0, inReview: false };
    if (r.domcRules) setRules(r.domcRules);
    aRef.current = r;
    setA(r);
    setPending(null);
    startClock(r.elapsedMs);
    claim(r.id);
    setPhase('running');
    focusQuestion();
  };

  const finish = useCallback(async (timeUp: boolean, away: false | 'closed' | 'prompt' = false) => {
    const cur = aRef.current;
    if (!cur || cur.status !== 'active' || elsewhereRef.current) return;
    const e = elapsed();
    stopClock();
    const view = viewOf(cur);
    const viewById = new Map(view.map((q) => [q.id, q]));
    const done = finishAttempt(cur, view, Date.now(), e, timeUp);
    aRef.current = done;
    setA(done);
    setNavOpen(false);
    setConfirm(null);
    try {
      await saver.flush();
      await saveAttempt(done);
      if (done.mode === 'exam') {
        await recordMany(done.questionIds.map((id) => {
          const q = viewById.get(id)!;
          const r = responseOf(done, id);
          return { q, response: r, correct: grade(q, r).correct, ms: done.timeByQuestion[id] };
        }), { mode: 'mock-exam', attemptId: done.id });
      }
      setHistory((await listAttempts()).filter((x) => x.status === 'finished'));
    } catch {
      setSaveError('The result could not be saved in this browser (storage is blocked). You can still read it here.');
    }
    setNotice(away === 'closed' ? 'The time ran out while the page was closed, like on the real exam. Your answers were submitted automatically.'
      : away === 'prompt' ? 'The time ran out before you resumed. Your answers were submitted automatically.'
        : timeUp ? 'Time is up. Your answers were submitted automatically.' : '');
    setPhase('results');
    window.scrollTo({ top: 0 });
  }, [elapsed, saver, viewOf]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // ---------------------------------------------------------------- navigation
  function focusQuestion() {
    requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    });
  }
  const go = (i: number) => {
    commit((x) => goTo(x, i, elapsed()));
    setPhase('running');
    setNavOpen(false);
    focusQuestion();
  };
  const cancelSubmit = () => {
    setConfirm(null);
    requestAnimationFrame(() => document.getElementById('ex-submit-btn')?.focus());
  };
  const toReview = () => {
    commit((x) => openReview(x, elapsed()));
    setNavOpen(false);
    setPhase('review');
    requestAnimationFrame(() => { document.getElementById('ex-review-h')?.focus(); window.scrollTo({ top: 0 }); });
  };

  // the questions as the current attempt shows them
  const aId = a?.id; const aSeed = a?.seed; const aShuffle = a?.shuffle;
  const view = useMemo(() => (aId !== undefined ? viewOf({ seed: aSeed!, shuffle: aShuffle } as Attempt) : questions), [aId, aSeed, aShuffle, viewOf, questions]);
  const viewById = useMemo(() => new Map(view.map((q) => [q.id, q])), [view]);

  // ---------------------------------------------------------------- render: no attempt yet
  const top = (
    <header className="ex-top ex-top-plain">
      <a className="ex-brand" href={homeHref}>Model Citizen</a>
      <span className="ex-sep" aria-hidden="true">/</span>
      <a href={examsHref}>Mock exams</a>
      <span className="ex-sep" aria-hidden="true">/</span>
      <span className="ex-title">{mock.title}</span>
    </header>
  );

  if (phase === 'loading') return <div className="ex ex-plain">{top}<div className="ex-body"><p className="ex-muted">Loading your mock exam…</p></div></div>;

  if (phase === 'nostorage') {
    return (
      <div className="ex ex-plain">{top}
        <div className="ex-body">
          <h1>{mock.title}</h1>
          <p className="ex-alert" role="alert">This browser does not let the site save data (private mode, or storage is blocked for this site). The mock exam needs it to save your answers and the time left. Open the site in a normal window, or allow storage for this site, then reload the page.</p>
        </div>
      </div>
    );
  }

  if (phase === 'start' || phase === 'resume') {
    const prog = pending ? progressOf(pending, questions) : null;
    return (
      <div className="ex ex-plain">{top}
        <div className="ex-body ex-start">
          <h1>{mock.title}</h1>
          <p className="ex-lead">{mock.description}</p>
          <p className="ex-facts"><span>{questions.length} questions</span><span>{mock.durationMin} minutes</span><span>Pass line 65%</span><span>The book's target: 80%</span></p>
          {sample && <p className="ex-sample">Sample: only {questions.length} questions of this mock are available until the full question bank is converted.</p>}
          {!sample && missing > 0 && <p className="ex-sample">{missing === 1 ? '1 question' : `${missing} questions`} of this mock {missing === 1 ? 'is' : 'are'} left out for now: {missing === 1 ? 'its answer key is' : 'their answer keys are'} still being checked.</p>}
          {phase === 'resume' && pending && prog && (
            <section className="ex-resume" aria-labelledby="ex-resume-h">
              <h2 id="ex-resume-h">You have a mock exam in progress</h2>
              <p>
                Started on {dateTime(pending.startedAt)} in {pending.mode === 'exam' ? 'exam' : 'practice'} mode.
                {' '}{prog.answered} of {questions.length} questions answered.
                {pending.mode === 'exam' ? ` ${spoken(remainingMs(pending, elapsedAt(pending, now)))} left (${clock(remainingMs(pending, elapsedAt(pending, now)))}).` : ` Time used: ${clock(pending.elapsedMs)}.`}
              </p>
              {pending.mode === 'exam' && (
                <p className="ex-muted ex-small">
                  {pending.clock === 'wall'
                    ? 'The timer kept running while the page was closed, like on the real exam. It is still running now.'
                    : 'The timer was paused while the page was closed (your setting when you started).'}
                </p>
              )}
              <p className="ex-row">
                <button type="button" className="ex-btn ex-btn-primary" onClick={resume}>Resume where you stopped</button>
                <button type="button" className="ex-btn" onClick={() => setConfirm('restart')}>Start again</button>
              </p>
              {confirm === 'restart' && (
                <div className="ex-confirm" role="alertdialog" aria-labelledby="ex-restart-q">
                  <p id="ex-restart-q">Start again? The attempt in progress ends and is not scored.</p>
                  <p className="ex-row">
                    <button type="button" className="ex-btn ex-btn-danger" onClick={async () => { if (pending) await abandonAttempt(pending.id); setPending(null); setConfirm(null); setPhase('start'); }}>Yes, end it</button>
                    <button type="button" className="ex-btn" onClick={() => setConfirm(null)}>Cancel</button>
                  </p>
                </div>
              )}
            </section>
          )}
          {phase === 'start' && (
            <div className="ex-modes">
              <section className="ex-mode-card" aria-labelledby="ex-m-exam">
                <h2 id="ex-m-exam">Exam mode</h2>
                <ul>
                  <li>A {mock.durationMin}-minute timer. At 0, your answers are submitted.</li>
                  <li>One question per screen. No feedback until the end.</li>
                  <li>Flag questions for review and come back to them with the navigator.</li>
                  <li>DOMC: options come one at a time; an answered option cannot be changed. A question can end early.</li>
                  <li>Every answer and the time left are saved.{' '}
                    {pauseOnClose
                      ? 'If you close the page, the timer stops (your setting) and you can resume later.'
                      : 'If you close the page, the time keeps passing, like on the real exam: come back before the end, or your answers are submitted when the time is over.'}
                  </li>
                </ul>
                <button type="button" className="ex-btn ex-btn-primary" onClick={() => begin('exam')}>Start in exam mode</button>
              </section>
              <section className="ex-mode-card" aria-labelledby="ex-m-practice">
                <h2 id="ex-m-practice">Practice mode</h2>
                <ul>
                  <li>The same questions, with feedback and the explanation after each answer.</li>
                  <li>No time limit: the time you use is shown.</li>
                  <li>Mistakes go to your error notebook and your review queue.</li>
                </ul>
                <button type="button" className="ex-btn" onClick={() => begin('practice')}>Start in practice mode</button>
              </section>
            </div>
          )}
          <p className="ex-muted ex-small">
            DOMC settings: {rules.extraOption ? 'one extra option can appear after a question is decided, like on the real exam' : 'no extra option after a question is decided'}.
            {' '}Timer: {pauseOnClose ? 'it stops when you close the page' : 'it keeps running when you close the page'}. <a href={settingsHref}>Change these in Settings</a>.
            {' '}Tips from the book: read every DOMC stem twice, and never leave a question empty: a blank is always wrong.
            {' '}The book's multiple-select questions ask for two answers; the real exam can ask for two or three, and it tells you how many.
          </p>
        </div>
      </div>
    );
  }

  if (!a) return null;

  if (phase === 'results') {
    return (
      <div className="ex ex-plain">{top}
        <div className="ex-body ex-results-body">
          {notice && <p className="ex-alert" role="alert">{notice}</p>}
          {saveError && <p className="ex-alert" role="alert">{saveError}</p>}
          <Results attempt={a} questions={view} links={links} history={history} title={mock.title} examsHref={examsHref} />
          <p className="ex-row ex-after">
            <button type="button" className="ex-btn ex-btn-primary" onClick={() => { setA(null); setPhase('start'); window.scrollTo({ top: 0 }); }}>Take this mock again</button>
            <a className="ex-btn" href={examsHref}>All mock exams</a>
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- render: running / review
  const q = viewById.get(a.questionIds[a.current])!;
  const domcState = q.format === 'domc' ? domcOf(a, q) : undefined;
  const response = responseOf(a, q.id);
  const flagged = a.flags.includes(q.id);
  const practice = a.mode === 'practice';
  const checked = practice && (a.checked ?? []).includes(q.id);
  const g = checked ? grade(q, response) : null;
  const total = a.questionIds.length;
  const navItems: NavItem[] = a.questionIds.map((id) => {
    const qq = viewById.get(id)!;
    const r = responseOf(a, id);
    const st = qq.format === 'domc' ? domcOf(a, qq) : undefined;
    return { id, answered: isComplete(qq, r, st, blanksOf(qq)), started: isAnswered(r), flagged: a.flags.includes(id) };
  });
  const prog = progressOf(a, view);

  const onJudge = (yes: boolean) => {
    if (!domcState || domcState.done || checked) return;
    const next = domcJudge(q, domcState, rules, yes);
    commit((x) => setDomc(x, q, next));
    if (practice && next.done) check(next.judgments);
  };

  function check(judgments?: Record<string, boolean>) {
    const cur = aRef.current;
    if (!cur) return;
    const r = judgments ? { format: 'domc' as const, judgments } : responseOf(cur, q.id);
    commit((x) => markChecked(x, q.id));
    const ms = (cur.timeByQuestion[q.id] ?? 0) + Math.max(0, elapsed() - (cur.markMs ?? cur.elapsedMs));
    recordOutcome(q, r, grade(q, r).correct, { mode: 'mock-practice', attemptId: cur.id, ms }).catch(() => undefined);
    requestAnimationFrame(() => { feedbackRef.current?.focus({ preventScroll: true }); feedbackRef.current?.scrollIntoView({ block: 'start' }); });
  }

  const header = (
    <header className="ex-top">
      <span className="ex-title">{mock.title}</span>
      <span className="ex-mode">{practice ? 'Practice mode, feedback after each question' : 'Exam mode, no feedback until the end'}</span>
      <Timer mode={a.mode} durationMs={a.durationMs} getElapsed={elapsed} onTimeUp={() => finish(true)} running={clockRef.current.running} />
      <span className="ex-count">{phase === 'review' ? `${prog.answered} of ${total} answered` : `Question ${a.current + 1} of ${total}`}</span>
    </header>
  );

  if (elsewhere) {
    return (
      <div className="ex ex-plain">{top}
        <div className="ex-body">
          <h1>{mock.title}</h1>
          <p className="ex-alert" role="alert">This mock exam is now open in another tab or window. To keep your answers safe, only one of them can be used: this one has stopped. Go on in the other one, or use this one instead.</p>
          <p className="ex-row"><button type="button" className="ex-btn ex-btn-primary" onClick={() => location.reload()}>Use it in this tab</button></p>
        </div>
      </div>
    );
  }

  if (phase === 'review') {
    const list = (ids: string[]) => (
      <ul className="ex-chips">
        {ids.map((id) => {
          const i = a.questionIds.indexOf(id);
          return <li key={id}><button type="button" className="ex-chip" onClick={() => go(i)}>Question {i + 1}</button></li>;
        })}
      </ul>
    );
    return (
      <div className="ex" data-mode={a.mode}>
        {header}
        <div className="ex-body">
          <h1 id="ex-review-h" tabIndex={-1}>Review before you submit</h1>
          <p className="ex-lead">You answered <b>{prog.answered} of {total}</b> questions.{a.mode === 'exam' ? ' The timer is still running.' : ''}</p>
          <section className="ex-rev-sec" aria-labelledby="ex-rev-un">
            <h2 id="ex-rev-un">Not answered ({prog.unanswered.length})</h2>
            {prog.unanswered.length ? <>{list(prog.unanswered)}<p className="ex-muted">A blank answer is always wrong. Choose your best guess: there is no penalty.</p></> : <p className="ex-muted">None. Every question has an answer.</p>}
          </section>
          {prog.incomplete.length > 0 && (
            <section className="ex-rev-sec" aria-labelledby="ex-rev-in">
              <h2 id="ex-rev-in">Started but not finished ({prog.incomplete.length})</h2>
              {list(prog.incomplete)}
              <p className="ex-muted">For example a multiple select with too few choices, a matching with empty items, or a DOMC question with options left.</p>
            </section>
          )}
          <section className="ex-rev-sec" aria-labelledby="ex-rev-fl">
            <h2 id="ex-rev-fl">Flagged for review ({prog.flagged.length})</h2>
            {prog.flagged.length ? list(prog.flagged) : <p className="ex-muted">None.</p>}
          </section>
          {confirm === 'submit' ? (
            // the focus goes to the question, not to "Yes, submit": a second Enter must not end the exam
            <div className="ex-confirm" role="alertdialog" aria-labelledby="ex-submit-q" aria-describedby="ex-submit-d" tabIndex={-1}
              ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelSubmit(); } }}>
              <p id="ex-submit-q"><b>Submit the exam now?</b></p>
              <p id="ex-submit-d">You cannot change your answers after this. Press Escape to go back.</p>
              <p className="ex-row">
                <button type="button" className="ex-btn ex-btn-primary" onClick={() => finish(false)}>Yes, submit</button>
                <button type="button" className="ex-btn" onClick={cancelSubmit}>Cancel</button>
              </p>
            </div>
          ) : (
            <p className="ex-row">
              <button type="button" className="ex-btn ex-btn-primary" id="ex-submit-btn" onClick={() => setConfirm('submit')}>Submit the exam</button>
              <button type="button" className="ex-btn" onClick={() => go(a.current)}>Back to the questions</button>
            </p>
          )}
        </div>
      </div>
    );
  }

  const last = a.current === total - 1;
  return (
    <div className="ex" data-mode={a.mode}>
      {header}
      <div className="ex-body" onClickCapture={(e) => { if (!practice && (e.target as HTMLElement).closest('.ex-question a')) e.preventDefault(); }}>
        <h2 className="visually-hidden" ref={headingRef} tabIndex={-1}>Question {a.current + 1} of {total}{flagged ? ', flagged for review' : ''}</h2>
        {flagged && <p className="ex-flag-note"><IconFlag filled /> Flagged for review</p>}
        <div className="ex-question">
          <QuestionView
            key={q.id}
            q={q}
            name={`ex-${q.id}`}
            response={response}
            onResponse={(r) => { if (!checked) commit((x) => setResponse(x, q.id, r)); }}
            domc={domcState ? { state: domcState, rules, onJudge, letters: checked, keys: !checked && !navOpen } : undefined}
            review={checked}
            exam
          />
        </div>
        {practice && !checked && q.format !== 'domc' && (
          <p className="ex-row ex-check">
            <button type="button" className="ex-btn ex-btn-primary" onClick={() => check()}>{isAnswered(response) ? 'Check answer' : 'Show the answer'}</button>
          </p>
        )}
        {checked && g && <Feedback ref={feedbackRef} q={q} response={response} correct={g.correct} />}
        {saveError && <p className="ex-alert" role="alert">{saveError}</p>}
      </div>
      <div className="ex-dock">
        {navOpen && <Navigator id="ex-navpanel" items={navItems} current={a.current} onGo={go} onReview={toReview} />}
        <footer className="ex-foot">
          <button type="button" className="ex-btn" data-flag aria-pressed={flagged} onClick={() => commit((x) => toggleFlag(x, q.id))}>
            <IconFlag filled={flagged} /> {flagged ? 'Flagged' : 'Flag for review'}
          </button>
          <button type="button" className="ex-btn" aria-expanded={navOpen} aria-controls="ex-navpanel" onClick={() => setNavOpen((o) => !o)}>
            All questions
          </button>
          <span className="ex-sp" />
          <button type="button" className="ex-btn" disabled={a.current === 0} onClick={() => go(a.current - 1)}>Previous</button>
          {last
            ? <button type="button" className="ex-btn ex-btn-primary" onClick={toReview}>Review and submit</button>
            : <button type="button" className="ex-btn ex-btn-primary" onClick={() => go(a.current + 1)}>Next</button>}
        </footer>
      </div>
    </div>
  );
}
