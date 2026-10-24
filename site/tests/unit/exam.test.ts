import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import type { Question } from '../../src/lib/content-types';
import fixtures from '../../src/dev/fixtures/questions.json';
import { domcCurrent, domcInit, domcJudge, domcResponse, domcShown, fromStored, toStored } from '../../src/lib/exam/domc';
import { accrue, blanksOf, finishAttempt, goTo, isComplete, newAttempt, progressOf, setDomc, setResponse, toggleFlag, scoreOf, remainingMs } from '../../src/lib/exam/engine';
import { breakdown, checkpoints, outcomesOf, pacing, verdict, weakest, questionTopic } from '../../src/lib/exam/results';
import { filterBank, pick, EMPTY_FILTER, questionObjectives } from '../../src/lib/exam/bank';
import { describeKey, describeResponse, plain } from '../../src/lib/exam/describe';
import { clock, mss, spoken } from '../../src/lib/exam/time';
import { grade } from '../../src/lib/scoring';
import { playableReason } from '../../src/lib/exam/validate';
import { db } from '../../src/lib/store/db';
import { answerHistory, errorNoteText, recordMany, recordOutcome, ruleOf, saveRule } from '../../src/lib/exam/learning';

const bank = fixtures as unknown as Question[];
const byId = (id: string) => bank.find((q) => q.id === id)!;
const domcQ = byId('m1-q08'); // A-YES, B-NO, C-YES, D-YES, E-YES
const rulesEarly = { earlyEnd: true, extraOption: false };

describe('fixtures follow the schema', () => {
  it('cover all 7 formats and have valid keys', () => {
    expect(new Set(bank.map((q) => q.format))).toEqual(new Set(['mc', 'ms', 'fill', 'match', 'hotspot', 'order', 'domc']));
    for (const q of bank) {
      const ids = (q.options ?? []).map((o) => o.id);
      if (q.format === 'mc') expect(ids).toContain(q.key);
      if (q.format === 'ms') expect((q.key as string[]).length).toBe(q.choose);
      if (q.format === 'order') expect([...(q.key as string[])].sort()).toEqual([...ids].sort());
      if (q.format === 'domc') expect(Object.keys(q.key as object).sort()).toEqual(ids);
      if (q.format === 'hotspot') {
        const code = q.stem.find((b) => b.t === 'code' && b.id === q.hotspot!.codeId) as { text: string };
        expect(code.text.split('\n').length).toBe(q.hotspot!.lines);
      }
    }
    expect(bank.filter((q) => q.format === 'domc' && Object.values(q.key as object).filter(Boolean).length >= 2).length).toBeGreaterThanOrEqual(2);
  });
});

