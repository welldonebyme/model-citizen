import { describe, expect, it } from 'vitest';
import { calendar, schedule, splitByMinutes, studyDayIndex, mission, readiness, STANDARD_WEEKS, type PlanLesson } from '../../src/lib/planner';

const L = (id: string, chapter: string, minutes = 20, labs: string[] = [], half?: 'a' | 'b'): PlanLesson => ({ id, chapter, minutes, title: id, number: id, labs, half });
const course: PlanLesson[] = STANDARD_WEEKS.flatMap((w) => w.chapters).filter((c, i, a) => a.indexOf(c) === i).flatMap((c) =>
  c === 'ch04' ? [L('ch04-s1', 'ch04', 20, [], 'a'), L('ch04-s2', 'ch04', 20, ['ch04-lab1'], 'a'), L('ch04-s10', 'ch04', 20, [], 'b')]
               : [L(`${c}-s1`, c), L(`${c}-s2`, c, 30, [`${c}-lab1`])]);

describe('rhythms', () => {
  it('standard has 14 weeks, intensive 8, relaxed 23', () => {
    expect(calendar('standard')).toHaveLength(14);
    expect(calendar('intensive')).toHaveLength(8);
    expect(calendar('relaxed')).toHaveLength(23);
  });
  it('every lesson is scheduled exactly once, in order, in every rhythm', () => {
    for (const r of ['standard', 'intensive', 'relaxed'] as const) {
      const flat = schedule(course, r).flat();
      expect(flat).toEqual(course.map((l) => l.id));
      expect(schedule(course, r)).toHaveLength(calendar(r).length * 6);
    }
  });
  it('splits Chapter 4 between weeks 2 and 3', () => {
    const d = schedule(course, 'standard');
    expect(d.slice(6, 12).flat()).toContain('ch04-s2');
    expect(d.slice(12, 18).flat()).toContain('ch04-s10');
  });
});

describe('days and missions', () => {
  it('counts 6 study days per calendar week', () => {
    expect(studyDayIndex('2026-10-24', '2026-10-24')).toBe(0);
    expect(studyDayIndex('2026-10-24', '2026-10-30')).toBe(5);
    expect(studyDayIndex('2026-10-24', '2026-10-31')).toBe(6);
  });
  it('balances minutes without reordering', () => {
    const g = splitByMinutes([{ minutes: 10 }, { minutes: 10 }, { minutes: 10 }, { minutes: 10 }], 2);
    expect(g.map((x) => x.length)).toEqual([2, 2]);
  });
  it('catches up late lessons first and adds review and labs', () => {
    const days = schedule(course, 'standard');
    const m = mission({ days, dayIndex: 2, done: new Set(), dueCards: 3, lessons: new Map(course.map((l) => [l.id, l])), chapterQuiz: new Map(), quizDone: new Set() });
    expect(m.items[0].kind).toBe('review');
    expect(m.items[1].refs).toEqual([days.flat()[0]]);
    expect(m.behind).toBeGreaterThan(0);
  });
  it('readiness needs all four conditions', () => {
    const base = { quizzes: { ok: 27, total: 27 }, capstone: { ok: 15, total: 15 }, mocks: { ok: 2, total: 2 as const }, notebook: { reread: true, notes: 4 } };
    expect(readiness(base).ready).toBe(true);
    expect(readiness({ ...base, mocks: { ok: 1, total: 2 } }).ready).toBe(false);
  });
});
