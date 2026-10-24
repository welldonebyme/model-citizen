// The learner's progress lives only in their own browser (IndexedDB via Dexie).
// No account, no server. Export/import moves it between computers (see transfer.ts).
// Schema changes: add a new db.version(n) with an upgrade function; never edit an old version.
import Dexie, { type EntityTable } from 'dexie';

export type Os = 'mac' | 'win' | 'wsl';
export type Rhythm = 'standard' | 'intensive' | 'relaxed';

export interface Settings {
  key: 'settings';
  name?: string;
  os?: Os;
  rhythm: Rhythm;
  startDate?: string;        // YYYY-MM-DD, day 1 of the plan
  examDate?: string;         // YYYY-MM-DD
  dailyMinutes: number;      // study goal per day
  domcExtraOption: boolean;  // show one more option after a DOMC item is decided (like the real exam)
  domcEarlyEnd: boolean;     // end a DOMC item as soon as it is decided (Caveon rule); practice can turn it off
  notebookReread?: string;   // YYYY-MM-DD when the learner last re-read the whole error notebook
  examPauseOnClose?: boolean; // mock exams: stop the timer while the page is closed (default: the time keeps passing, like the real exam)
  updatedAt: number;
}

export type ProgressKind = 'step' | 'lesson' | 'lab' | 'labstep' | 'chapter' | 'capstone';
export interface Progress {
  id: string;                // e.g. "step:ch07-s3-1", "lab:ch07-lab2", "labstep:ch07-lab2:3"
  kind: ProgressKind;
  ref: string;               // the content id ("ch07-s3-1")
  status: 'seen' | 'understood' | 'done';
  firstAt: number;
  updatedAt: number;
  data?: Record<string, unknown>;
}

export type AnswerMode = 'quiz' | 'checkpoint' | 'drill' | 'mock-practice' | 'mock-exam' | 'flashcard';
export interface Answer {
  id?: number;
  qid: string;
  mode: AnswerMode;
  attemptId?: string;
  response: unknown;         // shape depends on the question format (see scoring.ts)
  correct: boolean;
  ms?: number;               // time spent on the question
  at: number;
}

export interface ExamAttempt {
  id: string;
  mock: number;              // 1..3, or 0 for a custom drill exam
  mode: 'exam' | 'practice';
  questionIds: string[];
  seed: number;              // option order for DOMC, reproducible
  startedAt: number;
  endedAt?: number;
  durationMs: number;        // 120 min for a full mock
  elapsedMs: number;         // time used so far (autosave)
  current: number;
  responses: Record<string, unknown>;
  flags: string[];
  domc: Record<string, { order: string[]; shown: number; judgments: Record<string, boolean>; decided?: boolean }>;
  timeByQuestion: Record<string, number>;
  status: 'active' | 'finished' | 'abandoned';
  score?: { correct: number; total: number; pct: number };
  updatedAt: number;
}

export interface SrsCard {
  id: string;                // "trap-063", "q-ch07-07", "term-grain", "fact-..."
  kind: 'trap' | 'question' | 'term' | 'fact';
  box: number;               // Leitner box 1..5
  due: string;               // YYYY-MM-DD
  lastAt?: number;
  lapses: number;
  updatedAt: number;
}

export interface Note {
  id: string;                // "error:q-ch07-07", "explain:ch07", "note:<uuid>"
  kind: 'error' | 'explain' | 'personal';
  ref?: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface Activity {
  date: string;              // YYYY-MM-DD (local time)
  minutes: number;
  events: number;
  updatedAt: number;
}

export const DB_NAME = 'model-citizen';
export const SCHEMA_VERSION = 1;

export class ModelCitizenDB extends Dexie {
  settings!: EntityTable<Settings, 'key'>;
  progress!: EntityTable<Progress, 'id'>;
  answers!: EntityTable<Answer, 'id'>;
  examAttempts!: EntityTable<ExamAttempt, 'id'>;
  srs!: EntityTable<SrsCard, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  activity!: EntityTable<Activity, 'date'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      settings: 'key',
      progress: 'id, kind, ref, status, updatedAt',
      answers: '++id, qid, mode, attemptId, at, [qid+at]',
      examAttempts: 'id, mock, mode, status, startedAt',
      srs: 'id, kind, due, box',
      notes: 'id, kind, ref, updatedAt',
      activity: 'date',
    });
  }
}

let _db: ModelCitizenDB | null = null;
/** The shared database. Throws in environments without IndexedDB (callers show a notice). */
export function db(): ModelCitizenDB {
  if (!_db) _db = new ModelCitizenDB();
  return _db;
}

export const DEFAULT_SETTINGS: Settings = {
  key: 'settings',
  rhythm: 'standard',
  dailyMinutes: 120,
  domcExtraOption: true,
  domcEarlyEnd: true,
  updatedAt: 0,
};

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db().settings.get('settings')) ?? {}) };
}

export async function saveSettings(patch: Partial<Omit<Settings, 'key'>>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch, key: 'settings' as const, updatedAt: Date.now() };
  await db().settings.put(next);
  return next;
}

/** Local calendar date, YYYY-MM-DD (the learner's day, not UTC). */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function markProgress(kind: ProgressKind, ref: string, status: Progress['status'], data?: Record<string, unknown>) {
  const id = `${kind}:${ref}`;
  const now = Date.now();
  const RANK = { seen: 0, understood: 1, done: 2 } as const;
  await db().transaction('rw', db().progress, async () => {
    const old = await db().progress.get(id);
    // never downgrade a status (done stays done when the page is seen again)
    const keep = old && RANK[old.status] > RANK[status];
    await db().progress.put({ id, kind, ref, status: keep ? old!.status : status, firstAt: old?.firstAt ?? now, updatedAt: now, data: data ?? old?.data });
  });
  await logActivity(0);
}

/** Sets a status even when it is lower than the saved one (the learner unticked "I understood this"). */
export async function setProgress(kind: ProgressKind, ref: string, status: Progress['status'], data?: Record<string, unknown>) {
  const id = `${kind}:${ref}`;
  const now = Date.now();
  await db().transaction('rw', db().progress, async () => {
    const old = await db().progress.get(id);
    await db().progress.put({ id, kind, ref, status, firstAt: old?.firstAt ?? now, updatedAt: now, data: data ?? old?.data });
  });
}

export async function unmarkProgress(kind: ProgressKind, ref: string) {
  await db().progress.delete(`${kind}:${ref}`);
}

/** Adds study minutes (and one event) to today's activity; used for streaks and the Today page. */
export async function logActivity(minutes: number, date = today()) {
  await db().transaction('rw', db().activity, async () => {
    const a = await db().activity.get(date);
    await db().activity.put({ date, minutes: (a?.minutes ?? 0) + minutes, events: (a?.events ?? 0) + 1, updatedAt: Date.now() });
  });
}

export async function recordAnswer(a: Omit<Answer, 'id' | 'at'> & { at?: number }) {
  await db().answers.add({ ...a, at: a.at ?? Date.now() });
  await logActivity(0);
}

/** Days in a row (ending today or yesterday) with at least one study event. */
export function streakFrom(dates: string[], now = new Date()): number {
  const set = new Set(dates);
  const d = new Date(now);
  if (!set.has(today(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(today(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
