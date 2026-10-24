// /exams/attempt/?id=…: the results of a past attempt (saved in this browser).
import { useEffect, useState } from 'react';
import type { Question } from '../../lib/content-types';
import type { Attempt } from '../../lib/exam/engine';
import { getAttempt, listAttempts } from '../../lib/exam/persist';
import type { ObjectiveLinks } from '../../lib/exam/links-types';
import { Results } from './Results';

interface Props { links: ObjectiveLinks; dataBase: string; examsHref: string; settingsHref: string }

type State =
  | { kind: 'loading' }
  | { kind: 'missing'; why: 'no-id' | 'not-found' | 'not-finished' | 'storage' | 'questions' }
  | { kind: 'ready'; attempt: Attempt; questions: Question[]; history: Attempt[] };

export default function AttemptPage({ links, dataBase, examsHref, settingsHref }: Props) {
  const [st, setSt] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    (async () => {
      const id = new URLSearchParams(location.search).get('id');
      if (!id) return setSt({ kind: 'missing', why: 'no-id' });
      let attempt: Attempt | undefined;
      let history: Attempt[] = [];
      try { [attempt, history] = await Promise.all([getAttempt(id), listAttempts()]); }
      catch { return setSt({ kind: 'missing', why: 'storage' }); }
      if (!attempt) return setSt({ kind: 'missing', why: 'not-found' });
      if (attempt.status !== 'finished') return setSt({ kind: 'missing', why: 'not-finished' });
      try {
        const res = await fetch(`${dataBase}mock${attempt.mock}.json`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { questions: Question[] };
        setSt({ kind: 'ready', attempt, questions: data.questions, history: history.filter((a) => a.status === 'finished') });
        document.title = `Mock exam ${attempt.mock} results | Model Citizen`;
      } catch {
        setSt({ kind: 'missing', why: 'questions' });
      }
    })();
  }, [dataBase]);

  if (st.kind === 'loading') return <p className="ex-muted">Loading the results…</p>;
  if (st.kind === 'missing') {
    const msg = {
      'no-id': 'This page shows the results of one attempt. Choose an attempt in the list of mock exams.',
      'not-found': 'This attempt is not saved in this browser. Attempts stay in the browser where you took them. To see them on another computer, export your progress file in Settings and import it there.',
      'not-finished': 'This attempt is not finished yet. Open the mock exam to resume it.',
      storage: 'This browser does not let the site read its saved data (private mode, or storage is blocked).',
      questions: 'The questions of this mock exam could not be loaded. Check your connection, then reload the page.',
    }[st.why];
    return (
      <div className="ex-body ex-results-body">
        <h1>Mock exam results</h1>
        <p className="ex-alert" role="alert">{msg}</p>
        <p className="ex-row"><a className="ex-btn ex-btn-primary" href={examsHref}>All mock exams</a>{st.why === 'not-found' && <a className="ex-btn" href={settingsHref}>Settings and progress file</a>}</p>
      </div>
    );
  }
  return (
    <div className="ex-body ex-results-body">
      <Results attempt={st.attempt} questions={st.questions} links={links} history={st.history} title={`Mock exam ${st.attempt.mock}`} examsHref={examsHref} />
    </div>
  );
}
