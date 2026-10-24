// Dashboard: everything this browser knows about the learner's progress, on one page.
// Readiness (the book's four conditions), totals, mastery per exam objective, study time, mock history, chapters.
// Charts follow the dataviz method used on the results pages: one hue, thin marks, hover/focus tooltip, a table twin.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, today, streakFrom, type Settings } from '../../lib/store/db';
import { readiness } from '../../lib/planner';
import { capstoneDone, labsDone, lessonsDone, masteryByObjective, minutesByDay, mocksAt80, quizzesAt80, type Mastery } from '../../lib/progress-summary';
import { HistoryChart } from '../exam/charts';
import type { Attempt } from '../../lib/exam/engine';
import { url } from '../../lib/url';
import XpBadgesPanel from '../delight/XpBadgesPanel';
import '../exam/exam.css';
import './dashboard.css';

export interface DashObjective { id: string; topic: number; title: string; chapters: string[] }
export interface DashChapter { id: string; number: number; title: string; path: string; quizPath?: string; lessons: string[]; labs: string[] }

export interface DashboardProps {
  topics: { n: number; title: string; short: string; blueprint?: number }[];
  objectives: DashObjective[];
  questionObjectives: Record<string, string>;
  chapterQuiz: [string, number][];
  chapters: DashChapter[];
  labSteps: Record<string, number>;
  labTitles: Record<string, string>;
  capstoneMilestones: number;
  /** every lesson of the site, like the path page counts them */
  totalLessons: number;
}

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function hours(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
/** Heatmap bin for a share of correct answers: 0 = no answers yet, then four ordered steps. */
function bin(m: Mastery | undefined): 0 | 1 | 2 | 3 | 4 {
  if (!m || !m.answered) return 0;
  const p = (100 * m.correct) / m.answered;
  return p >= 80 ? 4 : p >= 65 ? 3 : p >= 50 ? 2 : 1;
}
const BIN_LABEL = ['No answers yet', 'Under 50%', '50 to 64%', '65 to 79%', '80% or more'];

export default function DashboardApp(p: DashboardProps) {
  const [storeError, setStoreError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => { getSettings().then(setSettings).catch(() => setStoreError('This browser does not let the site save progress (private window or blocked storage), so there is nothing to show yet.')); }, []);

  const progress = useLiveQuery(() => db().progress.toArray(), [], []);
  const answers = useLiveQuery(() => db().answers.toArray(), [], []);
  const attempts = useLiveQuery(() => db().examAttempts.toArray(), [], []);
  const activity = useLiveQuery(() => db().activity.toArray(), [], []);
  const dueCards = useLiveQuery(() => db().srs.where('due').belowOrEqual(today()).count(), [], 0);
  const cards = useLiveQuery(() => db().srs.count(), [], 0);
  const notes = useLiveQuery(() => db().notes.where('kind').equals('error').count(), [], 0);

  const chapterQuiz = useMemo(() => new Map(p.chapterQuiz), [p.chapterQuiz]);
  const mastery = useMemo(() => masteryByObjective(answers, p.questionObjectives), [answers, p.questionObjectives]);

  if (storeError) return <div className="t-notice" role="status">{storeError}</div>;
  if (!settings) return <div className="t-loading" aria-busy="true">Loading your progress…</div>;

  const lessonSet = lessonsDone(progress);
  const labs = labsDone(progress, p.labSteps);
  const totalLabs = Object.keys(p.labSteps).length;
  const quizzes = quizzesAt80(progress, answers, chapterQuiz);
  const mocksOk = mocksAt80(attempts);
  const capstone = capstoneDone(progress, p.labSteps);
  const r = readiness({
    quizzes: { ok: quizzes.ok, total: quizzes.total },
    capstone: { ok: capstone, total: p.capstoneMilestones },
    mocks: { ok: Math.min(2, mocksOk), total: 2 },
    notebook: { reread: !!settings.notebookReread, notes },
  });

  const answeredQ = new Set(answers.map((a) => a.qid));
  const totalQ = Object.keys(p.questionObjectives).length;
  const latestRight = [...mastery.values()].reduce((n, m) => n + m.correct, 0);
  const latestAnswered = [...mastery.values()].reduce((n, m) => n + m.answered, 0);
  const minutesTotal = activity.reduce((n, a) => n + a.minutes, 0);
  const last28 = minutesByDay(activity, 28);
  const week = last28.slice(-7).reduce((n, d) => n + d.minutes, 0);
  const streak = streakFrom(activity.filter((a) => a.events > 0).map((a) => a.date));
  const finished = (attempts as Attempt[]).filter((a) => a.status === 'finished' && a.score).sort((a, b) => b.startedAt - a.startedAt);
  const nothingYet = !progress.length && !answers.length && !attempts.length;

  // The objectives to work on next: the weakest ones with answers, then the heaviest topics not started.
  const weight = new Map(p.topics.map((t) => [t.n, t.blueprint ?? 0]));
  const scored = p.objectives.map((o) => ({ o, m: mastery.get(o.id)! })).filter(({ m }) => m && m.available > 0);
  const weak = scored.filter(({ m }) => m.answered && m.correct / m.answered < 0.8).sort((a, b) => a.m.correct / a.m.answered - b.m.correct / b.m.answered);
  const fresh = scored.filter(({ m }) => !m.answered).sort((a, b) => (weight.get(b.o.topic) ?? 0) - (weight.get(a.o.topic) ?? 0) || b.m.available - a.m.available);
  const focus = [...weak, ...fresh].slice(0, 4);
  const chapterById = new Map(p.chapters.map((c) => [c.id, c]));

  return (
    <div className="db">
      <header className="db-head">
        <div>
          <h1>Your progress</h1>
          <p>Everything you have done in this browser. It stays here: to keep it safe or move it to another computer, save a progress file in <a href={url('settings/')}>Settings</a>.</p>
        </div>
      </header>

      {nothingYet && (
        <p className="db-empty-all">Nothing to show yet. Start with <a href={url('')}>today’s mission</a> or <a href={url('path/')}>the course path</a>: every lesson, lab, quiz and mock exam you finish appears here.</p>
      )}

      <section className="db-ready panel" aria-labelledby="ready-h">
        <div className="db-ready-head">
          <h2 id="ready-h">Ready to book the exam?</h2>
          <p className={r.ready ? 'db-verdict ok' : 'db-verdict'}>{r.ready ? 'Yes. All four conditions from the book are met.' : `${[r.quizzes.total > 0 && r.quizzes.ok >= r.quizzes.total, r.capstone.ok >= r.capstone.total, r.mocks.ok >= 2, r.notebook.reread].filter(Boolean).length} of 4 conditions met`}</p>
        </div>
        <ul className="db-gates">
          <Gate ok={r.quizzes.total > 0 && r.quizzes.ok >= r.quizzes.total} label="Every chapter quiz at 80% or more" value={`${r.quizzes.ok} of ${r.quizzes.total}`} fill={pct(r.quizzes.ok, r.quizzes.total)} href={url('quiz/')} />
          <Gate ok={r.capstone.ok >= r.capstone.total} label="The capstone project finished" value={`${r.capstone.ok} of ${r.capstone.total} milestones`} fill={pct(r.capstone.ok, r.capstone.total)} href={url('labs/capstone/')} />
          <Gate ok={r.mocks.ok >= 2} label="Two different timed mocks at 80% or more" value={`${r.mocks.ok} of 2`} fill={pct(r.mocks.ok, 2)} href={url('exams/')} />
          <Gate ok={r.notebook.reread} label="Error notebook re-read" value={r.notebook.reread ? `Done on ${settings.notebookReread}` : plural(notes, 'note')} fill={r.notebook.reread ? 100 : 0} href={url('practice/notebook/')} />
        </ul>
      </section>

      <section aria-labelledby="totals-h">
        <h2 id="totals-h" className="visually-hidden">Totals</h2>
        <dl className="db-tiles">
          <Tile label="Lessons done" value={`${lessonSet.size}`} of={`of ${p.totalLessons}`} fill={pct(lessonSet.size, p.totalLessons)} />
          <Tile label="Labs done" value={`${labs.done.size}`} of={`of ${totalLabs}`} fill={pct(labs.done.size, totalLabs)} note={labs.started.size > labs.done.size ? `${labs.started.size - labs.done.size} started` : undefined} />
          <Tile label="Questions answered" value={`${answeredQ.size}`} of={`of ${totalQ}`} fill={pct(answeredQ.size, totalQ)} note={latestAnswered ? `${pct(latestRight, latestAnswered)}% right on the last try` : undefined} />
          <Tile label="Study time" value={hours(minutesTotal)} note={`${hours(week)} in the last 7 days`} />
          <Tile label="Streak" value={plural(streak, 'day')} note={streak ? 'Keep it going today' : 'Study today to start one'} />
          <Tile label="Review cards due" value={`${dueCards}`} note={cards ? `${plural(cards, 'card')} in your deck` : 'Cards come from your mistakes'} href={dueCards ? url('practice/flashcards/') : undefined} />
        </dl>
      </section>

      <XpBadgesPanel variant="full" id="badges" headingLevel={2} />

      <section className="panel db-panel" aria-labelledby="mastery-h">
        <div className="db-panel-head">
          <h2 id="mastery-h">Mastery by exam objective</h2>
          <p>Share of right answers, counting your last try at each question. Hover or focus a square for details.</p>
        </div>
        <Heatmap topics={p.topics} objectives={p.objectives} mastery={mastery} />
        {focus.length > 0 && (
          <div className="db-focus">
            <h3>Work on next</h3>
            <ul>
              {focus.map(({ o, m }) => {
                const ch = chapterById.get(o.chapters[0]);
                return (
                  <li key={o.id}>
                    <span className="db-obj-id">{o.id}</span>
                    <span className="db-focus-t">{o.title}</span>
                    <span className="db-focus-m">{m.answered ? `${pct(m.correct, m.answered)}% right (${m.answered} answered)` : `${plural(m.available, 'question')}, none answered`}</span>
                    {ch && <a href={url(ch.path)}>Chapter {ch.number}</a>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="panel db-panel" aria-labelledby="time-h">
        <div className="db-panel-head">
          <h2 id="time-h">Study time, last 4 weeks</h2>
          <p>Minutes counted while a lesson, lab, quiz or exam page is open and in use. Your daily goal is {settings.dailyMinutes} minutes (<a href={url('settings/')}>change</a>).</p>
        </div>
        <MinutesChart days={last28} goal={settings.dailyMinutes} />
      </section>

      <section className="panel db-panel" aria-labelledby="mocks-h">
        <div className="db-panel-head">
          <h2 id="mocks-h">Mock exams</h2>
          <p>The book’s rule: book the exam after two different mocks at 80% or more in timed exam mode.</p>
        </div>
        {finished.length ? (
          <>
            <HistoryChart attempts={finished} />
            <table className="db-table db-attempts">
              <caption className="visually-hidden">Finished mock exams, newest first</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Exam</th><th scope="col">Mode</th><th scope="col">Score</th><th scope="col"><span className="visually-hidden">Results</span></th></tr></thead>
              <tbody>
                {finished.slice(0, 12).map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td>{a.mock ? `Mock ${a.mock}` : 'Custom drill'}</td>
                    <td>{a.mode === 'exam' ? 'Timed exam' : 'Practice'}</td>
                    <td className="db-num"><b>{Math.floor(a.score!.pct)}%</b> <span className="db-muted">({a.score!.correct} of {a.score!.total})</span></td>
                    <td><a href={url(`exams/attempt/?id=${encodeURIComponent(a.id)}`)}>Results</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="db-empty">No finished mock exam yet. The plan schedules the first one in week 11; you can <a href={url('exams/')}>look at the mock exams</a> any time.</p>
        )}
      </section>

      <section className="panel db-panel" aria-labelledby="chapters-h">
        <div className="db-panel-head">
          <h2 id="chapters-h">Chapters</h2>
          <p>Lessons marked done, labs with every step ticked, and your best chapter quiz score.</p>
        </div>
        <div className="db-scroll">
          <table className="db-table db-chapters">
            <caption className="visually-hidden">Progress per chapter</caption>
            <thead><tr><th scope="col">Chapter</th><th scope="col">Lessons</th><th scope="col">Labs</th><th scope="col">Quiz</th></tr></thead>
            <tbody>
              {p.chapters.map((c) => {
                const ld = c.lessons.filter((l) => lessonSet.has(l)).length;
                const lb = c.labs.filter((l) => labs.done.has(l)).length;
                const best = quizzes.best.get(c.id);
                const qn = chapterQuiz.get(c.id);
                const done = c.lessons.length > 0 && ld === c.lessons.length && lb === c.labs.length && (!qn || (best ?? 0) >= 0.8);
                return (
                  <tr key={c.id} className={done ? 'is-done' : undefined}>
                    <th scope="row"><a href={url(c.path)}><span className="db-ch-n">{c.number}</span> {c.title}</a></th>
                    <td><Mini a={ld} b={c.lessons.length} /></td>
                    <td>{c.labs.length ? <Mini a={lb} b={c.labs.length} /> : <span className="db-muted">none</span>}</td>
                    <td className="db-num">{qn ? (best !== undefined ? <a href={c.quizPath ? url(c.quizPath) : undefined} className={best >= 0.8 ? 'db-q ok' : 'db-q'}>{Math.round(best * 100)}%</a> : c.quizPath ? <a href={url(c.quizPath)} className="db-muted">not taken</a> : '') : <span className="db-muted">none</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Gate({ ok, label, value, fill, href }: { ok: boolean; label: string; value: string; fill: number; href: string }) {
  return (
    <li className={ok ? 'db-gate ok' : 'db-gate'}>
      <span className="db-gate-icon" aria-hidden="true">{ok ? '✓' : ''}</span>
      <span className="db-gate-label"><a href={href}>{label}</a><span className="visually-hidden">{ok ? ': met' : ': not met yet'}</span></span>
      <span className="db-gate-value">{value}</span>
      <span className="db-gate-bar" aria-hidden="true"><span style={{ width: `${fill}%` }} /></span>
    </li>
  );
}

function Tile({ label, value, of, note, fill, href }: { label: string; value: string; of?: string; note?: string; fill?: number; href?: string }) {
  return (
    <div className="db-tile">
      <dt>{label}</dt>
      <dd>
        <span className="db-tile-v">{href ? <a href={href}>{value}</a> : value}{of && <span className="db-tile-of"> {of}</span>}</span>
        {fill !== undefined && <span className="db-tile-bar" aria-hidden="true"><span style={{ width: `${fill}%` }} /></span>}
        {note && <span className="db-tile-note">{note}</span>}
      </dd>
    </div>
  );
}

function Mini({ a, b }: { a: number; b: number }) {
  return (
    <span className="db-mini">
      <span className="db-num">{a} of {b}</span>
      <span className="db-mini-bar" aria-hidden="true"><span style={{ width: `${pct(a, b)}%` }} /></span>
    </span>
  );
}

interface Tip { x: number; y: number; text: string; sub: string }

function Heatmap({ topics, objectives, mastery }: { topics: DashboardProps['topics']; objectives: DashObjective[]; mastery: Map<string, Mastery> }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [table, setTable] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const show = (el: HTMLElement, o: DashObjective) => {
    const m = mastery.get(o.id);
    const box = boxRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    setTip({
      x: Math.max(130, Math.min(box.width - 130, r.left + r.width / 2 - box.left)), y: r.top - box.top,
      text: `${o.id} ${o.title}`,
      sub: !m || !m.answered ? `${plural(m?.available ?? 0, 'question')}, none answered yet` : `${pct(m.correct, m.answered)}% right: ${m.correct} of ${m.answered} answered (${m.available} in the course)`,
    });
  };
  const rows = topics.map((t) => ({ t, objs: objectives.filter((o) => o.topic === t.n && (mastery.get(o.id)?.available ?? 0) > 0) })).filter((r) => r.objs.length);
  return (
    <div className="db-heat-wrap">
      <div className="db-heat viz-box" ref={boxRef} onPointerLeave={() => setTip(null)} hidden={table}>
        {rows.map(({ t, objs }) => (
          <div className="db-heat-row" key={t.n}>
            <div className="db-heat-topic"><b>{t.n ? `Topic ${t.n}` : 'Before dbt'}</b><span>{t.short}{t.blueprint ? `, ${t.blueprint}% of the exam` : ''}</span></div>
            <ul className="db-heat-cells">
              {objs.map((o) => {
                const m = mastery.get(o.id);
                const b = bin(m);
                const label = `${o.id} ${o.title}: ${!m || !m.answered ? 'no answers yet' : `${pct(m.correct, m.answered)}% right, ${m.answered} of ${m.available} answered`}`;
                return (
                  <li key={o.id}>
                    <span className="db-cell" data-bin={b} tabIndex={0} role="img" aria-label={label}
                      onPointerEnter={(e) => show(e.currentTarget, o)} onFocus={(e) => show(e.currentTarget, o)} onBlur={() => setTip(null)}>
                      <span className="db-cell-id">{o.id.replace('CP0-', '')}</span>
                      <span className="db-cell-v">{m && m.answered ? `${pct(m.correct, m.answered)}%` : '–'}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {tip && <div className="viz-tip db-heat-tip" style={{ left: tip.x, top: tip.y }} role="presentation"><b>{tip.text}</b><span>{tip.sub}</span></div>}
      </div>
      {table && (
        <div className="db-scroll">
          <table className="db-table">
            <caption className="visually-hidden">Mastery by exam objective</caption>
            <thead><tr><th scope="col">Objective</th><th scope="col">Answered</th><th scope="col">Right</th></tr></thead>
            <tbody>
              {rows.flatMap(({ objs }) => objs).map((o) => {
                const m = mastery.get(o.id)!;
                return (
                  <tr key={o.id}>
                    <th scope="row"><span className="db-obj-id">{o.id}</span> {o.title}</th>
                    <td className="db-num">{m.answered} of {m.available}</td>
                    <td className="db-num">{m.answered ? `${pct(m.correct, m.answered)}%` : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="db-heat-foot">
        <ul className="db-heat-legend" aria-label="Legend">
          {BIN_LABEL.map((l, i) => <li key={i}><span className="db-cell db-key" data-bin={i} aria-hidden="true" />{l}</li>)}
        </ul>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setTable(!table)}>{table ? 'Show as squares' : 'Show as a table'}</button>
      </div>
    </div>
  );
}

function MinutesChart({ days, goal }: { days: { date: string; minutes: number }[]; goal: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [table, setTable] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const set = () => setW(Math.max(280, el.clientWidth));
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const H = 190, L = 44, R = 10, T = 16, B = 26;
  const max = Math.max(goal * 1.2, ...days.map((d) => d.minutes));
  const step = max > 300 ? 120 : max > 150 ? 60 : 30;
  const top = Math.ceil(max / step) * step;
  const y = (m: number) => T + (H - T - B) * (1 - m / top);
  const band = (W - L - R) / days.length;
  const bw = Math.max(3, Math.min(18, band - 4));
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const label = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const long = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const total = days.reduce((n, d) => n + d.minutes, 0);
  const active = days.filter((d) => d.minutes > 0).length;
  const every = W < 520 ? 7 : W < 800 ? 4 : 2;
  return (
    <div>
      {!table && (
        <div className="viz-box db-minutes" ref={boxRef} onPointerLeave={() => setTip(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={`Study minutes per day for the last 28 days: ${hours(total)} on ${plural(active, 'day')}. Daily goal ${goal} minutes.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="viz-grid" />
                <text x={L - 6} y={y(t) + 4} className="viz-tick" textAnchor="end">{t === 0 ? '0' : t % 60 === 0 ? `${t / 60} h` : `${t} min`}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = L + i * band + (band - bw) / 2;
              const h = Math.max(0, y(0) - y(d.minutes));
              const rr = Math.min(4, bw / 2, h);
              const yy = y(d.minutes);
              const onShow = () => setTip({ x: Math.max(70, Math.min(W - 70, L + i * band + band / 2)), y: Math.min(yy, y(0) - 2), text: d.minutes ? hours(d.minutes) : 'No study', sub: long(d.date) + (d.date === today() ? ' (today)' : '') });
              return (
                <g key={d.date} className="viz-col" onPointerEnter={onShow}>
                  <rect className="viz-hit" x={L + i * band} y={T} width={band} height={H - T - B} fill="transparent" />
                  {h > 0 && <path className="viz-mark" d={`M${x},${y(0)} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${y(0)} Z`} />}
                  {(days.length - 1 - i) % every === 0 && <text x={L + i * band + band / 2} y={H - 8} className="viz-tick" textAnchor="middle">{i === days.length - 1 ? 'Today' : label(d.date)}</text>}
                </g>
              );
            })}
            <line x1={L} x2={W - R} y1={y(goal)} y2={y(goal)} className="viz-ref" />
            <text x={W - R} y={y(goal) - 5} className="viz-ref-label" textAnchor="end">Goal {hours(goal)} a day</text>
            <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="viz-axis" />
          </svg>
          {tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="presentation"><b>{tip.text}</b><span>{tip.sub}</span></div>}
        </div>
      )}
      {table && (
        <div className="db-scroll">
          <table className="db-table">
            <caption className="visually-hidden">Study minutes per day, last 28 days</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">Study time</th></tr></thead>
            <tbody>{[...days].reverse().map((d) => <tr key={d.date}><th scope="row">{long(d.date)}</th><td className="db-num">{d.minutes ? hours(d.minutes) : '–'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="db-heat-foot">
        <p className="db-muted db-small">{total ? `${hours(total)} on ${plural(active, 'day')} in these 4 weeks.` : 'No study time counted yet.'}</p>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setTable(!table)}>{table ? 'Show as a chart' : 'Show as a table'}</button>
      </div>
    </div>
  );
}
