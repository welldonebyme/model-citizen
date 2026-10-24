import { describe, expect, it } from 'vitest';
import { masteryByObjective, masteryLevel, quizzesAt80, mocksAt80, labsDone, minutesByDay } from '../../src/lib/progress-summary';
import type { Answer, ExamAttempt, Progress } from '../../src/lib/store/db';

const A = (qid: string, correct: boolean, at: number, mode: Answer['mode'] = 'quiz'): Answer => ({ qid, correct, at, mode, response: null });
const P = (kind: Progress['kind'], ref: string, data?: Record<string, unknown>): Progress => ({ id: `${kind}:${ref}`, kind, ref, status: 'done', firstAt: 1, updatedAt: 1, data });

describe('progress summary', () => {
  it('mastery uses the latest answer per question', () => {
    const m = masteryByObjective([A('q1', false, 1), A('q1', true, 2), A('q2', false, 3)], { q1: '1.1', q2: '1.1', q3: '1.2' });
    expect(m.get('1.1')).toEqual({ correct: 1, answered: 2, available: 2 });
    expect(m.get('1.2')).toEqual({ correct: 0, answered: 0, available: 1 });
    expect(masteryLevel(m.get('1.1'))).toBe(1);
    expect(masteryLevel({ correct: 4, answered: 5, available: 9 })).toBe(2);
    expect(masteryLevel(undefined)).toBe(0);
  });
  it('quizzes at 80% from progress rows or from answers', () => {
    const cq = new Map([['ch07', 10], ['ch08', 5]]);
    const r1 = quizzesAt80([P('chapter', 'ch07', { best: 8, total: 10 })], [], cq);
    expect(r1.ok).toBe(1);
    const answers = ['01', '02', '03', '04'].map((n) => A(`q-ch08-${n}`, true, 1));
    expect(quizzesAt80([], answers, cq).ok).toBe(1); // 4 of 5 = 80%
  });
  it('mocks count once per mock, exam mode only', () => {
    const at = (mock: number, mode: 'exam' | 'practice', pct: number) => ({ mock, mode, status: 'finished', score: { pct, correct: 0, total: 65 } }) as unknown as ExamAttempt;
    expect(mocksAt80([at(1, 'exam', 82), at(1, 'exam', 90), at(2, 'practice', 95), at(3, 'exam', 79)])).toBe(1);
  });
  it('labs are done when every step is ticked', () => {
    const r = labsDone([P('labstep', 'ch07-lab1:1'), P('labstep', 'ch07-lab1:2'), P('labstep', 'ch07-lab2:1')], { 'ch07-lab1': 2, 'ch07-lab2': 3 });
    expect([...r.done]).toEqual(['ch07-lab1']);
    expect(r.started.size).toBe(2);
  });
  it('minutes by day fills missing days', () => {
    const d = minutesByDay([{ date: '2026-10-24', minutes: 30, events: 2, updatedAt: 0 }], 3, new Date(2026, 9, 24));
    expect(d.map((x) => x.minutes)).toEqual([0, 0, 30]);
    expect(d[0].date).toBe('2026-10-22');
  });
});
