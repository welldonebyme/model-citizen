// A small index of the whole question bank for the drill builder (id, format, source, objective, topic,
// difficulty): enough to filter and count. The questions themselves load per chapter / mock when a drill
// starts (quiz/data/chNN.json, exams/data/mockN.json).
import type { APIRoute } from 'astro';
import { allQuestions } from '../../../lib/questions';

export const GET: APIRoute = () => {
  const items = allQuestions().map((q) => {
    const d = (q as { difficulty?: unknown }).difficulty;
    return { id: q.id, format: q.format, source: q.source, objective: q.objective, topic: q.topic, ...(d !== undefined ? { difficulty: d } : {}) };
  });
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
