// Where the inputs of a fill-in-the-blank question go (review finding E1). A stem can have blanks in its
// sentences (inline blank nodes) and in its code blocks (runs of ___), even both in one question. Every
// blank gets an input, numbered in reading order: an inline blank gets its input in the sentence, a code
// blank gets one right under its code block. The number of inputs is the number of blanks of the key.
import type { Block, Inline, Question } from '../content-types';

export type FillSlot = { index: number; kind: 'inline' } | { index: number; kind: 'code'; codeId: string };

export interface FillPlan {
  /** number of answers the key expects (key.blanks.length, or 1) */
  count: number;
  /** global index of the k-th inline blank (in the order the stem renders them), or -1 for no input */
  inline: number[];
  /** code block id -> global indices of the inputs under it */
  code: Record<string, number[]>;
  /** indices with no place in the stem (the key has more blanks than the stem shows): inputs under the stem */
  extra: number[];
  /** a single answer that goes in several blanks of the stem */
  sameWord: boolean;
}

const RUN = /_{3,}/g;

function inlineBlanks(c: Inline[]): number {
  let n = 0;
  for (const x of c) {
    if (typeof x !== 'object') continue;
    if (x.t === 'blank') n++;
    else if (x.t === 'b' || x.t === 'i' || x.t === 'u') n += inlineBlanks(x.c);
  }
  return n;
}

/** The blanks in the order the stem renders them (same walk as Stem: paragraphs, lists, code blocks). */
function slotsOf(blocks: Block[], out: ({ kind: 'inline' } | { kind: 'code'; codeId: string })[]) {
  for (const b of blocks) {
    if (b.t === 'p') for (let i = 0; i < inlineBlanks(b.c); i++) out.push({ kind: 'inline' });
    else if (b.t === 'list') b.items.forEach((it) => slotsOf(it.blocks, out));
    else if (b.t === 'code') for (let i = 0; i < (b.text.match(RUN) ?? []).length; i++) out.push({ kind: 'code', codeId: b.id });
  }
  return out;
}

export function fillPlan(q: Question): FillPlan {
  const k = q.key as { blanks?: string[][] } | null;
  const count = k?.blanks?.length || 1;
  const slots = slotsOf(q.stem, []);
  const plan: FillPlan = { count, inline: [], code: {}, extra: [], sameWord: count === 1 && slots.length > 1 };
  slots.forEach((s, i) => {
    const index = i < count ? i : -1; // a slot past the key's count gets no input (same word in several blanks)
    if (s.kind === 'inline') plan.inline.push(index);
    else if (index >= 0) (plan.code[s.codeId] ??= []).push(index);
  });
  for (let i = slots.length; i < count; i++) plan.extra.push(i);
  return plan;
}

/** Number of inputs the plan renders (always the key's count). */
export const planInputs = (p: FillPlan) => p.inline.filter((i) => i >= 0).length + Object.values(p.code).flat().length + p.extra.length;
