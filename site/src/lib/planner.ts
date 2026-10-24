// The study planner, from Part 0 of the book: "Your 14-week study plan" (about 2 hours a day, 6 days a week),
// "Other rhythms" and "A typical 2-hour study session". Pure functions; the Today page feeds them saved progress.
import type { Rhythm } from './store/db';

/** Plan weeks of the standard rhythm → chapter ids (Part 0 table). Chapter 4 is split in two halves. */
export const STANDARD_WEEKS: { week: number; chapters: string[]; half?: 'ch04a' | 'ch04b'; checkpoint: string }[] = [
  { week: 1, chapters: ['ch00', 'ch01', 'ch02'], checkpoint: 'Workspace ready, `dbt --version` works' },
  { week: 2, chapters: ['ch03', 'ch04'], half: 'ch04a', checkpoint: 'Practice repo on GitHub, first PR merged' },
  { week: 3, chapters: ['ch04', 'ch05'], half: 'ch04b', checkpoint: 'Customer orders report query works' },
  { week: 4, chapters: ['ch06', 'ch07'], checkpoint: 'First dbt project builds' },
  { week: 5, chapters: ['ch08', 'ch09'], checkpoint: 'Legacy SQL refactored' },
  { week: 6, chapters: ['ch10', 'ch11'], checkpoint: 'Packages and macros in the project' },
  { week: 7, chapters: ['ch12', 'ch13'], checkpoint: 'Snapshot history after day 2' },
  { week: 8, chapters: ['ch14', 'ch15', 'ch16'], checkpoint: 'Part II quiz average 80% or more' },
  { week: 9, chapters: ['ch17', 'ch18'], checkpoint: 'Contracts and tests in the project' },
  { week: 10, chapters: ['ch19', 'ch20', 'ch21'], checkpoint: 'Unit tests pass, freshness green' },
  { week: 11, chapters: ['ch22', 'ch23'], checkpoint: 'Nine bugs fixed, prod build and clone' },
  { week: 12, chapters: ['ch24', 'ch25'], checkpoint: 'Slim CI command runs' },
  { week: 13, chapters: ['ch26'], checkpoint: 'Capstone complete' },
  { week: 14, chapters: ['ch27', 'ch28', 'ch29', 'ch30', 'ch31', 'ch32', 'ch33'], checkpoint: 'Two mocks at 80% or more, then book the exam' },
];

export const STUDY_DAYS_PER_WEEK = 6;

export const RHYTHMS: Record<Rhythm, { label: string; hoursPerDay: string; describe: string }> = {
  standard: { label: 'Standard', hoursPerDay: 'about 2 h a day', describe: 'The 14-week plan of the book.' },
  intensive: { label: 'Intensive', hoursPerDay: '3 to 4 h a day', describe: 'About 8 weeks: two plan weeks per week for weeks 1 to 12, then a full week each for the capstone and the mocks.' },
  relaxed: { label: 'Relaxed', hoursPerDay: 'about 1 h a day', describe: 'Each plan week of Parts II to VII takes two weeks.' },
};

/** Calendar weeks for a rhythm: each entry lists the plan weeks studied in that calendar week (possibly half of one). */
export function calendar(rhythm: Rhythm): { planWeeks: number[]; part?: 1 | 2 }[] {
  if (rhythm === 'intensive') {
    const out: { planWeeks: number[] }[] = [];
    for (let w = 1; w <= 12; w += 2) out.push({ planWeeks: [w, w + 1] });
    out.push({ planWeeks: [13] }, { planWeeks: [14] });
    return out;
  }
  if (rhythm === 'relaxed') {
    const out: { planWeeks: number[]; part?: 1 | 2 }[] = [];
    for (let w = 1; w <= 14; w++) {
      if (w >= 4 && w <= 12) out.push({ planWeeks: [w], part: 1 }, { planWeeks: [w], part: 2 });
      else out.push({ planWeeks: [w] });
    }
    return out;
  }
  return STANDARD_WEEKS.map((w) => ({ planWeeks: [w.week] }));
}

export interface PlanLesson { id: string; chapter: string; minutes: number; labMinutes?: number; title: string; number: string; labs: string[]; half?: 'a' | 'b' }

/** Lessons of the course grouped by calendar week, then split over the study days of that week by minutes. */
export function schedule(lessons: PlanLesson[], rhythm: Rhythm): string[][] {
  const byChapter = new Map<string, PlanLesson[]>();
  for (const l of lessons) byChapter.set(l.chapter, [...(byChapter.get(l.chapter) ?? []), l]);
  const planWeekLessons = (w: (typeof STANDARD_WEEKS)[number]): PlanLesson[] =>
    w.chapters.flatMap((c) => {
      const ls = byChapter.get(c) ?? [];
      if (c === 'ch04' && w.half) return ls.filter((l) => (w.half === 'ch04a' ? l.half !== 'b' : l.half === 'b'));
      return ls;
    });
  const days: string[][] = [];
  for (const cw of calendar(rhythm)) {
    let ls = cw.planWeeks.flatMap((n) => planWeekLessons(STANDARD_WEEKS[n - 1]));
    if (cw.part) {
      // relaxed: the plan week is split in two calendar weeks by minutes
      const total = ls.reduce((m, l) => m + l.minutes, 0);
      let acc = 0;
      ls = ls.filter((l) => { const first = acc < total / 2; acc += l.minutes; return cw.part === 1 ? first : !first; });
    }
    days.push(...splitByMinutes(ls, STUDY_DAYS_PER_WEEK).map((d) => d.map((l) => l.id)));
  }
  return days;
}

