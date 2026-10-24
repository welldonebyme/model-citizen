// Build-time facts about the course that the Today page and the dashboard both pass to their islands:
// which objective each question tests, quiz sizes, lab titles and how many ticked steps finish each lab.
import { chapters, lessons } from './content';
import type { Block } from './content-types';
import { labStepRefs } from './lab-steps';

const QFILES = import.meta.glob('../generated/questions/*.json', { eager: true, import: 'default' }) as Record<string, { id: string; objective?: string }[]>;
const MFILES = import.meta.glob('../generated/mocks/*.json', { eager: true, import: 'default' }) as Record<string, { questions?: { id: string; objective?: string }[] }>;

/** Question id → objective id, for all chapter and mock questions. */
export const questionObjectives: Record<string, string> = {};
for (const qs of Object.values(QFILES)) for (const q of qs) if (q.objective) questionObjectives[q.id] = q.objective;
for (const m of Object.values(MFILES)) for (const q of m.questions ?? []) if (q.objective) questionObjectives[q.id] = q.objective;

/** Chapter quizzes that count for readiness (Chapters 0 to 26; Chapter 27 is the mock exams). */
export const chapterQuiz: [string, number][] = chapters.filter((c) => c.quiz.length && c.number <= 26).map((c) => [c.id, c.quiz.length]);
export const chapterTitles: Record<string, string> = Object.fromEntries(chapters.map((c) => [c.id, c.title]));

const text = (c: unknown[]): string => c.map((n) => (typeof n === 'string' ? n : (n as { v?: string; c?: unknown[] }).v ?? text((n as { c?: unknown[] }).c ?? []))).join('');

/** Lab id → title, and lab id → number of ticks that finish it (see lab-steps.ts). */
export const labTitles: Record<string, string> = {};
export const labSteps: Record<string, number> = {};
export const labChapter: Record<string, string> = {};
const walk = (bs: Block[], chapterId: string) => bs.forEach((b) => {
  if (b.t === 'lab') {
    labTitles[b.id] = text(b.title);
    labChapter[b.id] = chapterId;
    labSteps[b.id] = labStepRefs(b).length;
  }
  if (b.t === 'callout' || b.t === 'lab') walk(b.blocks, chapterId);
  if (b.t === 'list') b.items.forEach((it) => walk(it.blocks, chapterId));
});
lessons.forEach(({ chapter, lesson }) => lesson.steps.forEach((st) => walk(st.blocks, chapter.id)));
