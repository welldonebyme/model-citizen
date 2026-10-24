import { describe, expect, it } from 'vitest';
import type { Answer, ExamAttempt, Progress, SrsCard, Activity, Note } from '../../src/lib/store/db';
import {
  BADGES, LEVELS, XP, bestRun, bestStreak, computeGame, explainOwnWords, levelFor, newBadges, perfectQuizzes,
  type GameData, type GameFacts,
} from '../../src/lib/gamification';
import { buildFacts, labsOf } from '../../src/lib/gamification-facts';
import type { Chapter, Question } from '../../src/lib/content-types';

const facts: GameFacts = {
  v: 1,
  labSteps: { 'ch06-lab3': 3, 'ch07-lab3': 2, 'ch08-lab1': 4, 'ch09-lab1': 1, ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`ch26-lab${i + 1}`, 2])) },
  firstModelLab: 'ch06-lab3',
  greenBuildStep: 'ch07-lab3:2',
  formats: {
    'q-ch07-01': 'mc', 'q-ch07-02': 'ms', 'q-ch07-03': 'fill', 'q-ch07-04': 'match', 'q-ch07-05': 'hotspot', 'q-ch07-06': 'order', 'q-ch07-07': 'domc',
    ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`m1-q${i + 1}`, 'domc' as const])),
  },
  quizzes: { ch07: ['q-ch07-01', 'q-ch07-02', 'q-ch07-03'] },
  capstoneMilestones: 15,
};

const empty: GameData = { progress: [], answers: [], attempts: [], srs: [], notes: [], activity: [] };
const prog = (kind: Progress['kind'], ref: string, status: Progress['status'] = 'done'): Progress => ({ id: `${kind}:${ref}`, kind, ref, status, firstAt: 1, updatedAt: 1 });
let t = 1000;
const ans = (qid: string, correct: boolean, mode: Answer['mode'] = 'quiz'): Answer => ({ qid, correct, mode, response: null, at: t++ });
const day = (date: string, events = 1, minutes = 0): Activity => ({ date, events, minutes, updatedAt: 1 });
const NOW = new Date(2026, 9, 24, 12);

describe('levels', () => {
  it('starts at Seed and ends at Model citizen, thresholds increase', () => {
    expect(levelFor(0)).toMatchObject({ n: 1, name: 'Seed', toNext: 300 });
    expect(levelFor(299).name).toBe('Seed');
    expect(levelFor(300).name).toBe('Source');
    expect(levelFor(1_000_000)).toMatchObject({ n: 8, name: 'Model citizen', progress: 1, toNext: 0, next: undefined });
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i].min).toBeGreaterThan(LEVELS[i - 1].min);
  });
  it('progress is the share of the way to the next level', () => {
    expect(levelFor(650).progress).toBeCloseTo((650 - 300) / 700);
  });
});

