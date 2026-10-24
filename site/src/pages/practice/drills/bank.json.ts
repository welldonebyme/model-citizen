// The whole playable question bank as static JSON (chapter quizzes + mocks), loaded by the drills page.
import type { APIRoute } from 'astro';
import { allQuestions } from '../../../lib/questions';

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ questions: allQuestions() }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
