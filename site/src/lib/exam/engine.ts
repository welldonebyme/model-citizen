// Mock exam attempt: pure state changes (no DOM, no database), so they can be unit-tested.
// The React screens call these functions, then save the attempt (persist.ts).
import type { Question } from '../content-types';
import type { ExamAttempt } from '../store/db';
import { grade, isAnswered, type Response } from '../scoring';
import { domcInit, fromStored, toStored, type DomcState, type DomcStored } from './domc';

export const EXAM_MINUTES = 120;
export const PACE_MS = 110_000; // 1 min 50 s per question (Part 0)

/** The stored attempt, with a few extra fields (Dexie stores any property; the db type lists the indexed ones). */
export interface Attempt extends ExamAttempt {
  domc: Record<string, DomcStored>;
  /** elapsed time when each question was first shown (pacing checkpoints) */
  reached?: Record<string, number>;
  /** elapsed time when the current question was shown (time per question accrues from here) */
  markMs?: number;
  /** practice mode: questions whose feedback was shown (answer locked) */
  checked?: string[];
  /** true when the attempt was submitted by the timer */
  timeUp?: boolean;
  /** rules used for DOMC in this attempt */
  domcRules?: { earlyEnd: boolean; extraOption: boolean };
  /** exam mode: 'wall' = the time keeps passing while the page is closed (like the real exam), 'pause' = it stops */
  clock?: 'wall' | 'pause';
  /** wall-clock time (ms) when elapsedMs was last measured */
  clockAt?: number;
}

/**
 * Time used so far, seen from `now`. With the realistic clock, the time the page was closed counts too.
 * Older attempts (no clock field) keep the time they had.
 */
export function elapsedAt(a: Attempt, now: number): number {
  if (a.mode !== 'exam' || a.clock !== 'wall' || a.status !== 'active') return a.elapsedMs;
  const since = a.clockAt ?? a.updatedAt;
  return a.elapsedMs + Math.max(0, now - since);
}

/**
 * The attempt as it is at `now`, for a resume: the time on the current question up to the close is kept,
 * the elapsed time is brought up to date, and the time away is not given to any question.
 */
export function catchUp(a: Attempt, now: number): Attempt {
  const e = Math.min(elapsedAt(a, now), a.mode === 'exam' ? a.durationMs : Number.MAX_SAFE_INTEGER);
  return { ...accrue(a, a.elapsedMs), elapsedMs: e, markMs: e, clockAt: now };
}

