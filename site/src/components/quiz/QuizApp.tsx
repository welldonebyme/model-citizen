// Chapter quiz island ("Check yourself"): practice mode with instant feedback. The session survives a
// reload; when the score is shown, the chapter quiz is marked done in the progress table
// (kind 'chapter', ref chNN, data { score, total, best, quizAt }) for the Path and Today pages.
import { useCallback, useEffect, useState } from 'react';
import type { Question } from '../../lib/content-types';
import { db, markProgress } from '../../lib/store/db';
import { shortDate } from '../../lib/exam/time';
import { QuizRunner, type QuizFinish } from './QuizRunner';

export interface QuizAppProps {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  questions: Question[];
  lessonHref: string;
}

interface QuizData { score?: number; total?: number; best?: number; quizAt?: number }

export async function markChapterQuiz(chapterId: string, r: { score: number; total: number }): Promise<void> {
  const old = await db().progress.get(`chapter:${chapterId}`);
  const prev = (old?.data ?? {}) as QuizData;
  await markProgress('chapter', chapterId, 'done', { ...prev, score: r.score, total: r.total, best: Math.max(prev.best ?? 0, r.score), quizAt: Date.now() });
}

export default function QuizApp({ chapterId, chapterNumber, questions, lessonHref }: QuizAppProps) {
  // ?q=<question id> opens that question first (links from the error notebook, reviews)
  const startAt = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('q') ?? undefined : undefined;
  const [last, setLast] = useState<QuizData | null>(null);
  useEffect(() => {
    db().progress.get(`chapter:${chapterId}`).then((p) => setLast((p?.data as QuizData) ?? null)).catch(() => undefined);
  }, [chapterId]);
  const onFinish = useCallback((r: QuizFinish) => {
    markChapterQuiz(chapterId, r).then(() => db().progress.get(`chapter:${chapterId}`)).then((p) => p && setLast(p.data as QuizData)).catch(() => undefined);
  }, [chapterId]);
  return (
    <>
      {last?.quizAt && last.total ? (
        <p className="qz-last">Last finished on {shortDate(last.quizAt)}: <b>{last.score} of {last.total}</b> correct{last.best && last.best > (last.score ?? 0) ? ` (best: ${last.best})` : ''}.</p>
      ) : null}
      <QuizRunner
        questions={questions}
        mode="quiz"
        title={`Chapter ${chapterNumber} quiz`}
        domcExamLike={false}
        seed={chapterNumber * 7919}
        backHref={lessonHref}
        backLabel={`Back to Chapter ${chapterNumber}`}
        startAt={startAt}
        sessionKey={`quiz:${chapterId}`}
        onFinish={onFinish}
      />
    </>
  );
}
