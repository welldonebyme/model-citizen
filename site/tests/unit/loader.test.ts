// The build-time loaders: question bank (generated files, else fixtures) and "what to review" links.
import { describe, expect, it } from 'vitest';
import { allQuestions, chapterQuizzes, mock, mocks, questionSource, skipped } from '../../src/lib/questions';
import { objectiveLinks } from '../../src/lib/exam/links';
import { isPlayable } from '../../src/lib/exam/validate';
import { OBJECTIVES } from '../../src/lib/exam/objectives';

describe('question loader', () => {
  it('serves chapter quizzes and mocks, all playable, ids unique', () => {
    const quizzes = chapterQuizzes();
    expect(quizzes.length).toBeGreaterThan(0);
    expect(quizzes.find((c) => c.id === 'ch07')?.questions.length).toBeGreaterThanOrEqual(8);
    expect(mock(1)?.questions[0].id).toBe('m1-q01');
    const all = allQuestions();
    expect(all.every(isPlayable)).toBe(true);
    expect(new Set(all.map((q) => q.id)).size).toBe(all.length);
    expect(mocks().map((m) => m.n)).toEqual(questionSource.mocks === 'generated' ? [1, 2, 3] : [1]);
  });
  it('lists what it left out, with a reason', () => {
    for (const s of skipped) expect(s.reason.length).toBeGreaterThan(3);
    if (questionSource.mocks === 'generated') expect(mocks().reduce((n, m) => n + m.questions.length, 0) + skipped.filter((s) => s.id.startsWith('m')).length).toBe(195);
  });
});

describe('review links', () => {
  it('gives every objective at least one place to learn it', () => {
    const links = objectiveLinks();
    for (const o of OBJECTIVES) expect(links[o.id]?.length, o.id).toBeGreaterThan(0);
    expect(links['1.11'].some((l) => /learn\/ch14\//.test(l.href))).toBe(true);
  });
});
