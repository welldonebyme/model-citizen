// Inline lesson checkpoints (spec A3): the chapter quiz questions mapped to this lesson, at the end of the
// lesson, one at a time with feedback. Loads only this chapter's questions (quiz/data/chNN.json), records
// answers with mode 'checkpoint', and wrong answers go to the error notebook and the review queue.
//
// Mount it at the end of a lesson page (client:visible: the questions load when the learner gets there):
//   <LessonCheckpoints client:visible chapterId={chapter.id} questionIds={lesson.checkpoints} />
import { useEffect, useState } from 'react';
import type { Question } from '../../lib/content-types';
import { url } from '../../lib/url';
import { QuizRunner } from './QuizRunner';
import './quiz.css';

export interface LessonCheckpointsProps {
  chapterId: string;
  questionIds: string[];
  /** where the full chapter quiz is (default: quiz/<chapterId>/) */
  quizHref?: string;
}

const cache = new Map<string, Promise<Question[]>>();
export function loadChapterQuestions(chapterId: string): Promise<Question[]> {
  if (!cache.has(chapterId)) {
    cache.set(chapterId, fetch(url(`quiz/data/${chapterId}.json`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { questions: Question[] }) => d.questions)
      .catch((e) => { cache.delete(chapterId); throw e; }));
  }
  return cache.get(chapterId)!;
}

export default function LessonCheckpoints({ chapterId, questionIds, quizHref }: LessonCheckpointsProps) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState('');
  const ids = questionIds ?? [];
  const key = ids.join(',');

  useEffect(() => {
    if (!ids.length) return;
    let live = true;
    loadChapterQuestions(chapterId)
      .then((all) => {
        if (!live) return;
        const byId = new Map(all.map((q) => [q.id, q]));
        setQuestions(ids.map((id) => byId.get(id)).filter((q): q is Question => !!q));
      })
      .catch(() => { if (live) setError('The questions could not be loaded. Check your connection, then reload the page.'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, key]);

  if (!ids.length) return null;
  const n = questions?.length ?? ids.length;
  const number = Number(chapterId.replace(/\D/g, ''));
  return (
    <section className="qz-checkpoints" aria-labelledby={`cp-${chapterId}-${ids[0]}`}>
      <header className="qz-cp-head">
        <h2 id={`cp-${chapterId}-${ids[0]}`}>Check your understanding</h2>
        <p className="qz-cp-sub">{n === 1 ? '1 question' : `${n} questions`} from the chapter quiz about this lesson, with feedback. A wrong answer goes to your error notebook.</p>
      </header>
      {error && <p className="qz-warn" role="alert">{error}</p>}
      {!error && !questions && <p className="qz-muted">Loading the questions…</p>}
      {questions && questions.length === 0 && <p className="qz-muted">These questions are not available yet.</p>}
      {questions && questions.length > 0 && (
        <QuizRunner
          questions={questions}
          mode="checkpoint"
          title="Checkpoint"
          domcExamLike={false}
          seed={number * 104729}
          compact
          sessionKey={`checkpoint:${chapterId}:${key}`}
          moreHref={quizHref ?? url(`quiz/${chapterId}/`)}
          moreLabel={`The full Chapter ${number} quiz`}
        />
      )}
    </section>
  );
}
