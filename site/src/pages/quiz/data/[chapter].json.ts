// Static JSON of one chapter's quiz questions (lesson checkpoints and drills load only what they need).
import type { APIRoute } from 'astro';
import { chapterQuizzes } from '../../../lib/questions';

export function getStaticPaths() {
  return chapterQuizzes().map((c) => ({ params: { chapter: c.id }, props: { id: c.id } }));
}

export const GET: APIRoute = ({ props }) => {
  const c = chapterQuizzes().find((x) => x.id === (props as { id: string }).id)!;
  return new Response(JSON.stringify({ id: c.id, number: c.number, questions: c.questions }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
