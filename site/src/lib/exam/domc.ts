// DOMC state for one question, on top of the flow rules in scoring.ts (domcDecided / domcNext).
// Options are shown one at a time; a judged option is locked and hidden. With early ending the item
// stops as soon as its result is known; optionally one extra (unscored) option is shown after that,
// so the number of options seen tells the learner nothing (like the real exam).
import type { Question } from '../content-types';
import { domcDecided, domcNext, seededShuffle, type Response } from '../scoring';

export interface DomcRules { earlyEnd: boolean; extraOption: boolean }

export interface DomcState {
  /** option ids in the order they are shown */
  order: string[];
  /** scored judgments (option id -> YES) */
  judgments: Record<string, boolean>;
  /** the extra option shown after the item was decided; never scored */
  extra?: { option: string; yes: boolean } | null;
  done: boolean;
}

/** Stored shape (ExamAttempt.domc) — a superset of the db type, which only lists order/shown/judgments/decided. */
export interface DomcStored { order: string[]; shown: number; judgments: Record<string, boolean>; decided?: boolean; extra?: { option: string; yes: boolean } | null }

/** Small stable string hash (FNV-1a), to give each question its own shuffle seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function domcInit(q: Question, opts: { shuffle: boolean; seed: number }): DomcState {
  const ids = (q.options ?? []).map((o) => o.id);
  return { order: opts.shuffle ? seededShuffle(ids, (opts.seed ^ hashString(q.id)) >>> 0) : ids, judgments: {}, extra: null, done: ids.length === 0 };
}

const keyOf = (q: Question) => q.key as Record<string, boolean>;

/** The option to show now, or null when the question is finished. */
export function domcCurrent(q: Question, st: DomcState, rules: DomcRules): { option: string; extra: boolean } | null {
  if (st.done) return null;
  return domcNext(st.order, keyOf(q), st.judgments, { earlyEnd: rules.earlyEnd, extraOption: rules.extraOption, extraShown: !!st.extra });
}

/** Records a YES/NO judgment on the option shown now. Returns the new state (the input is not changed). */
export function domcJudge(q: Question, st: DomcState, rules: DomcRules, yes: boolean): DomcState {
  const cur = domcCurrent(q, st, rules);
  if (!cur) return { ...st, done: true };
  const next: DomcState = cur.extra
    ? { ...st, extra: { option: cur.option, yes } }
    : { ...st, judgments: { ...st.judgments, [cur.option]: yes } };
  next.done = domcCurrent(q, next, rules) === null;
  return next;
}

export function domcResponse(st: DomcState): Response {
  return { format: 'domc', judgments: { ...st.judgments } };
}

/** Number of options already judged (scored and extra). */
export const domcShown = (st: DomcState) => Object.keys(st.judgments).length + (st.extra ? 1 : 0);

export function domcState(q: Question, st: DomcState): 'open' | 'right' | 'wrong' {
  return domcDecided(keyOf(q), st.judgments);
}

export function toStored(st: DomcState): DomcStored {
  return { order: st.order, shown: domcShown(st), judgments: st.judgments, decided: st.done, extra: st.extra ?? null };
}

export function fromStored(s: DomcStored | undefined): DomcState | undefined {
  if (!s) return undefined;
  return { order: s.order, judgments: s.judgments ?? {}, extra: s.extra ?? null, done: !!s.decided };
}
