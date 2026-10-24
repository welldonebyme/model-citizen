import { describe, expect, it } from 'vitest';
import { grade, domcDecided, domcNext, normaliseFill, seededShuffle } from '../../src/lib/scoring';
import type { Question } from '../../src/lib/content-types';

const base = { id: 'q', source: { kind: 'chapter', chapter: 7, n: 1 } as const, formatLabel: '', stem: [], keyRaw: '', explanation: [] };
const q = (format: Question['format'], key: Question['key'], extra: Partial<Question> = {}) => ({ ...base, format, key, ...extra }) as Question;

describe('grade', () => {
  it('multiple choice', () => {
    expect(grade(q('mc', 'B'), { format: 'mc', choice: 'B' }).correct).toBe(true);
    expect(grade(q('mc', 'B'), { format: 'mc', choice: 'A' }).correct).toBe(false);
    expect(grade(q('mc', 'B'), { format: 'mc', choice: null }).answered).toBe(false);
  });
  it('multiple select is all-or-nothing', () => {
    const m = q('ms', ['A', 'C'], { options: ['A', 'B', 'C', 'D'].map((id) => ({ id, c: [] })) });
    expect(grade(m, { format: 'ms', choices: ['C', 'A'] }).correct).toBe(true);
    expect(grade(m, { format: 'ms', choices: ['A'] }).correct).toBe(false);
    expect(grade(m, { format: 'ms', choices: ['A', 'C', 'D'] }).correct).toBe(false);
  });
  it('fill in the blank normalises', () => {
    const f = q('fill', { accepted: ['identifier'] });
    expect(grade(f, { format: 'fill', text: '  `Identifier`. ' }).correct).toBe(true);
    expect(grade(f, { format: 'fill', text: 'identifer' }).correct).toBe(false);
    expect(normaliseFill("ref( 'stg_orders' )")).toBe(normaliseFill("ref('stg_orders')"));
  });
  it('matching needs every pair', () => {
    const m = q('match', { '1': 'b', '2': 'c', '3': 'd', '4': 'a' });
    expect(grade(m, { format: 'match', pairs: { '1': 'b', '2': 'c', '3': 'd', '4': 'a' } }).correct).toBe(true);
    const g = grade(m, { format: 'match', pairs: { '1': 'b', '2': 'd', '3': 'c', '4': 'a' } });
    expect(g.correct).toBe(false);
    expect(g.parts).toEqual({ '1': true, '2': false, '3': false, '4': true });
  });
  it('hotspot and build list', () => {
    expect(grade(q('hotspot', 9), { format: 'hotspot', line: 9 }).correct).toBe(true);
    expect(grade(q('order', ['B', 'D', 'A']), { format: 'order', order: ['B', 'D', 'A'] }).correct).toBe(true);
    expect(grade(q('order', ['B', 'D', 'A']), { format: 'order', order: ['D', 'B', 'A'] }).correct).toBe(false);
  });
  it('DOMC: every YES endorsed and no misjudgment', () => {
    const key = { A: true, B: false, C: true, D: true, E: true };
    const d = q('domc', key);
    expect(grade(d, { format: 'domc', judgments: { A: true, B: false, C: true, D: true, E: true } }).correct).toBe(true);
    expect(grade(d, { format: 'domc', judgments: { A: true, B: true } }).correct).toBe(false);
    expect(grade(d, { format: 'domc', judgments: { A: true, B: false } }).correct).toBe(false); // ended too early: C, D, E not endorsed
  });
});

describe('DOMC flow', () => {
  const key = { A: true, B: false, C: false, D: false };
  it('ends early on the first mistake', () => {
    expect(domcDecided(key, { A: false })).toBe('wrong');
    expect(domcNext(['A', 'B', 'C', 'D'], key, { A: false }, { earlyEnd: true, extraOption: false })).toBeNull();
  });
  it('ends when every YES option is endorsed, optionally after one extra option', () => {
    expect(domcDecided(key, { A: true })).toBe('right');
    expect(domcNext(['A', 'B', 'C', 'D'], key, { A: true }, { earlyEnd: true, extraOption: true })).toEqual({ option: 'B', extra: true });
    expect(domcNext(['A', 'B', 'C', 'D'], key, { A: true, B: false }, { earlyEnd: true, extraOption: true, extraShown: true })).toBeNull();
  });
  it('shows every option without early ending', () => {
    expect(domcNext(['A', 'B', 'C', 'D'], key, { A: false }, { earlyEnd: false, extraOption: false })).toEqual({ option: 'B', extra: false });
  });
});

describe('seededShuffle', () => {
  it('is reproducible and a permutation', () => {
    const a = seededShuffle(['A', 'B', 'C', 'D', 'E'], 42);
    expect(seededShuffle(['A', 'B', 'C', 'D', 'E'], 42)).toEqual(a);
    expect([...a].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});
