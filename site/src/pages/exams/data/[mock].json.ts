// Static JSON of a mock exam's questions (the results page of a past attempt loads it).
import type { APIRoute } from 'astro';
import { mocks } from '../../../lib/questions';

export function getStaticPaths() {
  return mocks().map((m) => ({ params: { mock: m.id }, props: { n: m.n } }));
}

export const GET: APIRoute = ({ props }) => {
  const m = mocks().find((x) => x.n === (props as { n: number }).n)!;
  return new Response(JSON.stringify({ id: m.id, n: m.n, title: m.title, durationMin: m.durationMin, questions: m.questions }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