export function newAttemptId(mock: number, now: number): string {
  return `m${mock}-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function newAttempt(opts: {
  mock: number; mode: 'exam' | 'practice'; questions: Question[]; now: number; seed?: number; durationMs?: number;
  domcRules: { earlyEnd: boolean; extraOption: boolean };
  /** exam mode: stop the timer while the page is closed (Settings); default: the time keeps passing */
  pauseOnClose?: boolean;
}): Attempt {
  const seed = opts.seed ?? (Math.floor(Math.random() * 2 ** 31) >>> 0);
  const domc: Record<string, DomcStored> = {};
  for (const q of opts.questions) if (q.format === 'domc') domc[q.id] = toStored(domcInit(q, { shuffle: true, seed }));
  const first = opts.questions[0]?.id;
  return {
    id: newAttemptId(opts.mock, opts.now),
    mock: opts.mock,
    mode: opts.mode,
    questionIds: opts.questions.map((q) => q.id),
    seed,
    startedAt: opts.now,
    durationMs: opts.durationMs ?? EXAM_MINUTES * 60_000,
    elapsedMs: 0,
    current: 0,
    responses: {},
    flags: [],
    domc,
    timeByQuestion: {},
    status: 'active',
    updatedAt: opts.now,
    reached: first ? { [first]: 0 } : {},
    markMs: 0,
    checked: [],
    domcRules: opts.domcRules,
    clock: opts.mode === 'exam' && !opts.pauseOnClose ? 'wall' : 'pause',
    clockAt: opts.now,
  };
}

export function responseOf(a: Attempt, qid: string): Response | undefined {
  return a.responses[qid] as Response | undefined;
}

export function domcOf(a: Attempt, q: Question): DomcState {
  return fromStored(a.domc[q.id]) ?? domcInit(q, { shuffle: true, seed: a.seed });
}

/** Adds the time spent on the current question since it was shown. */
export function accrue(a: Attempt, elapsedMs: number): Attempt {
  const qid = a.questionIds[a.current];
  const mark = a.markMs ?? a.elapsedMs;
  const delta = Math.max(0, elapsedMs - mark);
  if (!qid) return { ...a, elapsedMs, markMs: elapsedMs };
  return { ...a, elapsedMs, markMs: elapsedMs, timeByQuestion: { ...a.timeByQuestion, [qid]: (a.timeByQuestion[qid] ?? 0) + delta } };
}

export function goTo(a: Attempt, index: number, elapsedMs: number): Attempt {
  const i = Math.max(0, Math.min(a.questionIds.length - 1, index));
  const b = accrue(a, elapsedMs);
  const qid = b.questionIds[i];
  const reached = { ...(b.reached ?? {}) };
  if (qid && reached[qid] === undefined) reached[qid] = elapsedMs;
  return { ...b, current: i, reached };
}

export function setResponse(a: Attempt, qid: string, r: Response | undefined): Attempt {
  const responses = { ...a.responses };
  if (r === undefined) delete responses[qid];
  else responses[qid] = r;
  return { ...a, responses };
}

export function setDomc(a: Attempt, q: Question, st: DomcState): Attempt {
  return {
    ...a,
    domc: { ...a.domc, [q.id]: toStored(st) },
    responses: { ...a.responses, [q.id]: { format: 'domc', judgments: { ...st.judgments } } },
  };
}

export function toggleFlag(a: Attempt, qid: string): Attempt {
  const flags = a.flags.includes(qid) ? a.flags.filter((f) => f !== qid) : [...a.flags, qid];
  return { ...a, flags };
}

export function markChecked(a: Attempt, qid: string): Attempt {
  const checked = a.checked ?? [];
  return checked.includes(qid) ? a : { ...a, checked: [...checked, qid] };
}

/**
 * Is the answer complete? (stricter than isAnswered: a multiple select needs exactly N choices,
 * a matching needs every left item, a DOMC needs to be finished, a fill needs every blank.)
 */
export function isComplete(q: Question, r: Response | undefined, domc?: DomcState, blanks = 1): boolean {
  if (q.format === 'domc') return !!domc?.done && Object.keys(domc.judgments).length > 0;
  if (!r || !isAnswered(r)) return false;
  switch (r.format) {
    case 'ms': return r.choices.length === (q.choose ?? (q.key as string[]).length);
    case 'match': return (q.match?.left ?? []).every((l) => !!r.pairs[l.id]);
    case 'order': return r.order.length === (q.options?.length ?? 0);
    case 'fill': {
      const parts = (r as { parts?: string[] }).parts;
      return parts ? parts.length >= blanks && parts.every((p) => p.trim().length > 0) : r.text.trim().length > 0;
    }
    default: return true;
  }
}

export interface Progress { answered: number; unanswered: string[]; incomplete: string[]; flagged: string[] }

export function progressOf(a: Attempt, questions: Question[]): Progress {
  const unanswered: string[] = [];
  const incomplete: string[] = [];
  let answered = 0;
  for (const q of questions) {
    const r = responseOf(a, q.id);
    const st = q.format === 'domc' ? domcOf(a, q) : undefined;
    if (isComplete(q, r, st, blanksOf(q))) answered++;
    else if (isAnswered(r)) incomplete.push(q.id);
    else unanswered.push(q.id);
  }
  return { answered, unanswered, incomplete, flagged: a.flags.filter((f) => a.questionIds.includes(f)) };
}

/** Number of answer inputs of a fill-in question: one per blank when the key lists blanks, else one. */
export function blanksOf(q: Question): number {
  if (q.format !== 'fill') return 1;
  const k = q.key as { blanks?: string[][] } | null;
  return k?.blanks?.length || 1;
}

export function scoreOf(a: Attempt, questions: Question[]): { correct: number; total: number; pct: number } {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let correct = 0;
  for (const id of a.questionIds) {
    const q = byId.get(id);
    if (q && grade(q, responseOf(a, id)).correct) correct++;
  }
  const total = a.questionIds.length;
  return { correct, total, pct: total ? Math.round((correct / total) * 1000) / 10 : 0 };
}

export function finishAttempt(a: Attempt, questions: Question[], now: number, elapsedMs: number, timeUp = false): Attempt {
  const b = accrue(a, Math.min(elapsedMs, a.mode === 'exam' ? a.durationMs : elapsedMs));
  return { ...b, status: 'finished', endedAt: now, score: scoreOf(b, questions), timeUp, updatedAt: now };
}

export function remainingMs(a: Attempt, elapsedMs = a.elapsedMs): number {
  return Math.max(0, a.durationMs - elapsedMs);
}
