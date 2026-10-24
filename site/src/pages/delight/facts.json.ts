// Course facts for XP and badges (lab steps, first dbt project lab, first green build step, question
// formats, chapter quiz order). Small; the badge panel and the celebration host load it when needed.
import type { APIRoute } from 'astro';
import { chapters } from '../../lib/content';
import { allQuestions } from '../../lib/questions';
import { buildFacts } from '../../lib/gamification-facts';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildFacts(chapters, allQuestions(), 15)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
