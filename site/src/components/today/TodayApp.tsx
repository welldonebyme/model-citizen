// Today page: first-visit setup, "Continue", today's mission (from the book's plan), readiness gate, streak, mastery.
// All data comes from this browser's progress (IndexedDB). Nothing is sent anywhere.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, saveSettings, today, streakFrom, type Rhythm, type Settings } from '../../lib/store/db';
import { calendar, mission, readiness, schedule, studyDayIndex, RHYTHMS, STANDARD_WEEKS, type PlanLesson, type MissionItem } from '../../lib/planner';
import { url } from '../../lib/url';
import { masteryByObjective, masteryLevel, mocksAt80, quizzesAt80 } from '../../lib/progress-summary';

export interface TodayProps {
  lessons: PlanLesson[];
  chapterQuiz: [string, number][];
  chapterTitles: Record<string, string>;
  lessonPaths: Record<string, string>;
  labLessons: Record<string, string>;
  objectives: { id: string; title: string }[];
  questionObjectives: Record<string, string>;
  capstoneMilestones: number;
  labTitles: Record<string, string>;
  /** the static course map, rendered by Astro */
  children?: ReactNode;
}

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const KIND_LABEL: Record<MissionItem['kind'], string> = { review: 'Review', read: 'Read', lab: 'Lab', quiz: 'Quiz', mock: 'Mock exam', rest: 'Free time' };

