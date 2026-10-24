// /exams/: the three mock exams, your attempts, and the history chart.
import { useEffect, useState } from 'react';
import type { Attempt } from '../../lib/exam/engine';
import { listAttempts } from '../../lib/exam/persist';
import { clock, dateTime, spoken } from '../../lib/exam/time';
import { remainingMs } from '../../lib/exam/engine';
import { HistoryChart } from './charts';

export interface MockCard { n: number; title: string; description: string; count: number; minutes: number; available: boolean; href: string }

interface Props { mocks: MockCard[]; attemptHref: string }

export default function ExamsIndex({ mocks, attemptHref }: Props) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { listAttempts().then(setAttempts).catch(() => { setError(true); setAttempts([]); }); }, []);

  const finished = (attempts ?? []).filter((a) => a.status === 'finished' && a.score && a.mock >= 1);
  const timed80 = finished.filter((a) => a.mode === 'exam' && a.score!.pct >= 80).length;
  const best = (n: number) => finished.filter((a) => a.mock === n).reduce<number | null>((m, a) => Math.max(m ?? 0, a.score!.pct), null);
  const active = (n: number) => (attempts ?? []).filter((a) => a.mock === n && a.status === 'active').sort((a, b) => b.startedAt - a.startedAt)[0];

  return (
    <div className="xi">
      <section className="xi-gate" aria-labelledby="xi-gate-h" data-ready={timed80 >= 2 || undefined}>
        <h2 id="xi-gate-h">Ready to book the exam?</h2>
        <p>
          The book's rule: book the real exam after <b>two timed mock exams at 80% or more</b>.
          {' '}{attempts === null ? '' : timed80 >= 2 ? 'You have done it. Well done: you can book the exam.' : `You have ${timed80} of 2.`}
        </p>
        <div className="xi-gate-bar" aria-hidden="true"><span style={{ width: `${Math.min(2, timed80) * 50}%` }} /></div>
      </section>

      <ul className="xi-cards">
        {mocks.map((m) => {
          const b = best(m.n);
          const act = active(m.n);
          return (
            <li key={m.n} className="xi-card">
              <h2>{m.title}</h2>
              <p className="xi-desc">{m.description}</p>
              <p className="xi-meta">{m.available ? `${m.count} questions · ${m.minutes} minutes` : 'Not available yet'}</p>
              <p className="xi-best">{b === null ? 'Not taken yet' : <>Best score: <b>{Math.floor(b)}%</b></>}</p>
              {act && <p className="xi-progress">In progress ({act.mode} mode): {Object.keys(act.responses).length} of {act.questionIds.length} answered{act.mode === 'exam' ? `, ${spoken(remainingMs(act))} left` : ''}.</p>}
              {m.available
                ? <a className={`btn ${act ? 'btn-primary' : b === null ? 'btn-primary' : 'btn-quiet'}`} href={m.href}>{act ? 'Resume' : b === null ? 'Start' : 'Take it again'}<span className="visually-hidden"> {m.title}</span></a>
                : <span className="xi-na">The questions are not converted yet.</span>}
            </li>
          );
        })}
      </ul>

      <section className="xi-sec" aria-labelledby="xi-hist-h">
        <h2 id="xi-hist-h">Your attempts</h2>
        {error && <p className="xi-note">This browser does not let the site save data, so no attempt can be shown.</p>}
        {attempts !== null && finished.length === 0 && !error && <p className="xi-note">No finished mock exam yet. Your scores will appear here, with a chart.</p>}
        {finished.length > 0 && <HistoryChart attempts={finished} />}
        {(attempts ?? []).filter((a) => a.mock >= 1 && a.status !== 'abandoned').length > 0 && (
          <div className="xi-table-wrap">
            <table className="xi-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Mock</th><th scope="col">Mode</th><th scope="col">Score</th><th scope="col">Time used</th><th scope="col"><span className="visually-hidden">Link</span></th></tr></thead>
              <tbody>
                {(attempts ?? []).filter((a) => a.mock >= 1 && a.status !== 'abandoned').slice().reverse().map((a) => (
                  <tr key={a.id}>
                    <td>{dateTime(a.startedAt)}</td>
                    <td>Mock {a.mock}</td>
                    <td>{a.mode === 'exam' ? 'Exam' : 'Practice'}</td>
                    <td>{a.status === 'finished' && a.score ? <b>{Math.floor(a.score.pct)}% <span className="xi-muted">({a.score.correct} of {a.score.total})</span></b> : 'In progress'}</td>
                    <td>{clock(a.elapsedMs)}</td>
                    <td>{a.status === 'finished'
                      ? <a href={`${attemptHref}?id=${encodeURIComponent(a.id)}`}>See results<span className="visually-hidden"> of mock {a.mock}, {dateTime(a.startedAt)}</span></a>
                      : <a href={mocks.find((m) => m.n === a.mock)?.href}>Resume<span className="visually-hidden"> mock {a.mock}</span></a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
