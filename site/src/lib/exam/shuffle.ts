// Option order for a session (review finding F1 / E10). The book's chapter keys are heavily biased
// (most multiple-choice answers are B), so multiple-choice and multiple-select options are shown in a
// seeded random order and relabelled A, B, C... in that order. The key, the "why the others are wrong"
// items and the letters the explanation names are rewritten to the new letters, so everything the
// learner reads refers to what they see. Build lists start from a seeded order that is never the answer.
// The same seed and question always give the same view (reload, resume, review, friend challenge).
import type { Block, Inline, Question } from '../content-types';
import { seededShuffle } from '../scoring';
import { hashString } from './domc';

const LETTERS = 'ABCDEFGHIJ'.split('');

/** Words that can follow the letter A only when A names an option ("A is wrong", "A may hide"...). */
const AFTER_OPTION_A = new Set(('is was would does did may might can cannot could will should must never only also still just '
  + 'always simply silently then already ever even is').split(/\s+/));
/** Singular nouns that end in s: "A process ..." is an article, not option A. */
const NOUN_S = new Set('process class status alias access address analysis basis bus canvas focus lens pass progress success plus bonus series news chaos gas mess loss boss business'.split(' '));

function isOptionA(text: string, at: number, ids: Set<string>): boolean {
  const before = text.slice(0, at);
  const after = text.slice(at + 1);
  if (/^\s*([:;,.)!?]|$)/.test(after)) return true;                          // "A:", "A,", "A.", "A)"
  if (/^\s+(and|or|to)\s+[A-J]\b/.test(after) && ids.has(after.trim().split(/\s+/)[1]?.[0] ?? '')) return true; // "A and C"
  if (/(\b[A-J](,\s*|\s+and\s+|\s+or\s+)|\(|\bWhy\s+|\bboth\s+|\bBoth\s+|\bonly\s+|\boption\s+|\boptions\s+)$/.test(before)) return true;
  const w = (after.match(/^\s+([a-z][a-z'-]*)/) ?? [])[1];
  if (!w) return false;                                                       // "A `ref()`...": an article
  if (AFTER_OPTION_A.has(w)) return true;
  return w.length > 2 && w.endsWith('s') && !w.endsWith('ss') && !NOUN_S.has(w);  // "A forgets", "A wastes" (verbs)
}

const LIST = /(^|[^A-Za-z0-9_'’`-])([A-J](?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)[A-J])+)(?=$|[^A-Za-z0-9_'’`-])/g;

/**
 * Rewrites option letters in plain text with `map` (old letter -> new letter), all at once. Lists of
 * letters ("A and C", "B, D and E") are rewritten in alphabetical order ("C and D" rather than "D and C").
 */
export function remapLetters(text: string, map: Record<string, string>): string {
  const ids = new Set(Object.keys(map));
  const lists: string[] = [];
  // 1. lists of letters: map, sort, keep the separators
  const withLists = text.replace(LIST, (m, pre: string, list: string) => {
    const letters = list.match(/[A-J]/g) ?? [];
    if (!letters.every((l) => ids.has(l))) return m;
    const sorted = letters.map((l) => map[l]).sort();
    let k = 0;
    lists.push(list.replace(/[A-J]/g, () => sorted[k++]));
    return `${pre}\u0000${lists.length - 1}\u0000`;
  });
  // 2. single letters ("A" only when it names an option, not the article)
  const singles = withLists.replace(/(^|[^A-Za-z0-9_'’`\u0000-])([A-J])(?=$|[^A-Za-z0-9_'’`\u0000-])/g, (m, pre: string, l: string, offset: number) => {
    if (!ids.has(l)) return m;
    if (l === 'A' && !isOptionA(withLists, offset + pre.length, ids)) return m;
    return pre + map[l];
  });
  return singles.replace(/\u0000(\d+)\u0000/g, (_, i: string) => lists[Number(i)]);
}

function remapInline(c: Inline[], map: Record<string, string>): Inline[] {
  return c.map((n) => {
    if (typeof n === 'string') return remapLetters(n, map);
    switch (n.t) {
      case 'b': case 'i': case 'u': case 'sf': return { ...n, c: remapInline(n.c, map) };
      case 'link': return { ...n, c: remapInline(n.c, map) };
      default: return n; // code, terms, refs... are left alone
    }
  });
}

function remapBlocks(blocks: Block[], map: Record<string, string>): Block[] {
  return blocks.map((b) => {
    switch (b.t) {
      case 'p': return { ...b, c: remapInline(b.c, map) };
      case 'list': return { ...b, items: b.items.map((it) => ({ ...it, term: it.term && remapInline(it.term, map), blocks: remapBlocks(it.blocks, map) })) };
      case 'callout': return { ...b, blocks: remapBlocks(b.blocks, map) };
      default: return b;
    }
  });
}

const seedFor = (seed: number, q: Question, salt: string) => (seed ^ hashString(q.id + salt)) >>> 0;

/**
 * The question as shown in a session: MC/MS options shuffled and relabelled (with the explanation's
 * letters rewritten), build-list start order shuffled. Other formats are returned as they are.
 */
export function shuffleView(q: Question, seed: number): Question {
  const opts = q.options ?? [];
  if ((q.format === 'mc' || q.format === 'ms') && opts.length > 1) {
    const order = seededShuffle(opts, seedFor(seed, q, ':options'));
    const map: Record<string, string> = {};
    order.forEach((o, i) => { map[o.id] = LETTERS[i]; });
    const key = q.format === 'mc' ? map[q.key as string] : (q.key as string[]).map((k) => map[k]).sort();
    return {
      ...q,
      options: order.map((o, i) => ({ ...o, id: LETTERS[i] })),
      key,
      explanation: remapBlocks(q.explanation, map),
      whyWrong: q.whyWrong?.map((w) => ({ option: map[w.option] ?? w.option, c: remapInline(w.c, map) })).sort((a, b) => a.option.localeCompare(b.option)),
      letterMap: map,
    } as Question & { letterMap: Record<string, string> };
  }
  if (q.format === 'order' && opts.length > 1) {
    const key = (q.key as string[]).join();
    let order = seededShuffle(opts, seedFor(seed, q, ':start'));
    if (order.map((o) => o.id).join() === key) order = [...order.slice(1), order[0]]; // never start on the answer
    return { ...q, options: order };
  }
  return q;
}

/** Book letter -> letter shown in this view (MC/MS), for texts that name the book's letters. */
export function viewLetters(q: Question): Record<string, string> | undefined {
  return (q as Question & { letterMap?: Record<string, string> }).letterMap;
}
