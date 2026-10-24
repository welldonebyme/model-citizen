// Grading for the 7 exam formats. Every question is worth 1 point, all-or-nothing, like the real exam
// (no partial credit, no penalty for a wrong answer). Responses are plain JSON so they can be stored.
import type { Question } from './content-types';

export type Response =
  | { format: 'mc'; choice: string | null }
  | { format: 'ms'; choices: string[] }
  | { format: 'fill'; text: string; parts?: string[] }          // parts: one value per blank (several blanks)
  | { format: 'match'; pairs: Record<string, string> }       // left id -> right id
  | { format: 'hotspot'; line: number | null }
  | { format: 'order'; order: string[] }
  | { format: 'domc'; judgments: Record<string, boolean> };  // option id -> YES (true) / NO (false), in the order shown

export interface Grade {
  correct: boolean;
  answered: boolean;
  /** per-part detail for feedback: option/left id -> right or wrong */
  parts?: Record<string, boolean>;
}

/** For unordered blanks: the assignment of values to blanks that makes the most values right (n is small). */
function bestAssignment(acc: string[][], values: string[]): boolean[] {
  let best: boolean[] = values.map(() => false);
  const used = new Array(acc.length).fill(false);
  const cur: boolean[] = [];
  const go = (i: number) => {
    if (i === values.length) { if (cur.filter(Boolean).length > best.filter(Boolean).length) best = cur.slice(); return; }
    let placed = false;
    for (let b = 0; b < acc.length; b++) {
      if (used[b] || !acc[b].includes(values[i])) continue;
      placed = true; used[b] = true; cur[i] = true; go(i + 1); used[b] = false;
    }
    if (!placed) { cur[i] = false; go(i + 1); }
  };
  go(0);
  return best;
}

/** Normalises a typed answer: trims, collapses spaces, removes wrapping quotes or backticks, lower case. */
export function normaliseFill(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .trim()
    // phones and word processors turn a typed "--" into a long dash: treat it as the flag prefix
    .replace(/^[\u2013\u2014]/, '--')
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/^[`'"]+|[`'".]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=])\s*/g, '$1')
    .toLowerCase();
}

export function isAnswered(r: Response | undefined | null): boolean {
  if (!r) return false;
  switch (r.format) {
    case 'mc': return !!r.choice;
    case 'ms': return r.choices.length > 0;
    case 'fill': return r.text.trim().length > 0 || (r.parts ?? []).some((p) => (p ?? '').trim().length > 0);
    case 'match': return Object.keys(r.pairs).length > 0;
    case 'hotspot': return r.line != null;
    case 'order': return r.order.length > 0;
    case 'domc': return Object.keys(r.judgments).length > 0;
  }
}

export function grade(q: Question, r: Response | undefined | null): Grade {
  if (!r || r.format !== q.format || !isAnswered(r)) return { correct: false, answered: false };
  switch (r.format) {
    case 'mc': return { correct: r.choice === q.key, answered: true };
    case 'ms': {
      const key = new Set(q.key as string[]);
      const picked = new Set(r.choices);
      const parts: Record<string, boolean> = {};
      for (const o of q.options ?? []) parts[o.id] = key.has(o.id) === picked.has(o.id);
      return { correct: picked.size === key.size && [...picked].every((c) => key.has(c)), answered: true, parts };
    }
    case 'fill': {
      const k = q.key as { accepted?: string[]; blanks?: string[][]; unordered?: boolean };
      if (k.blanks) {
        // several blanks: each one is checked against its own accepted values
        const values = (r.parts ?? r.text.split(',')).map((v) => normaliseFill(v ?? ''));
        const acc = k.blanks.map((a) => a.map(normaliseFill));
        const parts: Record<string, boolean> = {};
        if (k.unordered) {
          // "X or Y": the values may be given in any order, each blank used once
          const best = bestAssignment(acc, values);
          values.forEach((_, i) => { parts[String(i + 1)] = best[i]; });
        } else {
          acc.forEach((a, i) => { parts[String(i + 1)] = a.includes(values[i] ?? ''); });
        }
        return { correct: Object.values(parts).length === acc.length && Object.values(parts).every(Boolean), answered: true, parts };
      }
      const accepted = (k.accepted ?? []).map(normaliseFill);
      return { correct: accepted.includes(normaliseFill(r.text)), answered: true };
    }
    case 'match': {
      const key = q.key as Record<string, string>;
      const parts: Record<string, boolean> = {};
      for (const l of Object.keys(key)) parts[l] = r.pairs[l] === key[l];
      return { correct: Object.values(parts).every(Boolean), answered: true, parts };
    }
    case 'hotspot': return { correct: r.line === q.key, answered: true };
    case 'order': {
      const key = q.key as string[];
      const parts: Record<string, boolean> = {};
      key.forEach((id, i) => { parts[id] = r.order[i] === id; });
      return { correct: key.length === r.order.length && key.every((id, i) => r.order[i] === id), answered: true, parts };
    }
    case 'domc': {
      const key = q.key as Record<string, boolean>;
      const parts: Record<string, boolean> = {};
      for (const [opt, yes] of Object.entries(r.judgments)) parts[opt] = key[opt] === yes;
      // Correct only if no shown option was misjudged and every YES option was endorsed.
      const noError = Object.values(parts).every(Boolean);
      const allYesEndorsed = Object.entries(key).every(([opt, yes]) => !yes || r.judgments[opt] === true);
      return { correct: noError && allYesEndorsed, answered: true, parts };
    }
  }
}

/**
 * DOMC flow (Caveon style): options are shown one at a time and cannot be revisited.
 * With early ending, the item stops as soon as its result is known:
 *  - a wrong judgment makes the item wrong, so it ends;
 *  - once every YES option has been endorsed (and nothing was misjudged), the item is right, so it ends.
 * Without early ending (practice), every option is shown.
 */
export function domcDecided(key: Record<string, boolean>, judgments: Record<string, boolean>): 'open' | 'right' | 'wrong' {
  for (const [opt, yes] of Object.entries(judgments)) if (key[opt] !== yes) return 'wrong';
  const allYes = Object.entries(key).every(([opt, yes]) => !yes || judgments[opt] === true);
  return allYes ? 'right' : 'open';
}

/** Next option to show, or null when the item is finished. `extra` = one more option after the item is decided. */
export function domcNext(
  order: string[], key: Record<string, boolean>, judgments: Record<string, boolean>,
  opts: { earlyEnd: boolean; extraOption: boolean; extraShown?: boolean },
): { option: string; extra: boolean } | null {
  const remaining = order.filter((o) => !(o in judgments));
  if (remaining.length === 0) return null;
  if (!opts.earlyEnd) return { option: remaining[0], extra: false };
  const state = domcDecided(key, judgments);
  if (state === 'open') return { option: remaining[0], extra: false };
  if (opts.extraOption && !opts.extraShown) return { option: remaining[0], extra: true };
  return null;
}

/** Deterministic shuffle (mulberry32) so a saved exam attempt shows the same order after reload. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export const PASS_PCT = 65;     // official passing score
export const TARGET_PCT = 80;   // the book's target before booking the exam