describe('XP from real progress', () => {
  it('nothing done, no XP', () => {
    const g = computeGame(empty, facts, NOW);
    expect(g.xp).toBe(0);
    expect(g.badges.every((b) => !b.earned)).toBe(true);
    expect(g.badges.map((b) => b.id)).toEqual(BADGES.map((b) => b.id));
  });
  it('counts steps, lessons, lab steps and finished labs', () => {
    const g = computeGame({ ...empty, progress: [
      prog('step', 'ch07-s1-0', 'understood'), prog('step', 'ch07-s1-1', 'seen'), prog('lesson', 'ch07-s1'), prog('lesson', 'ch07-s2', 'seen'),
      prog('labstep', 'ch06-lab3:1'), prog('labstep', 'ch06-lab3:2'), prog('labstep', 'ch06-lab3:3'), prog('labstep', 'ch08-lab1:1'),
    ] }, facts, NOW);
    expect(g.parts.lessons).toBe(XP.step + XP.lesson);
    expect(g.parts.labs).toBe(4 * XP.labStep + XP.lab);
    expect(g.stats.labsDone).toBe(1);
    expect(g.badges.find((b) => b.id === 'first-model')?.earned).toBe(true);
    expect(g.badges.find((b) => b.id === 'first-lesson')?.earned).toBe(true);
    expect(g.badges.find((b) => b.id === 'green-build')?.earned).toBe(false);
  });
  it('a lab without numbered steps is finished by its single "done" tick', () => {
    const g = computeGame({ ...empty, progress: [prog('labstep', 'ch09-lab1:done')] }, facts, NOW);
    expect(g.stats.labsDone).toBe(1);
    expect(g.parts.labs).toBe(XP.labStep + XP.lab);
  });
  it('first model shows its progress while not finished', () => {
    const g = computeGame({ ...empty, progress: [prog('labstep', 'ch06-lab3:1')] }, facts, NOW);
    expect(g.badges.find((b) => b.id === 'first-model')).toMatchObject({ earned: false, progress: { value: 1, target: 3 } });
  });
  it('answers: 1 XP each, a bonus the first time a question is right, flashcard answers are not questions', () => {
    const g = computeGame({ ...empty, answers: [ans('q-ch07-01', false), ans('q-ch07-01', true), ans('q-ch07-01', true), ans('trap-001', true, 'flashcard')] }, facts, NOW);
    expect(g.parts.questions).toBe(3 * XP.answer + XP.firstRight);
    expect(g.stats.answers).toBe(3);
  });
  it('mocks: only timed (exam mode) finished attempts, bonus at 80%', () => {
    const at = (mock: number, pct: number, mode: 'exam' | 'practice' = 'exam', status: ExamAttempt['status'] = 'finished') =>
      ({ id: `m${mock}-${pct}-${mode}`, mock, mode, status, score: { correct: pct, total: 100, pct } } as unknown as ExamAttempt);
    const g = computeGame({ ...empty, attempts: [at(1, 70), at(1, 85), at(2, 90, 'practice'), at(3, 95, 'exam', 'active')] }, facts, NOW);
    expect(g.parts.mocks).toBe(2 * XP.mock + XP.mock80);
    expect(g.badges.find((b) => b.id === 'mock-80')?.earned).toBe(true);
    expect(g.badges.find((b) => b.id === 'two-mocks')).toMatchObject({ earned: false, progress: { value: 1, target: 2 } });
    const two = computeGame({ ...empty, attempts: [at(1, 80), at(2, 81)] }, facts, NOW);
    expect(two.badges.find((b) => b.id === 'two-mocks')?.earned).toBe(true);
    const same = computeGame({ ...empty, attempts: [at(1, 80), at(1, 90)] }, facts, NOW);
    expect(same.badges.find((b) => b.id === 'two-mocks')?.earned).toBe(false); // two different mocks
  });
  it('reviews are estimated from the Leitner boxes, question cards excluded', () => {
    const card = (id: string, box: number, lapses: number, kind: SrsCard['kind'] = 'trap', lastAt: number | undefined = 1): SrsCard => ({ id, kind, box, lapses, due: '2026-10-30', lastAt, updatedAt: 1 });
    const g = computeGame({ ...empty, srs: [card('a', 3, 1), card('b', 1, 0, 'term', undefined), card('q', 4, 2, 'question')] }, facts, NOW);
    expect(g.stats.reviews).toBe(3);
    expect(g.parts.reviews).toBe(3 * XP.review);
  });
  it('habits: study days, focus minutes, explain notes with real words', () => {
    const note = (ch: string, text: string): Note => ({ id: `explain:${ch}`, kind: 'explain', ref: ch, text, createdAt: 1, updatedAt: 1 });
    const g = computeGame({ ...empty,
      activity: [day('2026-10-22', 3, 25), day('2026-10-23', 0, 0), day('2026-10-24', 1, 52)],
      notes: [note('ch07', 'Explain it back: Chapter 7, Models\n## The idea in simple words\nA model is a select statement saved in a file; dbt builds it.\n## Why it matters\n'), note('ch08', 'Explain it back: Chapter 8\n## The idea in simple words\n\n')],
    }, facts, NOW);
    expect(g.stats.studyDays).toBe(2);
    expect(g.stats.focusMinutes).toBe(77);
    expect(g.stats.explainNotes).toBe(1);
    expect(g.parts.habits).toBe(2 * XP.day + 15 * XP.focus5 + XP.explain);
    expect(g.badges.find((b) => b.id === 'explain')?.earned).toBe(true);
  });
});