describe('DOMC state', () => {
  it('shows options one at a time, in a reproducible shuffled order', () => {
    const a = domcInit(domcQ, { shuffle: true, seed: 7 });
    const b = domcInit(domcQ, { shuffle: true, seed: 7 });
    expect(a.order).toEqual(b.order);
    expect([...a.order].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(domcCurrent(domcQ, a, rulesEarly)?.option).toBe(a.order[0]);
  });
  it('ends early on a wrong judgment', () => {
    let st = domcInit(domcQ, { shuffle: false, seed: 0 });
    st = domcJudge(domcQ, st, rulesEarly, false); // A is YES: wrong
    expect(st.done).toBe(true);
    expect(domcShown(st)).toBe(1);
    expect(grade(domcQ, domcResponse(st)).correct).toBe(false);
  });
  it('ends when every YES option is endorsed; the extra option is shown but never scored', () => {
    const rules = { earlyEnd: true, extraOption: true };
    let st = domcInit(domcQ, { shuffle: false, seed: 0 });
    for (const yes of [true, false, true, true]) st = domcJudge(domcQ, st, rules, yes); // A..D right
    expect(st.done).toBe(false);
    st = domcJudge(domcQ, st, rules, true); // E: the last YES — decided right
    expect(st.done).toBe(true); // no option left, so no extra option
    // with an option left after the decision, an extra option appears
    const q2 = byId('q-ch16-18'); // NO, YES, NO, YES
    let s2 = domcInit(q2, { shuffle: false, seed: 0 });
    s2 = domcJudge(q2, s2, rules, true); // A is NO, said YES: wrong -> decided
    expect(s2.done).toBe(false);
    expect(domcCurrent(q2, s2, rules)).toEqual({ option: 'B', extra: true });
    s2 = domcJudge(q2, s2, rules, true); // extra option: right answer but not scored
    expect(s2.done).toBe(true);
    expect(s2.extra).toEqual({ option: 'B', yes: true });
    expect(Object.keys(s2.judgments)).toEqual(['A']);
    expect(grade(q2, domcResponse(s2)).correct).toBe(false);
    expect(fromStored(toStored(s2))).toEqual(s2);
  });
  it('shows every option when early ending is off', () => {
    const rules = { earlyEnd: false, extraOption: false };
    let st = domcInit(domcQ, { shuffle: false, seed: 0 });
    for (const yes of [false, false, true, true, true]) st = domcJudge(domcQ, st, rules, yes);
    expect(st.done).toBe(true);
    expect(domcShown(st)).toBe(5);
    expect(grade(domcQ, domcResponse(st)).parts).toEqual({ A: false, B: true, C: true, D: true, E: true });
  });
});

describe('exam attempt', () => {
  const qs = bank.filter((q) => q.source.kind === 'mock');
  const fresh = () => newAttempt({ mock: 1, mode: 'exam', questions: qs, now: 1000, seed: 42, domcRules: rulesEarly });

  it('starts with 120 minutes and the shuffled DOMC orders', () => {
    const a = fresh();
    expect(a.durationMs).toBe(120 * 60_000);
    expect(remainingMs(a)).toBe(120 * 60_000);
    expect(a.domc['m1-q08'].order.length).toBe(5);
    expect(a.reached).toEqual({ 'm1-q01': 0 });
  });
  it('accrues time per question and records when a question is first reached', () => {
    let a = fresh();
    a = goTo(a, 1, 30_000);
    a = goTo(a, 0, 50_000);
    a = goTo(a, 1, 60_000);
    a = accrue(a, 100_000);
    expect(a.timeByQuestion).toEqual({ 'm1-q01': 40_000, 'm1-q02': 60_000 });
    expect(a.reached).toEqual({ 'm1-q01': 0, 'm1-q02': 30_000 });
  });
  it('knows what is answered, incomplete and flagged', () => {
    let a = fresh();
    a = setResponse(a, 'm1-q01', { format: 'mc', choice: 'D' });
    a = setResponse(a, 'm1-q02', { format: 'ms', choices: ['B'] }); // needs 2
    a = toggleFlag(a, 'm1-q04');
    const p = progressOf(a, qs);
    expect(p.answered).toBe(1);
    expect(p.incomplete).toEqual(['m1-q02']);
    expect(p.flagged).toEqual(['m1-q04']);
    expect(toggleFlag(a, 'm1-q04').flags).toEqual([]);
  });
  it('scores on submit', () => {
    let a = fresh();
    a = setResponse(a, 'm1-q01', { format: 'mc', choice: 'D' });
    a = setResponse(a, 'm1-q03', { format: 'fill', text: 'shop, orders_raw', parts: ['shop', 'orders_raw'] });
    a = setResponse(a, 'm1-q05', { format: 'hotspot', line: 9 });
    let st = fromStored(a.domc['m1-q08'])!;
    for (const id of st.order) st = domcJudge(domcQ, st, rulesEarly, id !== 'B');
    a = setDomc(a, domcQ, st);
    const done = finishAttempt(a, qs, 5000, 600_000);
    expect(done.status).toBe('finished');
    expect(done.score).toEqual({ correct: 4, total: 11, pct: 36.4 });
    expect(scoreOf(done, qs).correct).toBe(4);
  });
  it('counts blanks of fill questions', () => {
    expect(blanksOf(byId('m1-q03'))).toBe(2);
    expect(blanksOf(byId('q-ch07-02'))).toBe(1);
    expect(isComplete(byId('m1-q03'), { format: 'fill', text: 'shop, ', parts: ['shop', ''] }, undefined, 2)).toBe(false);
  });
  it('grades each blank of a multi-blank fill on its own', () => {
    const q = byId('m1-q03');
    expect(grade(q, { format: 'fill', text: 'shop, orders_raw', parts: ['shop', ' orders_raw '] }).correct).toBe(true);
    expect(grade(q, { format: 'fill', text: 'shop, orders', parts: ['shop', 'orders'] }).parts).toEqual({ 1: true, 2: false });
    expect(grade(q, { format: 'fill', text: 'shop,orders_raw' }).correct).toBe(true); // no parts: split on commas
    expect(describeKey(q)).toBe('shop, orders_raw');
  });
});

describe('results', () => {
  const qs = bank.filter((q) => q.source.kind === 'mock');
  it('breaks down by topic and objective, weakest first', () => {
    let a = newAttempt({ mock: 1, mode: 'exam', questions: qs, now: 0, seed: 1, domcRules: rulesEarly });
    a = setResponse(a, 'm1-q01', { format: 'mc', choice: 'D' }); // 1.2 right
    a = setResponse(a, 'm1-q04', { format: 'mc', choice: 'A' }); // 7.1 wrong
    const out = outcomesOf(a, qs);
    const { byTopic, byObjective } = breakdown(out);
    expect(byTopic.find((t) => t.topic === 1)).toMatchObject({ correct: 1, total: 5 });
    expect(byTopic.find((t) => t.topic === 7)).toMatchObject({ correct: 0, total: 1 });
    expect(byObjective.find((o) => o.id === '1.2')).toMatchObject({ correct: 1, total: 1, pct: 100 });
    expect(weakest(byObjective).map((r) => r.id)).not.toContain('1.2');
    expect(byObjective.map((o) => o.id).slice(0, 3)).toEqual(['1.1', '1.2', '1.4']);
  });
  it('uses the book checkpoints for 65 questions', () => {
    expect(checkpoints(65)).toEqual([
      { question: 22, targetMs: 25 * 60_000, latestMs: 40 * 60_000 },
      { question: 44, targetMs: 50 * 60_000, latestMs: 80 * 60_000 },
      { question: 65, targetMs: 75 * 60_000, latestMs: 120 * 60_000 },
    ]);
    const a = { ...newAttempt({ mock: 1, mode: 'exam', questions: qs, now: 0, seed: 1, domcRules: rulesEarly }), elapsedMs: 1_000_000 };
    const p = pacing({ ...a, reached: { [a.questionIds[3]]: 100_000 } }, outcomesOf(a, qs));
    expect(p.checkpoints[0].question).toBe(4);
    expect(p.checkpoints[0].status).toBe('ahead');
  });
  it('never rounds a fail up to the pass line', () => {
    expect(verdict(42, 65).shownPct).toBe(64);
    expect(verdict(42, 65).passed).toBe(false);
    expect(verdict(43, 65)).toMatchObject({ passed: true, ready: false, shownPct: 66 });
    expect(verdict(52, 65)).toMatchObject({ ready: true, shownPct: 80 });
  });
  it('gives chapter questions a topic from their chapter', () => {
    expect(questionTopic(byId('q-ch16-04'))).toBe(1);
    expect(questionObjectives(byId('q-ch07-01'))).toEqual(['1.1', '1.5']);
  });
});

describe('drill bank', () => {
  const none = { seen: new Set<string>(), mistakes: new Set<string>() };
  it('filters by format, source, topic and history', () => {
    expect(filterBank(bank, { ...EMPTY_FILTER, formats: ['domc'] }, none).length).toBe(5);
    expect(filterBank(bank, { ...EMPTY_FILTER, sources: ['mock1'], topics: [7] }, none).map((q) => q.id)).toEqual(['m1-q04']);
    expect(filterBank(bank, { ...EMPTY_FILTER, only: 'mistakes' }, { seen: new Set(['m1-q01']), mistakes: new Set(['m1-q01']) }).map((q) => q.id)).toEqual(['m1-q01']);
    expect(filterBank(bank, { ...EMPTY_FILTER, only: 'unseen' }, { seen: new Set(bank.map((q) => q.id).slice(1)), mistakes: new Set() }).length).toBe(1);
    expect(pick(bank, 5, 3)).toEqual(pick(bank, 5, 3));
    expect(pick(bank, 0, 3).length).toBe(bank.length);
  });
});

describe('playable questions', () => {
  it('accepts every fixture and rejects keys the converter could not settle', () => {
    for (const q of bank) expect(playableReason(q)).toBeNull();
    expect(playableReason({ ...byId('q-ch07-02'), key: null } as never)).toBe('no answer key yet');
    expect(playableReason({ ...byId('q-ch07-03'), hotspot: undefined } as never)).toBe('no code line to choose');
    expect(playableReason({ ...byId('q-ch07-07'), key: ['A', 'B'] } as never)).toMatch(/order/);
    expect(playableReason({ ...byId('m1-q03'), key: { blanks: [['shop'], []] } } as never)).toMatch(/blank/);
  });
});

describe('describe and time', () => {
  it('writes answers and keys in words', () => {
    expect(describeKey(byId('q-ch07-06'))).toBe('1-b, 2-c, 3-d, 4-a');
    expect(describeKey(domcQ)).toBe('A YES, B NO, C YES, D YES, E YES');
    expect(describeResponse(byId('q-ch07-05'), { format: 'ms', choices: ['C', 'A'] })).toBe('A and C');
    expect(describeResponse(byId('q-ch07-03'), undefined)).toBe('No answer');
    expect(plain(byId('q-ch07-02').stem[0].t === 'p' ? (byId('q-ch07-02').stem[0] as unknown as { c: never[] }).c : [])).toContain('____');
  });
  it('formats time', () => {
    expect(clock(120 * 60_000)).toBe('02:00:00');
    expect(clock(6_430_500)).toBe('01:47:11');
    expect(mss(110_000)).toBe('1:50');
    expect(spoken(6_420_000)).toBe('1 hour 47 minutes');
  });
});

describe('error notebook and SRS', () => {
  beforeEach(async () => { await db().delete(); await db().open(); });
  it('a wrong answer creates a note and a card; a later right answer on a due card promotes it', async () => {
    const q = byId('q-ch07-01');
    await recordOutcome(q, { format: 'mc', choice: 'A' }, false, { mode: 'quiz', ms: 20_000 });
    const note = await db().notes.get('error:q-ch07-01');
    expect(note?.kind).toBe('error');
    expect(note?.text).toContain('What I answered: A');
    expect(note?.text).toContain('Correct answer: B');
    const card = await db().srs.get('q-ch07-01');
    expect(card).toMatchObject({ kind: 'question', box: 1, lapses: 0 });
    await saveRule(q, { format: 'mc', choice: 'A' }, 'Sources never use the target schema.');
    expect(ruleOf(await db().notes.get('error:q-ch07-01'))).toBe('Sources never use the target schema.');
    // wrong again: the rule is kept, the card goes back to box 1 with a lapse
    await recordOutcome(q, { format: 'mc', choice: 'C' }, false, { mode: 'quiz' });
    expect(ruleOf(await db().notes.get('error:q-ch07-01'))).toBe('Sources never use the target schema.');
    expect((await db().srs.get('q-ch07-01'))?.lapses).toBe(1);
    await db().srs.update('q-ch07-01', { due: '2000-01-01' });
    await recordOutcome(q, { format: 'mc', choice: 'B' }, true, { mode: 'quiz' });
    expect((await db().srs.get('q-ch07-01'))?.box).toBe(2);
    const h = await answerHistory();
    expect(h.seen.has('q-ch07-01')).toBe(true);
    expect(h.mistakes.has('q-ch07-01')).toBe(false);
    expect(await db().answers.count()).toBe(3);
  });
  it('records a whole mock at once', async () => {
    const items = bank.filter((q) => q.source.kind === 'mock').map((q) => ({ q, correct: q.id === 'm1-q01', response: undefined }));
    await recordMany(items, { mode: 'mock-exam', attemptId: 'x' });
    expect(await db().answers.where('attemptId').equals('x').count()).toBe(11);
    expect(await db().notes.count()).toBe(10);
    expect(errorNoteText(byId('m1-q05'), { format: 'hotspot', line: 8 })).toContain('What I answered: Line 8');
  });
});
