// Chapter quiz island ("Check yourself"): practice mode with instant feedback.
import type { Question } from '../../lib/content-types';
import { QuizRunner } from './QuizRunner';

export interface QuizAppProps {
  chapterNumber: number;
  chapterTitle: string;
  questions: Question[];
  lessonHref: string;
}

export default function QuizApp({ chapterNumber, questions, lessonHref }: QuizAppProps) {
  // ?q=<question id> opens that question first (links from the error notebook, reviews)
  const startAt = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('q') ?? undefined : undefined;
  return (
    <QuizRunner
      questions={questions}
      mode="quiz"
      title={`Chapter ${chapterNumber} quiz`}
      domcExamLike={false}
      seed={chapterNumber * 7919}
      backHref={lessonHref}
      backLabel={`Back to Chapter ${chapterNumber}`}
      startAt={startAt}
    />
  );
}
