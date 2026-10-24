// Exam-day page island: countdown to the exam date (Settings), today's step of the book's last-7-days
// plan, the plan and the exam-day checklist as checklists that save, the four booking conditions with
// the learner's status, and the exam facts. All texts are the book's (passed by the page).
import { useEffect, useId, useMemo, useState } from 'react';
import type { Block, Inline as InlineT } from '../../lib/content-types';
import { getSettings, saveSettings, today, db } from '../../lib/store/db';
import { daysUntil, isIsoDate, loadTicks, longDate, planDayLabel, readinessFromData, saveTicks, toggle } from '../../lib/exam-day';
import { Inline } from '../content/Inline';
import { Blocks } from '../content/Blocks';
import { Callout } from '../content/Callout';
import { useLive } from './data';
import './delight.css';

export interface ExamDayProps {
  weekIntro: InlineT[];
  weekHead: string[];
  week: { id: string; day: string; days: number | null; what: InlineT[]; done: InlineT[] }[];
  trap: Block[];
  checklistIntro: InlineT[];
  groups: { id: string; title: string; items: { id: string; c: InlineT[] }[] }[];
  facts: { item: string; details: InlineT[] }[];
  readinessIntro: InlineT[];
  readinessAfter: InlineT[];
  conditions: InlineT[][];
  chapterQuiz: [string, number][];
  /** capstone lab id -> ticks that finish it (same numbers as the Today page) */
  capstoneSteps: Record<string, number>;
  capstoneMilestones: number;
  links: Record<'week' | 'checklist' | 'after' | 'logistics' | 'quizzes' | 'capstone' | 'mocks' | 'notebook' | 'settings' | 'traps' | 'cheatsheets' | 'drills' | 'flashcards', string>;
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return today(new Date(y, m - 1, d + n));
}

