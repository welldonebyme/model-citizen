// Numbers shown on the Today page and the dashboard, computed the same way in both places from the
// browser's progress (IndexedDB rows). Pure functions, unit-tested.
import type { Activity, Answer, ExamAttempt, Progress } from './store/db';
import { today } from './store/db';

export interface Mastery { correct: number; answered: number; available: number }

/** Latest answer per question → per objective: how many of its questions are answered, and right. */
export function masteryByObjective(answers: Answer[], questionObjective: Record<string, string>): Map<string, Mastery> {
  const latest = new Map<string, Answer>();
  for (const a of answers) {
    const prev = latest.get(a.qid);
    if (!prev || a.at >= prev.at) latest.set(a.qid, a);
  }
  const out = new Map<string, Mastery>();
  for (const [qid, obj] of Object.entries(questionObjective)) {
    const m = out.get(obj) ?? { correct: 0, answered: 0, available: 0 };
    m.available++;
    const a = latest.get(qid);
    if (a) { m.answered++; if (a.correct) m.correct++; }
    out.set(obj, m);
  }
  return out;
}

/** 0 = not started, 1 = learning, 2 = mastered (at least 3 answered and 80% of them right). */
export function masteryLevel(m: Mastery | undefined): 0 | 1 | 2 {
  if (!m || m.answered === 0) return 0;
  return m.answered >= 3 && m.correct / m.answered >= 0.8 ? 2 : 1;
}

/**
 * Chapter quizzes at 80% or more (the book's first readiness condition). The exam engine writes
 * progress `chapter:chNN` with { best, total } when a quiz is finished; older data falls back to answers.
 */
export function quizzesAt80(progress: Progress[], answers: Answer[], chapterQuiz: Map<string, number>): { ok: number; total: number; best: Map<string, number> } {
  const best = new Map<string, number>();
  for (const p of progress) {
    if (p.kind !== 'chapter' || !p.data) continue;
    const d = p.data as { best?: number; score?: number; total?: number };
    const total = d.total ?? chapterQuiz.get(p.ref) ?? 0;
    const b = d.best ?? d.score ?? 0;
    if (total) best.set(p.ref, Math.max(best.get(p.ref) ?? 0, b / total));
  }
  // fallback: a question counts as right if it was answered right at least once in quiz mode
  const byQ = new Map<string, boolean>();
  for (const a of answers) if (a.mode === 'quiz') byQ.set(a.qid, a.correct || (byQ.get(a.qid) ?? false));
  const perCh = new Map<string, number>();
  for (const [qid, ok] of byQ) {
    const m = qid.match(/^q-(ch\d+)-/);
    if (m && ok) perCh.set(m[1], (perCh.get(m[1]) ?? 0) + 1);
  }
  for (const [ch, n] of perCh) {
    const total = chapterQuiz.get(ch);
    if (total) best.set(ch, Math.max(best.get(ch) ?? 0, n / total));
  }
  const ok = [...chapterQuiz.keys()].filter((ch) => (best.get(ch) ?? 0) >= 0.8).length;
  return { ok, total: chapterQuiz.size, best };
}

/** Distinct mocks passed at 80% or more in timed exam mode (the book: two of them before booking). */
export function mocksAt80(attempts: ExamAttempt[]): number {
  return new Set(attempts.filter((a) => a.status === 'finished' && a.mode === 'exam' && (a.score?.pct ?? 0) >= 80).map((a) => a.mock)).size;
}

export function lessonsDone(progress: Progress[]): Set<string> {
  return new Set(progress.filter((p) => p.kind === 'lesson' && p.status === 'done').map((p) => p.ref));
}

/** Labs whose numbered steps are all ticked (lab ids → number of steps, from the content). */
export function labsDone(progress: Progress[], labSteps: Record<string, number>): { done: Set<string>; started: Set<string> } {
  const ticked = new Map<string, number>();
  for (const p of progress) {
    if (p.kind !== 'labstep') continue;
    const lab = p.ref.replace(/:\d+$/, '');
    ticked.set(lab, (ticked.get(lab) ?? 0) + 1);
  }
  const done = new Set<string>();
  const started = new Set<string>();
  for (const [lab, n] of ticked) {
    started.add(lab);
    if (labSteps[lab] && n >= labSteps[lab]) done.add(lab);
  }
  return { done, started };
}

/** Study minutes per day for the last `days` days, oldest first (missing days = 0). */
export function minutesByDay(activity: Activity[], days: number, now = new Date()): { date: string; minutes: number; events: number }[] {
  const by = new Map(activity.map((a) => [a.date, a]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = today(d);
    out.push({ date: key, minutes: by.get(key)?.minutes ?? 0, events: by.get(key)?.events ?? 0 });
  }
  return out;
}
