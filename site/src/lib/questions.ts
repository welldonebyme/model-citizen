// Build-time access to the question bank: chapter quizzes (generated/questions/chNN.json) and mock exams
// (generated/mocks/mockN.json), written by the converter. Until those files exist, the hand-transcribed
// fixtures in src/dev/fixtures/questions.json are used, so switching to the real bank is automatic.
//
// Use this module ONLY in Astro frontmatter and endpoints (it imports every question file eagerly).
// Islands get their questions as props or from the JSON endpoints (exams/data/, practice/drills/bank.json).
import type { Question } from './content-types';
import fixtureQuestions from '../dev/fixtures/questions.json';
import { playableReason } from './exam/validate';

type Json = unknown;
const CHAPTER_FILES = import.meta.glob('../generated/questions/*.json', { eager: true, import: 'default' }) as Record<string, Json>;
const MOCK_FILES = import.meta.glob('../generated/mocks/*.json', { eager: true, import: 'default' }) as Record<string, Json>;
const COVERAGE_FILE = import.meta.glob('../generated/coverage.json', { eager: true, import: 'default' }) as Record<string, Json>;

export interface MockMeta {
  id: string;            // "mock1"
  n: number;             // 1..3
  title: string;         // "Mock exam 1"
  description: string;
  durationMin: number;   // 120
  questions: Question[];
}

/** A file may hold a bare Question[] or an object with a `questions` array (plus meta). */
function questionsOf(raw: Json): Question[] {
  if (Array.isArray(raw)) return raw as Question[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { questions?: unknown }).questions)) return (raw as { questions: Question[] }).questions;
  return [];
}
const numFromPath = (p: string) => Number((p.match(/(\d+)\.json$/) ?? [])[1]);

/** Questions left out because their key cannot be graded yet (shown on the pages as a short notice). */
export const skipped: { id: string; reason: string }[] = [];
function playable(list: Question[]): Question[] {
  return list.filter((q) => {
    const why = playableReason(q);
    if (why) skipped.push({ id: q.id, reason: why });
    return !why;
  });
}

/** Chapter questions get their objective from the coverage file (objective -> chapterQuestions) when it lists them. */
const objectiveOfQuestion = new Map<string, string>();
{
  const cov = Object.values(COVERAGE_FILE)[0] as { objectives?: Record<string, { chapterQuestions?: string[] }> } | undefined;
  for (const [obj, v] of Object.entries(cov?.objectives ?? {})) for (const qid of v?.chapterQuestions ?? []) if (!objectiveOfQuestion.has(qid)) objectiveOfQuestion.set(qid, obj);
}
const withObjective = (q: Question): Question => (q.objective || !objectiveOfQuestion.has(q.id) ? q : { ...q, objective: objectiveOfQuestion.get(q.id) });

const fixtures = fixtureQuestions as unknown as Question[];
const generatedChapters = playable(Object.entries(CHAPTER_FILES).flatMap(([, raw]) => questionsOf(raw))).map(withObjective);
const generatedMocks = Object.entries(MOCK_FILES).map(([path, raw]) => ({ n: numFromPath(path), raw })).filter((m) => m.n >= 1);

/** Where the questions come from (shown as a small notice while the real bank is not converted yet). */
export const questionSource = {
  chapters: generatedChapters.length > 0 ? 'generated' : 'fixtures',
  mocks: generatedMocks.length > 0 ? 'generated' : 'fixtures',
} as const;

/** Number of questions a mock should have (the book's mocks have 65). */
export const MOCK_SIZE = 65;

const chapterBank: Question[] = (questionSource.chapters === 'generated' ? generatedChapters : fixtures.filter((q) => q.source.kind === 'chapter'))
  .slice()
  .sort((a, b) => (a.source.kind === 'chapter' && b.source.kind === 'chapter' ? a.source.chapter - b.source.chapter || a.source.n - b.source.n : 0));

const MOCK_THEME: Record<number, string> = {
  1: 'Standard difficulty, close to the real exam. Scenarios use the practice project jaffle_dbt.',
  2: 'Scenario-heavy: logs, compiled SQL, YAML errors and run results, for the company RideNow.',
  3: 'The hardest one: edge cases, defaults and precedence, for the company StreamBox.',
};

function mockMeta(n: number, raw: Json, questions: Question[]): MockMeta {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const meta = (o.meta && typeof o.meta === 'object' ? o.meta : o) as Record<string, unknown>;
  const minutes = Number(meta.durationMin ?? meta.minutes ?? meta.duration ?? 120);
  return {
    id: `mock${n}`, n,
    title: `Mock exam ${n}`,
    description: MOCK_THEME[n] ?? '',
    durationMin: Number.isFinite(minutes) && minutes > 0 ? minutes : 120,
    questions: questions.slice().sort((a, b) => a.source.n - b.source.n),
  };
}

const mockList: MockMeta[] = questionSource.mocks === 'generated'
  ? generatedMocks.map(({ n, raw }) => mockMeta(n, raw, playable(questionsOf(raw)))).sort((a, b) => a.n - b.n)
  : [1, 2, 3]
      .map((n) => mockMeta(n, null, fixtures.filter((q) => q.source.kind === 'mock' && q.source.mock === n)))
      .filter((m) => m.questions.length > 0);

export const chapterId = (n: number) => `ch${String(n).padStart(2, '0')}`;

export interface ChapterQuiz { id: string; number: number; questions: Question[] }

/** Every chapter that has quiz questions, in book order. */
export function chapterQuizzes(): ChapterQuiz[] {
  const by = new Map<number, Question[]>();
  for (const q of chapterBank) {
    if (q.source.kind !== 'chapter') continue;
    const list = by.get(q.source.chapter) ?? [];
    list.push(q);
    by.set(q.source.chapter, list);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([number, questions]) => ({ id: chapterId(number), number, questions }));
}

export function chapterQuiz(id: string): ChapterQuiz | undefined {
  return chapterQuizzes().find((c) => c.id === id);
}

/** The mock exams that exist (1..3). */
export function mocks(): MockMeta[] {
  return mockList;
}

export function mock(n: number): MockMeta | undefined {
  return mockList.find((m) => m.n === n);
}

/** Every question of the bank: chapter quizzes then mocks. */
export function allQuestions(): Question[] {
  return [...chapterBank, ...mockList.flatMap((m) => m.questions)];
}

export function questionById(id: string): Question | undefined {
  return allQuestions().find((q) => q.id === id);
}