export default function TodayApp(p: TodayProps) {
  const [storeError, setStoreError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => { getSettings().then(setSettings).catch(() => setStoreError('This browser does not let the site save your progress (private window or blocked storage). You can still read everything, but nothing will be remembered.')); }, []);

  const doneLessons = useLiveQuery(async () => new Set((await db().progress.where('kind').equals('lesson').toArray()).filter((r) => r.status === 'done').map((r) => r.ref)), [], new Set<string>());
  const dueCards = useLiveQuery(() => db().srs.where('due').belowOrEqual(today()).count(), [], 0);
  const activity = useLiveQuery(() => db().activity.toArray(), [], []);
  const answers = useLiveQuery(() => db().answers.toArray(), [], []);
  const attempts = useLiveQuery(() => db().examAttempts.where('status').equals('finished').toArray(), [], []);
  const quizRows = useLiveQuery(() => db().progress.where('kind').equals('chapter').toArray(), [], []);
  const capstoneDone = useLiveQuery(() => db().progress.where('kind').equals('capstone').count(), [], 0);
  const notes = useLiveQuery(() => db().notes.where('kind').equals('error').count(), [], 0);

  const lessonMap = useMemo(() => new Map(p.lessons.map((l) => [l.id, l])), [p.lessons]);
  const chapterQuiz = useMemo(() => new Map(p.chapterQuiz), [p.chapterQuiz]);
  const labTitles = useMemo(() => new Map(Object.entries(p.labTitles)), [p.labTitles]);

  if (storeError) return <div className="t-notice" role="status">{storeError}</div>;
  if (!settings) return <div className="t-loading" aria-busy="true">Loading your progress…</div>;
  if (!settings.startDate) return <><Onboarding onDone={setSettings} />{p.children}</>;

  const rhythm = settings.rhythm;
  const days = schedule(p.lessons, rhythm);
  const weeks = calendar(rhythm).length;
  const dayIdx = Math.min(days.length - 1, studyDayIndex(settings.startDate, today()));
  const week = Math.floor(dayIdx / 6) + 1;
  const day = (dayIdx % 6) + 1;

  // chapters whose quiz was started (a finished quiz, or any answer given in quiz mode)
  const quizDone = new Set<string>(quizRows.map((r) => r.ref));
  for (const a of answers) { const c = a.mode === 'quiz' && a.qid.match(/^q-(ch\d+)-/); if (c) quizDone.add(c[1]); }
  // Reading budget per day = the course's reading time spread over the plan's study days (the book: about 40 of 120 minutes).
  const totalReading = p.lessons.reduce((n, l) => n + l.minutes, 0);
  const readingBudget = Math.max(30, Math.round(totalReading / Math.max(1, days.length) / 5) * 5);
  const m = mission({ days, dayIndex: dayIdx, done: doneLessons, dueCards, lessons: lessonMap, chapterQuiz, quizDone, labTitles, readingBudget });

  // the same numbers as the dashboard (lib/progress-summary)
  const quizzes = quizzesAt80(quizRows, answers, chapterQuiz);
  const mocksOk = mocksAt80(attempts);
  const r = readiness({
    quizzes: { ok: quizzes.ok, total: quizzes.total },
    capstone: { ok: capstoneDone, total: p.capstoneMilestones },
    mocks: { ok: Math.min(2, mocksOk), total: 2 },
    notebook: { reread: !!settings.notebookReread, notes },
  });

  const streak = streakFrom(activity.filter((a) => a.events > 0).map((a) => a.date));
  const minutesToday = activity.find((a) => a.date === today())?.minutes ?? 0;

  // objective mastery: last try at each question, per objective
  const perObj = masteryByObjective(answers, p.questionObjectives);
  const mastery = (id: string) => masteryLevel(perObj.get(id));

  let resume: { lesson: string; path: string } | null = null;
  try { resume = JSON.parse(localStorage.getItem('mc:resume') || 'null'); } catch { resume = null; }
  const firstRead = m.items.find((i) => i.kind === 'read');
  const continueHref = resume?.path ?? (firstRead?.refs ? url(p.lessonPaths[firstRead.refs[0]]) : url('path/'));
  const continueLabel = resume ? `Continue lesson ${lessonMap.get(resume.lesson)?.number ?? ''}` : firstRead ? `Start lesson ${firstRead.title}` : 'Open your path';
  const daysToExam = settings.examDate ? Math.ceil((new Date(settings.examDate + 'T09:00:00').getTime() - Date.now()) / 86400000) : null;
  const planWeek = STANDARD_WEEKS[Math.min(13, (calendar(rhythm)[week - 1]?.planWeeks ?? [1]).at(-1)! - 1)];
  const total = m.items.reduce((n, i) => n + i.minutes, 0);

  return (
    <div className="t">
      <section className="t-hello">
        <div>
          <h1>{greeting()}{settings.name ? `, ${settings.name}` : ''}.</h1>
          <p>Week {week} of {weeks}, day {day}. {RHYTHMS[rhythm].label} rhythm. This week's checkpoint: <Ticks text={planWeek.checkpoint} />.</p>
        </div>
        <div className="t-cta">
          <a className="btn btn-primary" href={continueHref}>{continueLabel}</a>
          <small>{minutesToday > 0 ? `${minutesToday} min studied today. ` : ''}Today's plan: about {Math.round(total / 5) * 5} minutes.</small>
        </div>
      </section>

      {p.children}

      <div className="t-grid">
        <section aria-labelledby="mis-h">
          <div className="t-title"><h2 id="mis-h">Today's mission</h2>{m.behind > 0 && <span className="t-behind">{m.behind} {m.behind === 1 ? 'lesson' : 'lessons'} to catch up</span>}</div>
          <ol className="t-mission">
            {m.items.map((it, i) => {
              const href = it.kind === 'read' && it.refs ? url(p.lessonPaths[it.refs[0]])
                : it.kind === 'lab' && it.refs ? url(p.lessonPaths[p.labLessons[it.refs[0]]] ?? '') + '#' + it.refs[0]
                : it.kind === 'quiz' && it.refs ? url(`quiz/${it.refs[0]}/`)
                : it.kind === 'review' ? url('practice/flashcards/')
                : it.kind === 'rest' ? url('practice/') : undefined;
              const done = it.kind === 'read' && it.refs?.every((id) => doneLessons.has(id));
              return (
                <li key={i} className={done ? 'done' : i === 0 ? 'now' : undefined}>
                  <span className="t-dot" aria-hidden="true">{done ? '✓' : i + 1}</span>
                  <div className="t-body">
                    <span className={`pill t-k-${it.kind}`}>{KIND_LABEL[it.kind]}</span>
                    <h3>{href ? <a href={href}>{it.title}</a> : it.title}</h3>
                    {it.kind === 'lab' && <p>Steps on this site, checked against the book. Some labs run in your browser, others on your computer (macOS, Windows or WSL).</p>}
                    {it.kind === 'review' && <p>Cards you missed, from traps, terms and questions. Do them first, while your mind is fresh.</p>}
                    {it.kind === 'quiz' && <p>Book closed. Wrong answers go to your error notebook.</p>}
                  </div>
                  <span className="t-min">{it.minutes} min</span>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="t-side">
          <section className="panel" aria-labelledby="gate-h">
            <h2 id="gate-h">{r.ready ? 'You are ready to book the exam' : 'Ready to book the exam?'}</h2>
            <p className="t-note">The book's rule: all four conditions must be true.</p>
            <ul className="t-gate">
              <Gate ok={r.quizzes.total > 0 && r.quizzes.ok >= r.quizzes.total} label="Every chapter quiz at 80% or more" value={`${r.quizzes.ok} of ${r.quizzes.total}`} />
              <Gate ok={r.capstone.total > 0 && r.capstone.ok >= r.capstone.total} label="Capstone builds without errors" value={`${r.capstone.ok} of ${r.capstone.total}`} />
              <Gate ok={r.mocks.ok >= 2} label="Two timed mocks at 80% or more" value={`${r.mocks.ok} of 2`} />
              <Gate ok={r.notebook.reread} label="Error notebook re-read" value={`${r.notebook.notes} ${r.notebook.notes === 1 ? 'note' : 'notes'}`} />
            </ul>
          </section>

          <section className="panel" aria-labelledby="str-h">
            <h2 id="str-h">{streak === 0 ? 'Start a streak today' : `${streak}-day streak`}</h2>
            <Week activity={activity.map((a) => a.date)} />
          </section>

          <section className="panel" aria-labelledby="ex-h">
            <h2 id="ex-h">Exam date</h2>
            {daysToExam != null
              ? <p className="t-count"><b>{daysToExam > 0 ? daysToExam : 0}</b> {daysToExam === 1 ? 'day' : 'days'} left <span>({settings.examDate})</span></p>
              : <p className="t-note">Not set. Choose a date in <a href={url('settings/')}>Settings</a> to see a countdown. The book says: book it after two timed mocks at 80% or more.</p>}
          </section>

          <section className="panel" aria-labelledby="obj-h">
            <h2 id="obj-h">Mastery of the {p.objectives.length} objectives</h2>
            <p className="t-note">From your last answers on each objective. Prerequisites first.</p>
            <ul className="t-obj">
              {p.objectives.map((o) => {
                const lv = mastery(o.id);
                return <li key={o.id} data-m={lv}><a href={url(`reference/coverage/#obj-${o.id}`)} title={`${o.id}: ${o.title}. ${['Not started', 'Learning', 'Mastered'][lv]}`}>{o.id.replace('CP0-', '')}</a></li>;
              })}
            </ul>
            <div className="t-obj-key"><span>Not started</span><span>Learning</span><span>Mastered</span></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Renders `code` spans written with backticks. */
function Ticks({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 ? <code key={i} className="mc-ic" style={{ whiteSpace: 'nowrap' }}>{part}</code> : part))}</>;
}

function Gate({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li data-ok={ok || undefined}>
      <span className="t-check" aria-hidden="true">{ok ? '✓' : ''}</span>
      <span>{label}<span className="visually-hidden">{ok ? ': done' : ': not yet'}</span></span>
      <span className="t-val">{value}</span>
    </li>
  );
}

function Week({ activity }: { activity: string[] }) {
  const set = new Set(activity);
  const d = new Date();
  const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="t-week" aria-label="This week">
      {names.map((n, i) => {
        const day = new Date(monday); day.setDate(monday.getDate() + i);
        const key = today(day);
        const isToday = key === today();
        return <div key={n} className={set.has(key) ? 'on' : isToday ? 'today' : undefined}><i aria-hidden="true" /><span>{n}</span><span className="visually-hidden">{set.has(key) ? 'studied' : 'not studied'}</span></div>;
      })}
    </div>
  );
}

function Onboarding({ onDone }: { onDone: (s: Settings) => void }) {
  const [name, setName] = useState('');
  const [rhythm, setRhythm] = useState<Rhythm>('standard');
  const [examDate, setExamDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    try {
      onDone(await saveSettings({ name: name.trim() || undefined, rhythm, startDate: today(), examDate: examDate || undefined }));
    } catch {
      setError('Your browser blocked saving. Try a normal (not private) window.');
    }
  }
  return (
    <section className="t-onb">
      <h1>Welcome to Model Citizen</h1>
      <p className="t-lead">A free course to prepare the dbt Analytics Engineering Certification (dbt Core 1.11), step by step: lessons, labs, quizzes and three realistic mock exams. Your progress stays in this browser. No account needed.</p>
      <form onSubmit={start} className="t-form">
        <label className="t-field"><span>Your first name <em>(optional)</em></span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={40} /></label>
        <fieldset className="t-field">
          <legend>How much time can you study?</legend>
          {(Object.keys(RHYTHMS) as Rhythm[]).map((k) => (
            <label key={k} className="t-radio">
              <input type="radio" name="rhythm" value={k} checked={rhythm === k} onChange={() => setRhythm(k)} />
              <span><b>{RHYTHMS[k].label}</b>, {RHYTHMS[k].hoursPerDay}, {calendar(k).length} weeks. <span className="t-note">{RHYTHMS[k].describe}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="t-field"><span>Exam date <em>(optional, you can set it later)</em></span><input type="date" value={examDate} min={today()} onChange={(e) => setExamDate(e.target.value)} /></label>
        {error && <p className="t-error" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit">Start my plan today</button>
        <p className="t-note">Already started on another computer? <a href={url('settings/')}>Import your progress file</a>.</p>
      </form>
    </section>
  );
}
