// Exam day (Chapter 27 of the book: "The last 7 days" and the "Exam-day checklist"): countdown helpers,
// the ticked items (saved in this browser's database, so they travel with the progress file), and the
// book's four booking conditions computed from the learner's progress (same rule as the Today page).
import { readiness, type Readiness } from './planner';
import { capstoneDone, mocksAt80, quizzesAt80 } from './progress-summary';
import { db, today, type Answer, type ExamAttempt, type Note, type Progress, type Settings } from './store/db';

/** Calendar days from `from` (local day) to the exam date (YYYY-MM-DD). 0 = exam day, negative = past. */
export function daysUntil(examDate: string, from: Date | string = new Date()): number {
  const a = typeof from === 'string' ? from : today(from);
  const n = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86_400_000; };
  return Math.round(n(examDate) - n(a));
}

/** "D−3" for 3 days before the exam (the book's labels, with a real minus sign), "D0" on the day. */
export function planDayLabel(days: number): string | null {
  if (days < 0 || days > 7) return null;
  return days === 0 ? 'D0' : `D−${days}`;
}

/** Days before the exam that a row label of the book means ("D−7" -> 7, "D0" -> 0). */
export function daysOfLabel(label: string): number | null {
  const m = /^D\s*[−-]?\s*(\d+)$/.exec(label.replace(/\s+/g, ''));
  return m ? Number(m[1]) : null;
}

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00'));

/** A long, readable date in English: "Thursday 5 November 2026". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ---- saved ticks: one row of the settings table with its own key (exported and imported with the rest) ----

export const EXAM_DAY_KEY = 'exam-day';
export interface ExamDayTicks { key: typeof EXAM_DAY_KEY; week: string[]; checklist: string[]; updatedAt: number }

export async function loadTicks(): Promise<ExamDayTicks> {
  const row = (await db().settings.get(EXAM_DAY_KEY as Settings['key'])) as unknown as Partial<ExamDayTicks> | undefined;
  return {
    key: EXAM_DAY_KEY,
    week: Array.isArray(row?.week) ? row!.week.filter((x) => typeof x === 'string') : [],
    checklist: Array.isArray(row?.checklist) ? row!.checklist.filter((x) => typeof x === 'string') : [],
    updatedAt: typeof row?.updatedAt === 'number' ? row.updatedAt : 0,
  };
}

export async function saveTicks(t: Pick<ExamDayTicks, 'week' | 'checklist'>): Promise<ExamDayTicks> {
  const row: ExamDayTicks = { key: EXAM_DAY_KEY, week: [...new Set(t.week)], checklist: [...new Set(t.checklist)], updatedAt: Date.now() };
  await db().settings.put(row as unknown as Settings);
  return row;
}

export function toggle(list: string[], id: string, on: boolean): string[] {
  const s = new Set(list);
  if (on) s.add(id); else s.delete(id);
  return [...s];
}

// ---- the book's four booking conditions ----

export interface ReadinessData {
  answers: Answer[];
  attempts: ExamAttempt[];
  progress: Progress[];
  notes: Note[];
  settings?: Partial<Settings>;
}

/** The same numbers as the Today page and the dashboard (lib/progress-summary). */
export function readinessFromData(d: ReadinessData, chapterQuiz: [string, number][], capstoneSteps: Record<string, number>, capstoneTotal: number): Readiness {
  const quizzes = quizzesAt80(d.progress.filter((p) => p.kind === 'chapter'), d.answers, new Map(chapterQuiz));
  return readiness({
    quizzes: { ok: quizzes.ok, total: quizzes.total },
    capstone: { ok: capstoneDone(d.progress, capstoneSteps), total: capstoneTotal },
    mocks: { ok: Math.min(2, mocksAt80(d.attempts)), total: 2 },
    notebook: { reread: !!d.settings?.notebookReread, notes: d.notes.filter((n) => n.kind === 'error').length },
  });
}
