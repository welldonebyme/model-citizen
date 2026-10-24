// Drills: filter the whole question bank and pick a custom quiz.
import type { Format, Question } from '../content-types';
import { seededShuffle } from '../scoring';
import { objectivesOfChapter } from './objectives';
import { questionTopic } from './results';

export type SourceKey = 'chapters' | 'mock1' | 'mock2' | 'mock3';

export interface DrillFilter {
  topics: number[];          // empty = all
  objectives: string[];      // empty = all
  formats: Format[];         // empty = all
  sources: SourceKey[];      // empty = all
  difficulties: string[];    // empty = all (only when questions carry a difficulty)
  only: 'all' | 'mistakes' | 'unseen';
}

export const EMPTY_FILTER: DrillFilter = { topics: [], objectives: [], formats: [], sources: [], difficulties: [], only: 'all' };

export const sourceKey = (q: Question): SourceKey => (q.source.kind === 'chapter' ? 'chapters' : (`mock${q.source.mock}` as SourceKey));

/** Objectives a question belongs to: its own, or (chapter quizzes without one) those its chapter teaches. */
export function questionObjectives(q: Question): string[] {
  if (q.objective) return [q.objective];
  return q.source.kind === 'chapter' ? objectivesOfChapter(q.source.chapter) : [];
}

export const difficultyOf = (q: Question): string | undefined => {
  const d = (q as Question & { difficulty?: unknown }).difficulty;
  return d === undefined || d === null ? undefined : String(d);
};

export function filterBank(bank: Question[], f: DrillFilter, history: { seen: Set<string>; mistakes: Set<string> }): Question[] {
  return bank.filter((q) => {
    if (f.topics.length) { const t = questionTopic(q); if (t === undefined || !f.topics.includes(t)) return false; }
    if (f.objectives.length && !questionObjectives(q).some((o) => f.objectives.includes(o))) return false;
    if (f.formats.length && !f.formats.includes(q.format)) return false;
    if (f.sources.length && !f.sources.includes(sourceKey(q))) return false;
    if (f.difficulties.length) { const d = difficultyOf(q); if (!d || !f.difficulties.includes(d)) return false; }
    if (f.only === 'mistakes' && !history.mistakes.has(q.id)) return false;
    if (f.only === 'unseen' && history.seen.has(q.id)) return false;
    return true;
  });
}

/** A random selection of `count` questions (all of them when count is 0), reproducible with the seed. */
export function pick(questions: Question[], count: number, seed: number): Question[] {
  const shuffled = seededShuffle(questions, seed);
  return count > 0 ? shuffled.slice(0, count) : shuffled;
}
