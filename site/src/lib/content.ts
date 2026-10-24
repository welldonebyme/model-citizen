// Build-time access to the generated book content (site/src/generated, written by converter/).
// Navigation is derived from chapters/*.json so pages only depend on the chapter files.
// Until the converter has run, a one-chapter sample keeps every page buildable in development.
import type { Chapter, Lesson } from './content-types';
import { sampleBlocks } from '../dev/sample';

const CHAPTER_FILES = import.meta.glob('../generated/chapters/*.json', { eager: true, import: 'default' }) as Record<string, Chapter>;

const SAMPLE: Chapter = {
  id: 'ch04', number: 4, part: 1, partTitle: 'Foundations Refresh', title: 'SQL from Zero to Exam Level (sample)', label: 'ch:sql',
  intro: sampleBlocks.slice(0, 2), quiz: [], summary: sampleBlocks.slice(-1), objectives: ['CP0-SQL', '1.2'], minutes: 60,
  lessons: [
    { id: 'ch04-s4', number: '4.4', title: ['NULL: the value that is not a value'], titleText: 'NULL: the value that is not a value', anchors: [], minutes: 25, labs: ['ch04-lab3'], objectives: ['CP0-SQL'], checkpoints: [],
      steps: [
        { id: 'ch04-s4-0', title: ['NULL: the value that is not a value'], titleText: 'NULL: the value that is not a value', blocks: sampleBlocks.slice(2, 4) },
        { id: 'ch04-s4-1', title: ['Three-valued logic'], titleText: 'Three-valued logic', blocks: sampleBlocks.slice(5, 8) },
        { id: 'ch04-s4-2', title: ['IS NULL, not = NULL'], titleText: 'IS NULL, not = NULL', blocks: sampleBlocks.slice(8, 12) },
        { id: 'ch04-s4-3', title: ['Code in every language'], titleText: 'Code in every language', blocks: sampleBlocks.slice(12, 17) },
        { id: 'ch04-s4-4', title: ['Practice'], titleText: 'Practice', blocks: sampleBlocks.slice(17, 19) },
      ] },
    { id: 'ch04-s5', number: '4.5', title: ['ORDER BY, LIMIT and DISTINCT'], titleText: 'ORDER BY, LIMIT and DISTINCT', anchors: [], minutes: 15, labs: [], objectives: [], checkpoints: [],
      steps: [{ id: 'ch04-s5-0', title: ['ORDER BY, LIMIT and DISTINCT'], titleText: 'ORDER BY, LIMIT and DISTINCT', blocks: sampleBlocks.slice(17, 18) }] },
  ],
};

export const usingSample = Object.keys(CHAPTER_FILES).length === 0;

export const chapters: Chapter[] = (usingSample ? [SAMPLE] : Object.values(CHAPTER_FILES))
  .slice()
  .sort((a, b) => a.number - b.number);

export function chapter(id: string): Chapter {
  const c = chapters.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown chapter ${id}`);
  return c;
}

export interface LessonRef { chapter: Chapter; lesson: Lesson; index: number }

/** Every lesson in reading order. */
export const lessons: LessonRef[] = chapters.flatMap((c) => c.lessons.map((lesson) => ({ chapter: c, lesson, index: 0 })))
  .map((r, index) => ({ ...r, index }));

export function lessonRef(id: string): LessonRef {
  const r = lessons.find((x) => x.lesson.id === id);
  if (!r) throw new Error(`Unknown lesson ${id}`);
  return r;
}

export function neighbours(id: string): { prev?: LessonRef; next?: LessonRef } {
  const i = lessons.findIndex((x) => x.lesson.id === id);
  return { prev: lessons[i - 1], next: lessons[i + 1] };
}

export interface PartGroup { part: number; title: string; chapters: Chapter[] }
export const parts: PartGroup[] = chapters.reduce<PartGroup[]>((acc, c) => {
  let g = acc.find((p) => p.part === c.part);
  if (!g) { g = { part: c.part, title: c.partTitle, chapters: [] }; acc.push(g); }
  g.chapters.push(c);
  return acc;
}, []);

export const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const partName = (n: number) => (n >= 0 && n < ROMAN.length ? `Part ${ROMAN[n]}` : 'Appendix');

/** Route helpers (relative to the base path; pass through url()). */
export const routes = {
  chapter: (c: { id: string }) => `learn/${c.id}/`,
  lesson: (l: { id: string }, chapterId: string) => `learn/${chapterId}/${l.id}/`,
  quiz: (c: { id: string }) => `quiz/${c.id}/`,
};
