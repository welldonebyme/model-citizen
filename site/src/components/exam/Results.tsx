// Results of a mock attempt: score against the pass line (65%) and the book's target (80%), per topic and
// per objective, time per question and pacing, weakest objectives with links to the lessons and labs,
// history of all attempts, and the full review with explanations.
import { useMemo, useState } from 'react';
import type { Question } from '../../lib/content-types';
import type { Attempt } from '../../lib/exam/engine';
import { domcOf, responseOf } from '../../lib/exam/engine';
import { breakdown, outcomesOf, pacing, verdict, weakest, type Outcome } from '../../lib/exam/results';
import { describeResponse, FORMAT_NAME } from '../../lib/exam/describe';
import { clock, dateTime, minutes, mss, spoken } from '../../lib/exam/time';
import { objective as objectiveMeta, topicLabel } from '../../lib/exam/objectives';
import type { ObjectiveLinks } from '../../lib/exam/links-types';
import { QuestionView } from '../quiz/QuestionView';
import { Explanation } from '../quiz/Feedback';
import { Inline } from '../content/Inline';
import { IconCheck, IconCross, IconFlag } from '../quiz/icons';
import { HistoryChart, RowBars, ScoreMeter, TimeChart } from './charts';

interface Props {
  attempt: Attempt;
  questions: Question[];
  links: ObjectiveLinks;
  history: Attempt[];
  title: string;
  examsHref: string;
}

type Filter = 'all' | 'wrong' | 'flagged' | 'unanswered';

function ReviewItem({ o, attempt }: { o: Outcome; attempt: Attempt }) {
  const [open, setOpen] = useState(false);
  const q = o.q;
  const domc = q.format === 'domc' ? domcOf(attempt, q) : undefined;
  return (
    <li className="rs-item" data-ok={o.correct || undefined}>
      <details onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span className="rs-mark">{o.correct ? <IconCheck /> : <IconCross />}</span>
          <span className="rs-num">Question {o.index + 1}</span>
          <span className="rs-meta">
            {o.correct ? 'Correct' : o.answered ? 'Not correct' : 'Not answered'}
            {' · '}{FORMAT_NAME[q.format]}
            {q.objective ? ` · ${q.objective}` : ''}
            {o.ms > 0 ? ` · ${mss(o.ms)}` : ''}
          </span>
          {o.flagged && <span className="rs-flag"><IconFlag filled /> Flagged</span>}
        </summary>
        {open && (
          <div className="rs-body">
            <QuestionView q={q} name={`rv-${attempt.id}-${q.id}`} response={responseOf(attempt, q.id)} onResponse={() => undefined}
              domc={domc ? { state: domc, rules: attempt.domcRules ?? { earlyEnd: true, extraOption: false }, onJudge: () => undefined, letters: true } : undefined}
              review />
            <p className="rs-yours">Your answer: <b>{describeResponse(q, responseOf(attempt, q.id))}</b></p>
            <Explanation q={q} />
          </div>
        )}
      </details>
    </li>
  );
}

