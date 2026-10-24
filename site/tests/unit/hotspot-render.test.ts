// Review findings E2 / E7: every line of every hotspot can be chosen (also when the code is split in
// several blocks), and the line numbers the book printed in the code are not shown twice.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/lib/content-types';
import { Hotspot, stripPrintedNumbers } from '../../src/components/quiz/Hotspot';
import fixtures from '../../src/dev/fixtures/questions.json';

const GEN = 'src/generated/';
const load = (d: string): Question[] => (existsSync(GEN + d) ? readdirSync(GEN + d).filter((f) => f.endsWith('.json')).flatMap((f) => {
  const r = JSON.parse(readFileSync(GEN + d + '/' + f, 'utf8'));
  return (Array.isArray(r) ? r : r.questions) as Question[];
}) : []);
const generated = [...load('questions'), ...load('mocks')];
const bank = (generated.length ? generated : (fixtures as unknown as Question[])).filter((q) => q.format === 'hotspot' && q.key && q.hotspot);
const html = (q: Question) => renderToStaticMarkup(createElement(Hotspot, { q, response: undefined, onResponse: () => undefined, name: 't' }));

describe('hotspot lines', () => {
  it(`every line of all ${bank.length} hotspots is a button, with the key among them`, () => {
    const bad: string[] = [];
    for (const q of bank) {
      const lines = [...html(q).matchAll(/<button[^>]*data-line="(\d+)"/g)].map((m) => Number(m[1]));
      const want = (q.hotspot as { lines: number }).lines;
      if (lines.length !== want || !lines.includes(q.key as number) || new Set(lines).size !== lines.length) bad.push(`${q.id}: ${lines.length} of ${want} lines, key ${q.key}`);
    }
    expect(bad).toEqual([]);
  });
  it('Mock 3 Q40: the macro (1-6) and the model (7-12) are both clickable', () => {
    const q = bank.find((x) => x.id === 'm3-q40');
    if (!q) { expect(generated.length).toBe(0); return; }
    const lines = [...html(q).matchAll(/<button[^>]*data-line="(\d+)"/g)].map((m) => Number(m[1]));
    expect(lines).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it('strips the numbers the book printed in the code', () => {
    expect(stripPrintedNumbers(' 1  sources:\n 2    - name: ridenow\n10| group by 1, 2\n 4|')).toBe('sources:\n  - name: ridenow\ngroup by 1, 2\n');
    for (const q of bank.filter((x) => (x.hotspot as { numbering?: string }).numbering === 'text')) {
      const texts = [...html(q).matchAll(/<span class="mc-lc">([\s\S]*?)<\/span><\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
      expect(texts.some((t) => /^\s*\d+(\||\s{2})/.test(t)), q.id).toBe(false);
    }
  });
});
