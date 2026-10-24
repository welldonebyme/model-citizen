// Checks the real question bank written by the converter (skipped while it does not exist):
// every playable question is graded right when answered with its own key, wrong when answered wrongly,
// and its DOMC flow ends. This catches any mismatch between the converter's key shapes and the engine.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/lib/content-types';
import { grade, type Response } from '../../src/lib/scoring';
import { playableReason } from '../../src/lib/exam/validate';
import { domcInit, domcJudge, domcResponse } from '../../src/lib/exam/domc';
import { blanksOf, isComplete } from '../../src/lib/exam/engine';

const GEN = fileURLToPath(new URL('../../src/generated/', import.meta.url));
const load = (dir: string): Question[] => (existsSync(GEN + dir) ? readdirSync(GEN + dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
  const raw = JSON.parse(readFileSync(GEN + dir + '/' + f, 'utf8'));
  return (Array.isArray(raw) ? raw : raw.questions ?? []) as Question[];
}) : []);
const bank = [...load('questions'), ...load('mocks')];

function rightResponse(q: Question): Response {
  const k = q.key as never;
  switch (q.format) {
    case 'mc': return { format: 'mc', choice: k };
    case 'ms': return { format: 'ms', choices: [...(k as string[])] };
    case 'fill': {
      const f = k as { accepted?: string[]; blanks?: string[][] };
      if (f.blanks) { const parts = f.blanks.map((b) => b[0]); return { format: 'fill', text: parts.join(', '), parts }; }
      return { format: 'fill', text: f.accepted![0] };
    }
    case 'match': return { format: 'match', pairs: { ...(k as Record<string, string>) } };
    case 'hotspot': return { format: 'hotspot', line: k };
    case 'order': return { format: 'order', order: [...(k as string[])] };
    case 'domc': return { format: 'domc', judgments: { ...(k as Record<string, boolean>) } };
  }
}

describe.skipIf(bank.length === 0)('generated question bank', () => {
  const playable = bank.filter((q) => playableReason(q) === null);
  it('has mostly playable questions', () => {
    expect(playable.length).toBeGreaterThan(bank.length * 0.95);
  });
  it('grades every playable question right with its own key', () => {
    const bad = playable.filter((q) => !grade(q, rightResponse(q)).correct).map((q) => q.id);
    expect(bad).toEqual([]);
  });
  it('treats the right answer as a complete answer', () => {
    const bad = playable.filter((q) => q.format !== 'domc' && !isComplete(q, rightResponse(q), undefined, blanksOf(q))).map((q) => q.id);
    expect(bad).toEqual([]);
  });
  it('grades an empty answer as not answered', () => {
    for (const q of playable) expect(grade(q, undefined)).toEqual({ correct: false, answered: false });
  });
  it('ends every DOMC question, with and without early ending', () => {
    for (const q of playable.filter((x) => x.format === 'domc')) {
      for (const rules of [{ earlyEnd: true, extraOption: true }, { earlyEnd: false, extraOption: false }]) {
        let st = domcInit(q, { shuffle: true, seed: 5 });
        const key = q.key as Record<string, boolean>;
        let guard = 0;
        while (!st.done && guard++ < 20) { const cur = st.order.find((o) => !(o in st.judgments)) ?? ''; st = domcJudge(q, st, rules, key[cur] ?? true); }
        expect(st.done).toBe(true);
        expect(grade(q, domcResponse(st)).correct).toBe(true);
      }
    }
  });
  it('has hotspot keys inside their code block', () => {
    for (const q of playable.filter((x) => x.format === 'hotspot')) {
      const code = q.stem.find((b) => b.t === 'code' && b.id === q.hotspot!.codeId) as { text: string; firstLine?: number };
      const first = code.firstLine ?? 1;
      const n = code.text.split('\n').length;
      expect(q.key as number).toBeGreaterThanOrEqual(first);
      expect(q.key as number).toBeLessThanOrEqual(first + n - 1);
    }
  });
});
