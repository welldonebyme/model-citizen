// Review finding E1: every fill-in question renders exactly one input per blank of its key, in every
// chapter quiz and every mock (server-rendered with the real component).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Question } from '../../src/lib/content-types';
import { FillBlank } from '../../src/components/quiz/FillBlank';
import { fillPlan, planInputs } from '../../src/lib/exam/fill';
import fixtures from '../../src/dev/fixtures/questions.json';

const GEN = 'src/generated/';
const load = (d: string): Question[] => (existsSync(GEN + d) ? readdirSync(GEN + d).filter((f) => f.endsWith('.json')).flatMap((f) => {
  const r = JSON.parse(readFileSync(GEN + d + '/' + f, 'utf8'));
  return (Array.isArray(r) ? r : r.questions) as Question[];
}) : []);
const generated = [...load('questions'), ...load('mocks')];
const bank = (generated.length ? generated : (fixtures as unknown as Question[])).filter((q) => q.format === 'fill' && q.key);

const inputs = (q: Question, response?: Parameters<typeof FillBlank>[0]['response']) =>
  (renderToStaticMarkup(createElement(FillBlank, { q, response, onResponse: () => undefined, name: 't' })).match(/<input/g) ?? []).length;

describe('fill in the blank inputs', () => {
  it(`renders one input per blank of the key for all ${bank.length} fill questions`, () => {
    const bad = bank.filter((q) => {
      const want = (q.key as { blanks?: string[][] }).blanks?.length || 1;
      return inputs(q) !== want || planInputs(fillPlan(q)) !== want;
    }).map((q) => `${q.id}: ${inputs(q)} inputs, ${(q.key as { blanks?: string[][] }).blanks?.length || 1} blanks`);
    expect(bad).toEqual([]);
  });
  it('numbers a code blank and a sentence blank in reading order (Mock 1 Q61)', () => {
    const q = bank.find((x) => x.id === 'm1-q61');
    if (!q) { expect(generated.length).toBe(0); return; } // fixtures only
    const plan = fillPlan(q);
    expect(plan.count).toBe(2);
    expect(Object.values(plan.code).flat()).toEqual([0]); // the code comes first in the stem
    expect(plan.inline).toEqual([1]);
    const html = renderToStaticMarkup(createElement(FillBlank, { q, response: { format: 'fill', text: 'state, manifest.json', parts: ['state', 'manifest.json'] }, onResponse: () => undefined, name: 't', review: true }));
    expect(html).toContain('aria-label="Blank 1 of 2"');
    expect(html).toContain('aria-label="Blank 2 of 2"');
    expect(html).toContain('Every blank is accepted');
  });
});