export function Results({ attempt, questions, links, history, title, examsHref }: Props) {
  const outcomes = useMemo(() => outcomesOf(attempt, questions), [attempt, questions]);
  const correct = outcomes.filter((o) => o.correct).length;
  const v = verdict(correct, outcomes.length);
  const { byTopic, byObjective } = useMemo(() => breakdown(outcomes), [outcomes]);
  const weak = weakest(byObjective, 5);
  const pace = pacing(attempt, outcomes);
  const [filter, setFilter] = useState<Filter>('all');
  const shown = outcomes.filter((o) => filter === 'all' || (filter === 'wrong' && !o.correct) || (filter === 'flagged' && o.flagged) || (filter === 'unanswered' && !o.answered));
  const counts = { all: outcomes.length, wrong: outcomes.filter((o) => !o.correct).length, flagged: outcomes.filter((o) => o.flagged).length, unanswered: outcomes.filter((o) => !o.answered).length };
  const exam = attempt.mode === 'exam';
  const timedTwice = history.filter((h) => h.mode === 'exam' && h.status === 'finished' && (h.score?.pct ?? 0) >= 80).length;

  const reviewRefs = (oid: string) => {
    const seen = new Set<string>();
    const out: Question['review'][] = [];
    for (const o of outcomes) {
      if (o.q.objective !== oid || o.correct || !o.q.review) continue;
      const k = JSON.stringify(o.q.review);
      if (!seen.has(k)) { seen.add(k); out.push(o.q.review); }
    }
    return out;
  };

  return (
    <div className="rs">
      <header className="rs-head">
        <h1 tabIndex={-1} id="rs-h">{title}: your results</h1>
        <p className="ex-muted">
          {exam ? 'Exam mode' : 'Practice mode'} · started {dateTime(attempt.startedAt)}
          {' · '}{exam ? `time used ${clock(attempt.elapsedMs)} of ${clock(attempt.durationMs)}` : `time used ${clock(attempt.elapsedMs)}`}
          {attempt.timeUp ? ' · submitted when the time was up' : ''}
        </p>
      </header>

      <section className="rs-score" aria-labelledby="rs-score-h" data-level={v.ready ? 'ready' : v.passed ? 'pass' : 'fail'}>
        <h2 id="rs-score-h" className="visually-hidden">Score</h2>
        <div className="rs-hero">
          <p className="rs-pct"><span className="rs-pct-n">{v.shownPct}%</span><span className="rs-pct-of">{correct} of {outcomes.length} correct</span></p>
          <p className="rs-verdict">
            <span className="rs-badge">{v.ready ? <><IconCheck /> Above the target</> : v.passed ? <><IconCheck /> Passed</> : <><IconCross /> Not passed</>}</span>
            {v.message}
          </p>
        </div>
        <ScoreMeter pct={v.pct} />
        {exam && <p className="ex-muted ex-small">Timed mocks at 80% or more so far: <b>{timedTwice}</b>. The book's rule: book the real exam after two of them.</p>}
        {!exam && <p className="ex-muted ex-small">Practice mode had feedback after each question, so this score counts less than an exam-mode score.</p>}
      </section>

      {weak.length > 0 && (
        <section className="rs-sec" aria-labelledby="rs-weak-h">
          <h2 id="rs-weak-h">Review these first</h2>
          <p className="ex-muted">Your weakest objectives in this attempt, with the lessons and labs that teach them.</p>
          <ol className="rs-weak">
            {weak.map((r) => {
              const refs = reviewRefs(r.id);
              return (
                <li key={r.id}>
                  <p className="rs-weak-t"><span className="mc-obj">{r.id}</span> <b>{objectiveMeta(r.id)?.title ?? r.title}</b> <span className="ex-muted">{r.correct} of {r.total} correct</span></p>
                  <ul className="rs-links">
                    {(links[r.id] ?? []).map((l) => <li key={l.href}><a href={l.href}>{l.text}</a> <span className="ex-muted">({l.kind})</span></li>)}
                    {refs.map((ref, k) => <li key={`r${k}`}>From the explanations: <Inline c={ref} /></li>)}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="rs-sec" aria-labelledby="rs-topic-h">
        <h2 id="rs-topic-h">By topic</h2>
        <p className="ex-muted ex-small">The 7 official topics. The thin line in each bar is the 65% pass line.</p>
        <RowBars rows={byTopic} label="Score by topic" idLabel={(r) => topicLabel(r.topic)} />
      </section>

      {byObjective.length > 0 && (
        <section className="rs-sec" aria-labelledby="rs-obj-h">
          <details className="rs-details">
            <summary><h2 id="rs-obj-h">By objective ({byObjective.length})</h2></summary>
            <RowBars rows={byObjective} label="Score by objective" idLabel={(r) => r.id} />
          </details>
        </section>
      )}

      <section className="rs-sec" aria-labelledby="rs-time-h">
        <h2 id="rs-time-h">Time and pacing</h2>
        <ul className="rs-stats">
          <li><span className="rs-stat-n">{clock(pace.totalMs)}</span><span>time used{exam ? ` of ${minutes(attempt.durationMs)} minutes` : ''}</span></li>
          <li><span className="rs-stat-n">{mss(pace.avgMs)}</span><span>average per question (pace: {mss(pace.paceMs)})</span></li>
          <li><span className="rs-stat-n">{pace.overPace}</span><span>questions took more than {mss(pace.paceMs)}</span></li>
        </ul>
        {pace.checkpoints.length > 0 && (
          <table className="rs-table">
            <caption>Checkpoints of the book's three-pass plan</caption>
            <thead><tr><th scope="col">Question</th><th scope="col">Target</th><th scope="col">Latest</th><th scope="col">You reached it at</th></tr></thead>
            <tbody>
              {pace.checkpoints.map((c) => (
                <tr key={c.question}>
                  <th scope="row">Question {c.question}</th>
                  <td>minute {minutes(c.targetMs)}</td>
                  <td>minute {minutes(c.latestMs)}</td>
                  <td>
                    {c.reachedMs === undefined ? 'Not reached' : `minute ${minutes(c.reachedMs)}`}
                    {' '}<span className="rs-cp" data-status={c.status}>{c.status === 'ahead' ? 'on target' : c.status === 'ok' ? 'behind target, before the latest' : c.status === 'late' ? 'later than the safe pace' : ''}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3 className="rs-h3">Time per question</h3>
        <TimeChart outcomes={outcomes} paceMs={pace.paceMs} />
        <details className="rs-details rs-table-twin">
          <summary>Show the times as a table</summary>
          <table className="rs-table">
            <thead><tr><th scope="col">Question</th><th scope="col">Time</th><th scope="col">Result</th></tr></thead>
            <tbody>{outcomes.map((o) => <tr key={o.q.id}><th scope="row">{o.index + 1}</th><td>{mss(o.ms)}</td><td>{o.correct ? 'Correct' : o.answered ? 'Not correct' : 'Not answered'}</td></tr>)}</tbody>
          </table>
        </details>
        {pace.slowest.length > 0 && <p className="ex-muted ex-small">Slowest: {pace.slowest.map((o) => `question ${o.index + 1} (${spoken(o.ms)})`).join(', ')}.</p>}
      </section>

      {history.length > 0 && (
        <section className="rs-sec" aria-labelledby="rs-hist-h">
          <h2 id="rs-hist-h">All your mock exams</h2>
          <HistoryChart attempts={history} currentId={attempt.id} />
          <p className="ex-small"><a href={examsHref}>See the list of all attempts</a></p>
        </section>
      )}

      <section className="rs-sec" aria-labelledby="rs-rev-h">
        <h2 id="rs-rev-h">Every question, with explanations</h2>
        <div className="seg rs-filter" role="group" aria-label="Show">
          {(['all', 'wrong', 'flagged', 'unanswered'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'wrong' ? 'Not correct' : f === 'flagged' ? 'Flagged' : 'Not answered'} ({counts[f]})
            </button>
          ))}
        </div>
        {shown.length === 0 ? <p className="ex-muted">No question here.</p> : (
          <ol className="rs-list">{shown.map((o) => <ReviewItem key={o.q.id} o={o} attempt={attempt} />)}</ol>
        )}
      </section>
    </div>
  );
}
