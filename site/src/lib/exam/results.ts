// Results of a mock attempt or a quiz session: score, pass line, per-topic and per-objective breakdown,
// time per question and pacing against the book's plan (1 min 50 s per question, checkpoints Q22 / Q44).
import type { Question } from '../content-types';
import { grade, PASS_PCT, TARGET_PCT, type Response } from '../scoring';
import { compareObjectives, objective, objectivesOfChapter, TOPICS, topicOf } from './objectives';
import { PACE_MS, responseOf, type Attempt } from './engine';

export interface Outcome {
  q: Question; index: number; response?: Response; correct: boolean; answered: boolean; ms: number; flagged: boolean;
}

export function outcomesOf(a: Attempt, questions: Question[]): Outcome[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return a.questionIds.flatMap((id, index) => {
    const q = byId.get(id);
    if (!q) return [];
    const response = responseOf(a, id);
    const g = grade(q, response);
    return [{ q, index, response, correct: g.correct, answered: g.answered, ms: a.timeByQuestion[id] ?? 0, flagged: a.flags.includes(id) }];
  });
}

/** Topic of a question: its own, or from its objective, or from its chapter's objectives. */
export function questionTopic(q: Question): number | undefined {
  if (q.topic) return q.topic;
  const t = topicOf(q.objective);
  if (t !== undefined) return t;
  if (q.source.kind === 'chapter') {
    const objs = objectivesOfChapter(q.source.chapter);
    const topics = objs.map(topicOf).filter((x): x is number => x !== undefined && x > 0);
    return topics[0] ?? (objs.length ? 0 : undefined);
  }
  return undefined;
}

export interface Row { id: string; title: string; topic: number; correct: number; total: number; pct: number; wrong: Question[] }

const pct = (c: number, t: number) => (t ? Math.round((c / t) * 1000) / 10 : 0);

export function breakdown(outcomes: Outcome[]): { byTopic: Row[]; byObjective: Row[] } {
  const topics = new Map<number, Row>();
  const objs = new Map<string, Row>();
  for (const o of outcomes) {
    const t = questionTopic(o.q);
    if (t !== undefined) {
      const title = t === 0 ? 'Prerequisites (SQL and Git)' : TOPICS.find((x) => x.n === t)?.title ?? `Topic ${t}`;
      const r = topics.get(t) ?? { id: String(t), title, topic: t, correct: 0, total: 0, pct: 0, wrong: [] };
      r.total++; if (o.correct) r.correct++; else r.wrong.push(o.q);
      topics.set(t, r);
    }
    const oid = o.q.objective;
    if (oid) {
      const meta = objective(oid);
      const r = objs.get(oid) ?? { id: oid, title: meta?.title ?? oid, topic: meta?.topic ?? topicOf(oid) ?? 0, correct: 0, total: 0, pct: 0, wrong: [] };
      r.total++; if (o.correct) r.correct++; else r.wrong.push(o.q);
      objs.set(oid, r);
    }
  }
  const fin = (r: Row) => ({ ...r, pct: pct(r.correct, r.total) });
  return {
    byTopic: [...topics.values()].map(fin).sort((a, b) => a.topic - b.topic),
    byObjective: [...objs.values()].map(fin).sort((a, b) => compareObjectives(a.id, b.id)),
  };
}

/** Objectives with mistakes, weakest first (lowest score, then most questions missed). */
export function weakest(rows: Row[], n = 5): Row[] {
  return rows.filter((r) => r.correct < r.total)
    .sort((a, b) => a.pct - b.pct || (b.total - b.correct) - (a.total - a.correct) || compareObjectives(a.id, b.id))
    .slice(0, n);
}

export interface Checkpoint { question: number; targetMs: number; latestMs: number; reachedMs?: number; status: 'ahead' | 'ok' | 'late' | 'not-reached' }

/**
 * The book's checkpoints for 65 questions in 120 minutes: Q22 at minute 25 (latest 40), Q44 at minute 50
 * (latest 80), Q65 at minute 75. For another number of questions they are scaled the same way.
 */
export function checkpoints(n: number): { question: number; targetMs: number; latestMs: number }[] {
  if (n <= 0) return [];
  const qs = n === 65 ? [22, 44, 65] : [...new Set([Math.round((n * 22) / 65), Math.round((n * 44) / 65), n])].filter((x) => x >= 1);
  const BOOK: Record<number, [number, number]> = { 22: [25, 40], 44: [50, 80], 65: [75, 120] };
  return qs.map((q) => {
    if (n === 65) return { question: q, targetMs: BOOK[q][0] * 60_000, latestMs: BOOK[q][1] * 60_000 };
    return { question: q, targetMs: Math.round((q * 75 * 60_000) / 65), latestMs: q === n ? Math.round((n * 120 * 60_000) / 65) : q * PACE_MS };
  });
}

export interface Pacing {
  totalMs: number; avgMs: number; paceMs: number; overPace: number; checkpoints: Checkpoint[]; slowest: Outcome[];
}

export function pacing(a: Attempt, outcomes: Outcome[]): Pacing {
  const totalMs = a.elapsedMs;
  const n = outcomes.length;
  const cps: Checkpoint[] = checkpoints(n).map((c) => {
    const qid = a.questionIds[c.question - 1];
    const reachedMs = qid !== undefined ? a.reached?.[qid] : undefined;
    let status: Checkpoint['status'] = 'not-reached';
    if (reachedMs !== undefined) status = reachedMs <= c.targetMs ? 'ahead' : reachedMs <= c.latestMs ? 'ok' : 'late';
    return { ...c, reachedMs, status };
  });
  return {
    totalMs,
    avgMs: n ? Math.round(totalMs / n) : 0,
    paceMs: PACE_MS,
    overPace: outcomes.filter((o) => o.ms > PACE_MS).length,
    checkpoints: cps,
    slowest: outcomes.filter((o) => o.ms >= 1000).sort((x, y) => y.ms - x.ms).slice(0, 5),
  };
}

export interface Verdict { pct: number; shownPct: number; passed: boolean; ready: boolean; message: string }

/** Pass line 65 %, the book's target 80 %. The shown percentage is rounded down, so 64.6 % never shows as 65 %. */
export function verdict(correct: number, total: number): Verdict {
  const p = total ? (correct / total) * 100 : 0;
  const passed = p >= PASS_PCT;
  const ready = p >= TARGET_PCT;
  const message = ready
    ? 'Above the 80% target. Take another mock exam to confirm: the book says to book the exam after two timed mocks at 80% or more.'
    : passed
      ? 'Above the 65% pass line, but under the 80% target. Review your weakest objectives below, then take another mock.'
      : 'Under the 65% pass line. Redo the labs of the topics where you lost the most points, then try again in a few days.';
  return { pct: Math.round(p * 10) / 10, shownPct: Math.floor(p + 1e-9), passed, ready, message };
}
