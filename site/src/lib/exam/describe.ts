// Plain-text descriptions of questions, answers and keys (error notebook entries, aria labels, summaries).
import type { Block, Inline, Question } from '../content-types';
import type { Response } from '../scoring';

export function plain(c: Inline[] | undefined): string {
  if (!c) return '';
  return c.map((n) => {
    if (typeof n === 'string') return n;
    switch (n.t) {
      case 'code': case 'key': return n.v;
      case 'b': case 'i': case 'u': case 'sf': case 'link': return plain(n.c);
      case 'term': return plain(n.en);
      case 'obj': return n.id;
      case 'ref': return n.text;
      case 'blank': return '____';
      case 'br': return ' ';
      default: return '';
    }
  }).join('');
}

export function blocksText(blocks: Block[] | undefined): string {
  if (!blocks) return '';
  return blocks.map((b) => {
    switch (b.t) {
      case 'p': case 'h': return plain(b.c);
      case 'list': return b.items.map((it) => blocksText(it.blocks)).join(' ');
      case 'callout': case 'lab': return blocksText(b.blocks);
      case 'code': return b.text;
      default: return '';
    }
  }).join(' ').replace(/\s+/g, ' ').trim();
}

/** Where a question comes from, for people: "Chapter 7, question 3" / "Mock exam 1, question 41". */
export function sourceLabel(q: Question): string {
  return q.source.kind === 'chapter' ? `Chapter ${q.source.chapter}, question ${q.source.n}` : `Mock exam ${q.source.mock}, question ${q.source.n}`;
}

const yn = (v: boolean) => (v ? 'YES' : 'NO');

/** The learner's answer in words, e.g. "B", "A and C", "1-b, 2-c", "Line 9", "YES to A, NO to B". */
export function describeResponse(q: Question, r: Response | null | undefined): string {
  if (!r) return 'No answer';
  switch (r.format) {
    case 'mc': return r.choice ?? 'No answer';
    case 'ms': return r.choices.length ? [...r.choices].sort().join(' and ') : 'No answer';
    case 'fill': return r.text.trim() ? r.text.trim() : 'No answer';
    case 'match': {
      const left = q.match?.left ?? [];
      const parts = left.filter((l) => r.pairs[l.id]).map((l) => `${l.id}-${r.pairs[l.id]}`);
      return parts.length ? parts.join(', ') : 'No answer';
    }
    case 'hotspot': return r.line != null ? `Line ${r.line}` : 'No answer';
    case 'order': return r.order.length ? r.order.join(', ') : 'No answer';
    case 'domc': {
      const ids = (q.options ?? []).map((o) => o.id).filter((id) => id in r.judgments);
      return ids.length ? ids.map((id) => `${id} ${yn(r.judgments[id])}`).join(', ') : 'No answer';
    }
  }
}

/** The correct answer in words. */
export function describeKey(q: Question): string {
  const k = q.key;
  switch (q.format) {
    case 'mc': return String(k);
    case 'ms': return (k as string[]).join(' and ');
    case 'fill': return (k as { accepted: string[] }).accepted.join(' or ');
    case 'match': return Object.entries(k as Record<string, string>).map(([l, r]) => `${l}-${r}`).join(', ');
    case 'hotspot': return `Line ${k}`;
    case 'order': return (k as string[]).join(', ');
    case 'domc': return Object.entries(k as Record<string, boolean>).map(([o, v]) => `${o} ${yn(v)}`).join(', ');
  }
}

export const FORMAT_NAME: Record<Question['format'], string> = {
  mc: 'Multiple choice', ms: 'Multiple select', fill: 'Fill in the blank', match: 'Matching',
  hotspot: 'Hotspot', order: 'Build list', domc: 'DOMC',
};

/** One-line instruction shown above the answer area, in plain words. */
export function formatHint(q: Question): string {
  switch (q.format) {
    case 'mc': return 'Choose one answer.';
    case 'ms': return `Choose ${q.choose ?? (q.key as string[]).length} answers.`;
    case 'fill': return 'Type the missing word or expression. Spelling matters.';
    case 'match': return 'Match each item on the left with one item on the right.';
    case 'hotspot': return 'Choose the line in the code.';
    case 'order': return 'Put the items in the correct order, from first to last.';
    case 'domc': return 'Judge each option YES or NO. Options appear one at a time.';
  }
}