describe('badges', () => {
  it('streaks: the best run of days ever, the current run ending today or yesterday', () => {
    expect(bestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'])).toBe(3);
    expect(bestStreak(['2026-03-28', '2026-03-29', '2026-03-30'])).toBe(3); // across a summer-time change
    expect(bestStreak([])).toBe(0);
    const dates = Array.from({ length: 7 }, (_, i) => `2026-10-${String(10 + i).padStart(2, '0')}`);
    const g = computeGame({ ...empty, activity: dates.map((d) => day(d)) }, facts, NOW);
    expect(g.streak).toEqual({ current: 0, best: 7 });
    expect(g.badges.find((b) => b.id === 'streak-7')?.earned).toBe(true);
    expect(g.badges.find((b) => b.id === 'streak-30')).toMatchObject({ earned: false, progress: { value: 7, target: 30 } });
  });
  it('DOMC master: 20 DOMC questions right in a row, other formats do not break the run', () => {
    const run = (n: number, wrongAt?: number) => Array.from({ length: n }, (_, i) => ans(`m1-q${i + 1}`, i !== wrongAt, 'mock-exam'));
    expect(bestRun(run(20), (a) => facts.formats[a.qid] === 'domc')).toBe(20);
    const mixed = [...run(10), ans('q-ch07-01', false), ...run(10).map((a) => ({ ...a, at: t++ }))];
    expect(computeGame({ ...empty, answers: mixed }, facts, NOW).badges.find((b) => b.id === 'domc-master')?.earned).toBe(true);
    const broken = run(21, 10);
    const g = computeGame({ ...empty, answers: broken }, facts, NOW);
    expect(g.stats.domcBestRun).toBe(10);
    expect(g.badges.find((b) => b.id === 'domc-master')).toMatchObject({ earned: false, progress: { value: 10, target: 20 } });
  });
  it('every format: one right answer in each of the 7 formats', () => {
    const six = ['q-ch07-01', 'q-ch07-02', 'q-ch07-03', 'q-ch07-04', 'q-ch07-05', 'q-ch07-06'].map((q) => ans(q, true));
    expect(computeGame({ ...empty, answers: six }, facts, NOW).badges.find((b) => b.id === 'all-formats')).toMatchObject({ earned: false, progress: { value: 6, target: 7 } });
    expect(computeGame({ ...empty, answers: [...six, ans('q-ch07-07', true)] }, facts, NOW).badges.find((b) => b.id === 'all-formats')?.earned).toBe(true);
  });
  it('perfect quiz: a full round in order, all right; a retry of the missed ones does not count', () => {
    const ids = facts.quizzes.ch07;
    expect(perfectQuizzes(ids.map((q) => ans(q, true)), facts.quizzes)).toEqual(['ch07']);
    // round 1: first one wrong, then the retry of that question: never a full round
    const retry = [ans(ids[0], false), ans(ids[1], true), ans(ids[2], true), ans(ids[0], true)];
    expect(perfectQuizzes(retry, facts.quizzes)).toEqual([]);
    // a later full round, all right, counts
    expect(perfectQuizzes([...retry, ...ids.map((q) => ans(q, true))], facts.quizzes)).toEqual(['ch07']);
    // drills answer the same questions in another order: not a chapter quiz
    expect(perfectQuizzes(ids.map((q) => ans(q, true, 'drill')), facts.quizzes)).toEqual([]);
  });
  it('capstone (every requirement of the 15 milestones ticked), notebook and long memory', () => {
    const caps = Array.from({ length: 15 }, (_, i) => [prog('labstep', `ch26-lab${i + 1}:r1`), prog('labstep', `ch26-lab${i + 1}:r2`)]).flat();
    const cards = Array.from({ length: 20 }, (_, i): SrsCard => ({ id: `trap-${i}`, kind: 'trap', box: 5, lapses: 0, due: '2026-12-01', lastAt: 1, updatedAt: 1 }));
    const g = computeGame({ ...empty, progress: caps, srs: cards, settings: { notebookReread: '2026-10-20' } }, facts, NOW);
    for (const id of ['capstone', 'notebook', 'long-memory']) expect(g.badges.find((b) => b.id === id)?.earned).toBe(true);
    expect(g.parts.labs).toBe(30 * XP.labStep + 15 * XP.lab + 15 * XP.capstone);
    const partial = computeGame({ ...empty, progress: caps.slice(1) }, facts, NOW);
    expect(partial.badges.find((b) => b.id === 'capstone')).toMatchObject({ earned: false, progress: { value: 14, target: 15 } });
  });
  it('newBadges lists only badges earned and not seen', () => {
    const g = computeGame({ ...empty, progress: [prog('lesson', 'ch01-s1')] }, facts, NOW);
    expect(newBadges(g, []).map((b) => b.id)).toEqual(['first-lesson']);
    expect(newBadges(g, ['first-lesson'])).toEqual([]);
  });
  it('explain notes: header and prompt lines are not own words', () => {
    expect(explainOwnWords('Explain it back: Chapter 7\n## The idea in simple words\n## Why it matters\n')).toBe(0);
    expect(explainOwnWords('## The idea in simple words\nabc def')).toBe(7);
  });
});

describe('facts from the book', () => {
  const p = (text: string) => ({ t: 'p' as const, c: [text] });
  const code = (lang: 'bash' | 'output', text: string, id = 'c') => ({ t: 'code' as const, id, lang, text });
  const ch = (id: string, number: number, labs: { id: string; steps: unknown[][] }[]): Chapter => ({
    id, number, part: 2, partTitle: '', title: id, label: '', intro: [], quiz: [], summary: [], objectives: [], minutes: 1,
    lessons: [{ id: `${id}-s1`, number: '1', title: [], titleText: '', anchors: [], minutes: 1, labs: labs.map((l) => l.id), objectives: [], checkpoints: [], steps: [{ id: `${id}-s1-0`, title: [], titleText: '', blocks: labs.map((l) => ({ t: 'lab', id: l.id, title: [], objectives: [], blocks: [p('intro'), { t: 'list', kind: 'ol', items: l.steps.map((blocks) => ({ blocks })) }] })) as never }] }],
  });
  const chapters = [
    ch('ch06', 6, [{ id: 'ch06-lab1', steps: [[p('mkdir')]] }, { id: 'ch06-lab2', steps: [[{ t: 'p', c: ['In the project, run ', { t: 'code', v: 'dbt run' }, '.'] }], [p('look')]] }, { id: 'ch06-lab3', steps: [[code('bash', '(.venv) $ dbt run')]] }]),
    ch('ch07', 7, [{ id: 'ch07-lab1', steps: [[code('bash', '$ dbt build')], [code('bash', '$ dbt build'), code('output', 'Completed successfully\nDone. PASS=17 WARN=0 ERROR=0 SKIP=0')]] }]),
  ];
  const qs = [
    { id: 'q-ch07-02', format: 'mc', source: { kind: 'chapter', chapter: 7, n: 2 } },
    { id: 'q-ch07-01', format: 'domc', source: { kind: 'chapter', chapter: 7, n: 1 } },
    { id: 'm1-q1', format: 'fill', source: { kind: 'mock', mock: 1, n: 1 } },
  ] as unknown as Question[];
  it('finds lab ticks, the first project lab, the first green build and the quiz order', () => {
    expect(labsOf(chapters).map((l) => [l.id, l.steps.map((s) => s.n)])).toEqual([['ch06-lab1', [1]], ['ch06-lab2', [1, 2]], ['ch06-lab3', [1]], ['ch07-lab1', [1, 2]]]);
    const f = buildFacts(chapters, qs, 15);
    expect(f.labSteps).toEqual({ 'ch06-lab1': 1, 'ch06-lab2': 2, 'ch06-lab3': 1, 'ch07-lab1': 2 });
    expect(f.firstModelLab).toBe('ch06-lab2');
    expect(f.greenBuildStep).toBe('ch07-lab1:2');
    expect(f.quizzes).toEqual({ ch07: ['q-ch07-01', 'q-ch07-02'] });
    expect(f.formats['m1-q1']).toBe('fill');
  });
});
