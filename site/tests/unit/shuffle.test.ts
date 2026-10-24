// Review findings F1 / E10: options in a seeded order with new letters, and the explanation's letters
// rewritten to match; build lists never start on the answer.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/lib/content-types';
import { grade, type Response } from '../../src/lib/scoring';
import { remapLetters, shuffleView, viewLetters } from '../../src/lib/exam/shuffle';
import { blocksText, describeKeyWithText } from '../../src/lib/exam/describe';
import { errorNoteText } from '../../src/lib/exam/learning';
import fixtures from '../../src/dev/fixtures/questions.json';

const GEN = 'src/generated/';
const load = (d: string): Question[] => (existsSync(GEN + d) ? readdirSync(GEN + d).filter((f) => f.endsWith('.json')).flatMap((f) => {
  const r = JSON.parse(readFileSync(GEN + d + '/' + f, 'utf8'));
  return (Array.isArray(r) ? r : r.questions) as Question[];
}) : []);
const generated = [...load('questions'), ...load('mocks')].filter((q) => q.key);
const bank = generated.length ? generated : (fixtures as unknown as Question[]);
const fx = fixtures as unknown as Question[];
const byId = (id: string) => fx.find((q) => q.id === id)!;

describe('letter remapping', () => {
  const m = { A: 'C', B: 'A', C: 'D', D: 'B' };
  it('rewrites option letters, not the article "A"', () => {
    expect(remapLetters('B. A single > replaces the content. A describes >>. C and D are wrong.', m)).toBe('A. A single > replaces the content. C describes >>. B and D are wrong.');
    expect(remapLetters('A. A wrong answer gives 0 points', m)).toBe('C. A wrong answer gives 0 points');
    expect(remapLetters('A duplicates changed orders. A may hide it. Why A is correct. Type 1 (A) loses history.', m)).toBe('C duplicates changed orders. C may hide it. Why C is correct. Type 1 (C) loses history.');
    expect(remapLetters('A table is rebuilt completely. A ref() without v= points', m)).toBe('A table is rebuilt completely. A ref() without v= points');
    expect(remapLetters('A, C and D are false. B and A describe ETL.', m)).toBe('B, C and D are false. A and C describe ETL.'); // lists sorted
  });
});

describe('shuffled view', () => {
  it('keeps every question answerable: the key, the options and the why-wrong items move together', () => {
    for (const q of bank.filter((x) => x.format === 'mc' || x.format === 'ms')) {
      for (const seed of [1, 7919 * 7, 123456789]) {
        const v = shuffleView(q, seed);
        const map = viewLetters(v)!;
        const ids = v.options!.map((o) => o.id);
        expect(ids).toEqual(ids.slice().sort()); // relabelled A, B, C... in display order
        // same option texts, the correct one still correct
        const right: Response = v.format === 'mc' ? { format: 'mc', choice: v.key as string } : { format: 'ms', choices: v.key as string[] };
        expect(grade(v, right).correct).toBe(true);
        const bookRight = q.format === 'mc' ? [q.key as string] : (q.key as string[]);
        const viewRight = v.format === 'mc' ? [v.key as string] : (v.key as string[]);
        expect(viewRight.map((id) => JSON.stringify(v.options!.find((o) => o.id === id)!.c)).sort())
          .toEqual(bookRight.map((id) => JSON.stringify(q.options!.find((o) => o.id === id)!.c)).sort());
        for (const w of v.whyWrong ?? []) expect(viewRight).not.toContain(w.option);
        expect(Object.keys(map).sort()).toEqual(q.options!.map((o) => o.id).sort());
        expect(shuffleView(q, seed)).toEqual(v); // reproducible
      }
    }
  });
  it('spreads the chapter keys over every letter (the book has mostly B)', () => {
    const mc = bank.filter((q) => q.format === 'mc' && q.source.kind === 'chapter');
    if (mc.length < 50) return;
    const counts: Record<string, number> = {};
    for (const q of mc) { const k = shuffleView(q, 7919 * (q.source.kind === 'chapter' ? q.source.chapter : 1)).key as string; counts[k] = (counts[k] ?? 0) + 1; }
    for (const l of ['A', 'B', 'C', 'D']) expect(counts[l] / mc.length).toBeLessThan(0.4);
  });
  it('rewrites the explanation to the new letters (Chapter 7 Q1)', () => {
    const q = byId('q-ch07-01');
    const v = shuffleView(q, 99);
    const map = viewLetters(v)!;
    expect(blocksText(v.explanation)).toContain(`${map.B}. Without schema`);
    expect(blocksText(v.explanation)).toContain(`${map.A} forgets the identifier`);
    expect(describeKeyWithText(v)).toBe(`${map.B}. analytics.crm.accounts_v2`);
    expect(errorNoteText(v, { format: 'mc', choice: map.A })).toContain(`What I answered: ${map.A}. analytics.crm.accounts`);
  });
  it('starts a build list in a seeded order that is never the answer', () => {
    for (const q of bank.filter((x) => x.format === 'order')) {
      for (const seed of [0, 1, 2, 3, 4, 5]) {
        const v = shuffleView(q, seed);
        expect(v.options!.map((o) => o.id).join()).not.toBe((q.key as string[]).join());
        expect(v.options!.map((o) => o.id).sort()).toEqual(q.options!.map((o) => o.id).sort());
        expect(v.key).toEqual(q.key);
      }
    }
  });
  it('leaves the other formats as they are', () => {
    for (const q of bank.filter((x) => ['fill', 'match', 'hotspot', 'domc'].includes(x.format)).slice(0, 40)) expect(shuffleView(q, 5)).toBe(q);
  });
});