function Check({ ok }: { ok: boolean }) {
  return (
    <span className="dl-tick" data-ok={ok || undefined} aria-hidden="true">
      {ok && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
  );
}

/** The last week as a lineage: D−7 feeds D−6 ... feeds D0. Past days are done, today is lit. */
function WeekLine({ days, ticked }: { days: number | null; ticked: Set<string> }) {
  const labels = [7, 6, 5, 4, 3, 2, 1, 0];
  return (
    <ol className="ed-line" aria-label="The last 7 days">
      {labels.map((n) => {
        const state = days === null || days > 7 ? undefined : n > days ? 'past' : n === days ? 'now' : undefined;
        return (
          <li key={n} data-state={state} data-ticked={ticked.has(`d${n}`) || undefined}>
            <span className="ed-line-node">{n === 0 ? 'D0' : `D−${n}`}</span>
            <span className="visually-hidden">{state === 'now' ? ', today' : ''}{ticked.has(`d${n}`) ? ', done' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ExamDayApp(p: ExamDayProps) {
  const uid = useId().replace(/:/g, '');
  const [examDate, setExamDate] = useState<string | null | undefined>(undefined); // undefined = loading
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [ticks, setTicks] = useState<{ week: string[]; checklist: string[] } | null>(null);
  const [undo, setUndo] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [dayKey, setDayKey] = useState(() => today());

  useEffect(() => {
    getSettings().then((s) => { setExamDate(s.examDate && isIsoDate(s.examDate) ? s.examDate : null); setDraft(s.examDate ?? ''); })
      .catch(() => { setExamDate(null); setError('This browser does not let the site save anything (private window or blocked storage). You can read the plan and the checklist, but your ticks will not be kept.'); });
    loadTicks().then((t) => setTicks({ week: t.week, checklist: t.checklist })).catch(() => setTicks({ week: [], checklist: [] }));
    const id = setInterval(() => setDayKey(today()), 60_000); // the countdown changes at midnight
    return () => clearInterval(id);
  }, []);

  const live = useLive(async () => ({
    answers: await db().answers.toArray(), attempts: await db().examAttempts.toArray(), progress: await db().progress.where('kind').anyOf('chapter', 'labstep').toArray(),
    notes: await db().notes.where('kind').equals('error').toArray(), settings: await db().settings.get('settings'),
  }), []).value;
  const ready = useMemo(() => (live ? readinessFromData(live, p.chapterQuiz, p.capstoneSteps, p.capstoneMilestones) : null), [live, p.chapterQuiz, p.capstoneSteps, p.capstoneMilestones]);

  const days = examDate ? daysUntil(examDate, dayKey) : null;
  const label = days !== null ? planDayLabel(days) : null;
  const todayRow = label ? p.week.find((w) => w.days === days) : undefined;
  const weekSet = new Set(ticks?.week ?? []);
  const checkSet = new Set(ticks?.checklist ?? []);
  const totalItems = p.groups.reduce((n, g) => n + g.items.length, 0);
  const perDay = /\(([^)]+)\)/.exec(p.weekHead[1] ?? '')?.[1];

  const persist = async (next: { week: string[]; checklist: string[] }) => {
    setTicks(next);
    try { await saveTicks(next); } catch { setError('Your ticks cannot be saved in this browser (private window or blocked storage).'); }
  };
  const tickWeek = (id: string, on: boolean) => ticks && persist({ ...ticks, week: toggle(ticks.week, id, on) });
  const tickItem = (id: string, on: boolean) => ticks && persist({ ...ticks, checklist: toggle(ticks.checklist, id, on) });

  const saveDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft && !isIsoDate(draft)) { setError('Choose a date with the date field.'); return; }
    try {
      const s = await saveSettings({ examDate: draft || undefined });
      setExamDate(s.examDate && isIsoDate(s.examDate) ? s.examDate : null);
      setEditing(false);
      setError('');
    } catch {
      setError('The date cannot be saved in this browser (private window or blocked storage).');
    }
  };

  const dateForm = (
    <form className="ed-date-form" onSubmit={saveDate}>
      <label htmlFor={`${uid}-date`}>Exam date</label>
      <input id={`${uid}-date`} type="date" value={draft} min={today()} onChange={(e) => setDraft(e.target.value)} />
      <button type="submit" className="btn btn-primary btn-small">Save the date</button>
      {examDate && <button type="button" className="btn btn-quiet btn-small" onClick={() => { setEditing(false); setDraft(examDate); }}>Cancel</button>}
      <p className="dl-small dl-muted ed-date-note">The same date as in <a href={p.links.settings}>Settings</a>. Your booking in Talview is the date that counts: check its time zone.</p>
    </form>
  );

  return (
    <div className="ed">
      {error && <p className="ed-error" role="alert">{error}</p>}

      <section className="ed-count panel" aria-labelledby={`${uid}-count-h`}>
        <h2 id={`${uid}-count-h`} className="visually-hidden">Countdown</h2>
        {examDate === undefined ? (
          <p className="dl-muted" aria-busy="true">Loading your exam date…</p>
        ) : examDate === null || editing ? (
          <div>
            <p className="ed-count-lead">{examDate === null ? 'Set the date of your exam to see a countdown and today\'s step of the last-week plan.' : 'Change the date of your exam.'}</p>
            {dateForm}
          </div>
        ) : (
          <div className="ed-count-grid">
            <div className="ed-count-main">
              {days! > 0 && <p className="ed-big"><b>{days}</b> {days === 1 ? 'day' : 'days'} <span>to your exam</span></p>}
              {days === 0 && <p className="ed-big ed-big-text">Today is exam day.</p>}
              {days! < 0 && <p className="ed-big ed-big-text">Your exam date has passed.</p>}
              <p className="ed-when">{longDate(examDate)} <button type="button" className="dl-linkbtn" onClick={() => { setDraft(examDate); setEditing(true); }}>Change the date</button></p>
            </div>
            <div className="ed-count-side">
              {todayRow ? (
                <div className="ed-today">
                  <p className="ed-today-k">Today is <b>{todayRow.day}</b></p>
                  <p className="ed-today-what"><Inline c={todayRow.what} /></p>
                  <p className="dl-small dl-muted"><a href={`#${uid}-${todayRow.id}`}>Go to this day in the plan</a></p>
                </div>
              ) : days! > 7 ? (
                <p className="dl-muted">The last-7-days plan starts on <b>{longDate(addDaysIso(examDate, -7))}</b>. Until then, follow your study plan.</p>
              ) : days! < 0 ? (
                <p className="dl-muted">Read <a href={p.links.after}>After the exam</a> in Chapter 27: what the result means, and what to do next.</p>
              ) : null}
            </div>
            <WeekLine days={days} ticked={weekSet} />
          </div>
        )}
      </section>

      <div className="ed-grid">
        <div className="ed-main">
          <section className="ed-week" aria-labelledby={`${uid}-week-h`}>
            <h2 id={`${uid}-week-h`}>The last 7 days</h2>
            <p className="ed-lead"><Inline c={p.weekIntro} /></p>
            <ol className="ed-days">
              {p.week.map((w) => {
                const isToday = w.days !== null && w.days === days;
                const on = weekSet.has(w.id);
                return (
                  <li key={w.id} id={`${uid}-${w.id}`} className="ed-day" data-today={isToday || undefined} data-done={on || undefined}>
                    <div className="ed-day-head">
                      <span className="ed-day-label">{w.day}</span>
                      {isToday && <span className="pill pill-review">Today</span>}
                      {w.days !== null && w.days > 0 && (
                        <label className="ed-day-check">
                          <input type="checkbox" checked={on} disabled={!ticks} aria-label={`Done: ${w.day}`} onChange={(e) => tickWeek(w.id, e.target.checked)} />
                          <span aria-hidden="true">Done</span>
                        </label>
                      )}
                    </div>
                    <p className="ed-day-what"><span className="visually-hidden">{p.weekHead[1] ?? 'What to do'}: </span><Inline c={w.what} /></p>
                    {w.done.length > 0 && text(w.done) !== '–' && <p className="ed-day-done"><span className="ed-k">{p.weekHead[2] ?? 'Done when'}:</span> <Inline c={w.done} /></p>}
                  </li>
                );
              })}
            </ol>
            <p className="dl-small dl-muted">{perDay ? `Each day: ${perDay}. ` : ''}Source: <a href={p.links.week}>27.7 The last 7 days</a>.</p>
            {p.trap.length > 0 && <Callout kind="trap"><Blocks blocks={p.trap} /></Callout>}
            <nav className="ed-tools" aria-label="Tools for the last week">
              <a href={p.links.traps}>The top exam traps</a>
              <a href={p.links.cheatsheets}>Cheat sheets</a>
              <a href={p.links.notebook}>Error notebook</a>
              <a href={p.links.drills}>Drills</a>
              <a href={p.links.flashcards}>Flashcards</a>
              <a href={p.links.mocks}>Mock exams</a>
            </nav>
          </section>

          <section className="ed-check" aria-labelledby={`${uid}-check-h`}>
            <div className="ed-check-top">
              <h2 id={`${uid}-check-h`}>Exam-day checklist</h2>
              <p className="ed-check-count" aria-live="polite">{checkSet.size} of {totalItems} ticked</p>
            </div>
            <p className="ed-lead"><Inline c={p.checklistIntro} /></p>
            {p.groups.map((g) => {
              const n = g.items.filter((it) => checkSet.has(it.id)).length;
              return (
                <fieldset key={g.id} className="ed-group panel">
                  <legend><span>{g.title}</span> <span className="ed-group-n">{n} of {g.items.length}</span></legend>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it.id}>
                        <label className="ed-item">
                          <input type="checkbox" checked={checkSet.has(it.id)} disabled={!ticks} onChange={(e) => tickItem(it.id, e.target.checked)} />
                          <span><Inline c={it.c} /></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })}
            <div className="ed-check-actions">
              {checkSet.size > 0 && <button type="button" className="btn btn-quiet btn-small" onClick={() => { setUndo(ticks?.checklist ?? []); if (ticks) persist({ ...ticks, checklist: [] }); }}>Untick the whole checklist</button>}
              {undo && checkSet.size === 0 && <button type="button" className="btn btn-quiet btn-small" onClick={() => { if (ticks) persist({ ...ticks, checklist: undo }); setUndo(null); }}>Undo</button>}
              <span className="dl-small dl-muted">Source: <a href={p.links.checklist}>27.8 Exam-day checklist</a>.</span>
            </div>
          </section>
        </div>

        <aside className="ed-side">
          <section className="panel ed-ready" aria-labelledby={`${uid}-ready-h`}>
            <h2 id={`${uid}-ready-h`}>{ready?.ready ? 'You meet the four conditions' : 'Ready to book?'}</h2>
            <p className="dl-small"><Inline c={p.readinessIntro} /></p>
            <ul className="ed-conds">
              {p.conditions.map((c, i) => {
                const st = !ready ? null : i === 0 ? { ok: ready.quizzes.total > 0 && ready.quizzes.ok >= ready.quizzes.total, v: `${ready.quizzes.ok} of ${ready.quizzes.total} quizzes`, href: p.links.quizzes }
                  : i === 1 ? { ok: ready.capstone.total > 0 && ready.capstone.ok >= ready.capstone.total, v: `${ready.capstone.ok} of ${ready.capstone.total} milestones`, href: p.links.capstone }
                  : i === 2 ? { ok: ready.mocks.ok >= 2, v: `${ready.mocks.ok} of 2 mocks`, href: p.links.mocks }
                  : { ok: ready.notebook.reread, v: ready.notebook.reread ? 'Re-read' : 'Open the notebook', href: p.links.notebook };
                return (
                  <li key={i} data-ok={st?.ok || undefined}>
                    <Check ok={!!st?.ok} />
                    <span className="ed-cond-text"><Inline c={c} /><span className="visually-hidden">{st ? (st.ok ? ' Done.' : ' Not yet.') : ''}</span></span>
                    {st && <a className="ed-cond-v" href={st.href}>{st.v}</a>}
                  </li>
                );
              })}
            </ul>
            {p.readinessAfter.length > 0 && <p className="dl-small dl-muted"><Inline c={p.readinessAfter} /></p>}
          </section>

          {p.facts.length > 0 && (
            <section className="panel ed-facts" aria-labelledby={`${uid}-facts-h`}>
              <h2 id={`${uid}-facts-h`}>The exam in short</h2>
              <dl>
                {p.facts.map((f) => <div key={f.item}><dt>{f.item}</dt><dd><Inline c={f.details} /></dd></div>)}
              </dl>
              <p className="dl-small dl-muted">From <a href={p.links.logistics}>0.5 The exam decoded</a> (official information, 2026). Check the current dbt certification FAQ before your exam.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function text(c: InlineT[]): string {
  return c.map((n) => (typeof n === 'string' ? n : 'v' in n ? n.v : '')).join('').trim();
}