/** Splits an ordered list into n consecutive groups with balanced minutes (never reorders). */
export function splitByMinutes<T extends { minutes: number }>(items: T[], n: number): T[][] {
  const total = items.reduce((m, l) => m + l.minutes, 0);
  const out: T[][] = Array.from({ length: n }, () => []);
  let acc = 0;
  for (const it of items) {
    const day = Math.min(n - 1, Math.floor((acc / Math.max(1, total)) * n));
    out[day].push(it);
    acc += it.minutes;
  }
  return out;
}

/** Day index (0-based study day) since the start date, counting 6 study days per 7 calendar days. */
export function studyDayIndex(startDate: string, on: string): number {
  const a = new Date(startDate + 'T00:00:00');
  const b = new Date(on + 'T00:00:00');
  const days = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (days < 0) return 0;
  return Math.floor(days / 7) * STUDY_DAYS_PER_WEEK + Math.min(STUDY_DAYS_PER_WEEK - 1, days % 7);
}

export interface MissionItem {
  kind: 'review' | 'read' | 'lab' | 'quiz' | 'mock' | 'rest';
  title: string;
  minutes: number;
  href?: string;
  refs?: string[];
  done?: boolean;
}

export interface MissionInput {
  days: string[][];              // schedule()
  dayIndex: number;              // studyDayIndex()
  done: Set<string>;             // lessons done
  dueCards: number;
  lessons: Map<string, PlanLesson>;
  chapterQuiz: Map<string, number>;   // chapter id -> number of questions
  quizDone: Set<string>;         // chapters whose quiz was taken
  readingBudget?: number;        // minutes of reading per day (book: 40 of 120)
  labTitles?: Map<string, string>;
}

/**
 * Today's mission, shaped like the book's 2-hour session: 10 min spaced review, about 40 min reading,
 * about 50 min labs, 20 min quiz. Lessons come from the schedule up to today; late lessons are caught up first.
 */
export function mission(m: MissionInput): { items: MissionItem[]; behind: number; scheduledToday: string[] } {
  const budget = m.readingBudget ?? 40;
  const upToToday = m.days.slice(0, m.dayIndex + 1).flat();
  const pending = upToToday.filter((id) => !m.done.has(id));
  const behind = pending.filter((id) => !(m.days[m.dayIndex] ?? []).includes(id)).length;
  const nextAll = m.days.flat().filter((id) => !m.done.has(id));
  const queue = pending.length ? pending : nextAll.slice(0, 3);
  const read: PlanLesson[] = [];
  let mins = 0;
  for (const id of queue) {
    const l = m.lessons.get(id);
    if (!l) continue;
    if (read.length && mins + l.minutes > budget) break;
    read.push(l);
    mins += l.minutes;
  }
  const items: MissionItem[] = [];
  if (m.dueCards > 0) items.push({ kind: 'review', title: `Spaced review, ${m.dueCards} ${m.dueCards === 1 ? 'card' : 'cards'}`, minutes: 10 });
  for (const l of read) items.push({ kind: 'read', title: `${l.number} ${l.title}`, minutes: l.minutes, refs: [l.id] });
  // Labs: the lesson's lab time from the converter (shared between its labs), at most 3 labs a day.
  const todayLabs = read.flatMap((l) => l.labs.map((lab) => ({ lab, mins: l.labMinutes ? Math.max(10, Math.round(l.labMinutes / l.labs.length / 5) * 5) : 25 }))).slice(0, 3);
  for (const { lab, mins } of todayLabs) items.push({ kind: 'lab', title: m.labTitles?.get(lab) ?? 'The lab of this lesson', minutes: mins, refs: [lab] });
  // Quiz: when today's reading finishes a chapter (or a chapter is finished but its quiz not taken).
  const finished = new Set<string>();
  for (const [cid] of m.chapterQuiz) {
    const ids = [...m.lessons.values()].filter((l) => l.chapter === cid).map((l) => l.id);
    if (ids.length && ids.every((id) => m.done.has(id) || read.some((r) => r.id === id)) && !m.quizDone.has(cid)) finished.add(cid);
  }
  for (const cid of finished) items.push({ kind: 'quiz', title: `Check yourself, chapter ${Number(cid.slice(2))}`, minutes: 20, refs: [cid] });
  if (!items.length) items.push({ kind: 'rest', title: 'Nothing is due. Review your error notebook or take a drill.', minutes: 20 });
  return { items, behind, scheduledToday: m.days[m.dayIndex] ?? [] };
}

export interface Readiness {
  quizzes: { ok: number; total: number };
  capstone: { ok: number; total: number };
  mocks: { ok: number; total: 2 };
  notebook: { reread: boolean; notes: number };
  ready: boolean;
}

/** The book's rule: book the exam when all four conditions are true. */
export function readiness(r: Omit<Readiness, 'ready'>): Readiness {
  const ready = r.quizzes.ok >= r.quizzes.total && r.quizzes.total > 0 && r.capstone.ok >= r.capstone.total && r.mocks.ok >= 2 && r.notebook.reread;
  return { ...r, ready };
}
