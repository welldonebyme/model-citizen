// Gamification: XP, levels and badges, computed only from the learner's real progress (pure functions).
// Nothing is stored here: the same data always gives the same XP, so an imported progress file gives the
// same level on another computer. The page components read the data (Dexie) and the course facts
// (delight/facts.json: lab steps, question formats, chapter quiz order) and call computeGame().
import type { Format } from './content-types';
import type { Activity, Answer, ExamAttempt, Note, Progress, Settings, SrsCard } from './store/db';
import { streakFrom } from './store/db';
import { capstoneDone as capstoneDoneOf, labsDone as labsDoneOf, mocksAt80 } from './progress-summary';

/** Course facts the badges need, computed at build time from the book (see gamification-facts.ts). */
export interface GameFacts {
  v: 1;
  /** lab id -> number of ticks that finish it (lib/lab-steps.ts, same numbers as the dashboard) */
  labSteps: Record<string, number>;
  /** the Chapter 6 lab that runs the first dbt project ("first model built") */
  firstModelLab?: string;
  /** the first lab step where `dbt build` passes, models and tests ("ch07-lab3:2") */
  greenBuildStep?: string;
  /** question id -> format */
  formats: Record<string, Format>;
  /** chapter id -> its quiz question ids, in the order of the quiz */
  quizzes: Record<string, string[]>;
  /** milestones of the capstone project */
  capstoneMilestones: number;
}

export const EMPTY_FACTS: GameFacts = { v: 1, labSteps: {}, formats: {}, quizzes: {}, capstoneMilestones: 15 };

export interface GameData {
  progress: Progress[];
  answers: Answer[];
  attempts: ExamAttempt[];
  srs: SrsCard[];
  notes: Note[];
  activity: Activity[];
  settings?: Partial<Settings>;
}

/** XP for each kind of real progress. Shown to the learner in "How XP works". */
export const XP = {
  step: 2,          // a lesson step marked "I understood this"
  lesson: 10,       // a lesson done (every step understood)
  labStep: 5,       // a lab tick (a numbered step, a capstone requirement, or "I did this lab")
  lab: 15,          // a lab with every tick (bonus)
  answer: 1,        // any answer (quiz, checkpoint, drill, mock)
  firstRight: 4,    // a question answered right for the first time (bonus)
  mock: 40,         // a timed mock exam finished
  mock80: 40,       // ... at 80% or more (bonus)
  review: 1,        // a flashcard review
  day: 10,          // a day with study
  focus5: 1,        // 5 minutes logged with the focus timer
  explain: 15,      // an "explain it back" note for a chapter
  capstone: 30,     // a capstone milestone
} as const;

export const XP_RULES: { label: string; xp: string }[] = [
  { label: 'Lesson step you understood', xp: `${XP.step}` },
  { label: 'Lesson done', xp: `${XP.lesson}` },
  { label: 'Lab step or requirement ticked', xp: `${XP.labStep}` },
  { label: 'Lab finished (every tick)', xp: `+${XP.lab}` },
  { label: 'Question answered', xp: `${XP.answer}` },
  { label: 'Question right for the first time', xp: `+${XP.firstRight}` },
  { label: 'Timed mock exam finished', xp: `${XP.mock}` },
  { label: 'Timed mock exam at 80% or more', xp: `+${XP.mock80}` },
  { label: 'Flashcard review', xp: `${XP.review}` },
  { label: 'Day with study', xp: `${XP.day}` },
  { label: '5 minutes with the focus timer', xp: `${XP.focus5}` },
  { label: '"Explain it back" note for a chapter', xp: `${XP.explain}` },
  { label: 'Capstone milestone', xp: `${XP.capstone}` },
];

/** Levels follow the lineage of a dbt project, from a seed to a trusted model. */
export const LEVELS: { n: number; name: string; min: number; line: string }[] = [
  { n: 1, name: 'Seed', min: 0, line: 'Small and static. A good place to start.' },
  { n: 2, name: 'Source', min: 300, line: 'Raw data is coming in.' },
  { n: 3, name: 'Staging', min: 1000, line: 'Cleaned and renamed, one source at a time.' },
  { n: 4, name: 'Intermediate', min: 2500, line: 'You join ideas together.' },
  { n: 5, name: 'Mart', min: 4500, line: 'Ready for other people to use.' },
  { n: 6, name: 'Contract', min: 7000, line: 'Your shape is guaranteed.' },
  { n: 7, name: 'Exposure', min: 10000, line: 'Your work is used downstream.' },
  { n: 8, name: 'Model citizen', min: 13500, line: 'Tested, documented and trusted.' },
];

export interface LevelInfo {
  n: number;
  name: string;
  line: string;
  min: number;
  next?: { n: number; name: string; min: number };
  /** 0..1 of the way to the next level (1 at the last level) */
  progress: number;
  toNext: number;
}

export function levelFor(xp: number): LevelInfo {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].min) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1];
  const progress = next ? Math.max(0, Math.min(1, (xp - cur.min) / (next.min - cur.min))) : 1;
  return { n: cur.n, name: cur.name, line: cur.line, min: cur.min, next: next && { n: next.n, name: next.name, min: next.min }, progress, toNext: next ? next.min - xp : 0 };
}

export type Glyph = 'lesson' | 'explain' | 'model' | 'build' | 'seven' | 'thirty' | 'formats' | 'perfect' | 'domc' | 'memory' | 'focus' | 'capstone' | 'mock' | 'notebook' | 'ready';

export interface BadgeDef { id: string; title: string; text: string; glyph: Glyph }
export interface BadgeState extends BadgeDef {
  earned: boolean;
  /** how far the learner is (shown on badges not earned yet) */
  progress?: { value: number; target: number };
}

/** In the order a learner usually meets them. */
export const BADGES: BadgeDef[] = [
  { id: 'first-lesson', title: 'First lesson', text: 'You finished your first lesson.', glyph: 'lesson' },
  { id: 'explain', title: 'Explained it back', text: 'You wrote your first "explain it back" note for a chapter.', glyph: 'explain' },
  { id: 'first-model', title: 'First model built', text: 'You finished the Chapter 6 lab that runs your first dbt project.', glyph: 'model' },
  { id: 'green-build', title: 'First green build', text: 'You ticked the Chapter 7 lab step where dbt build passes: models and tests.', glyph: 'build' },
  { id: 'streak-7', title: 'Seven days in a row', text: 'You studied 7 days in a row.', glyph: 'seven' },
  { id: 'all-formats', title: 'Every format', text: 'A right answer in each of the 7 question formats.', glyph: 'formats' },
  { id: 'quiz-perfect', title: 'Perfect quiz', text: 'A full chapter quiz with every answer right on the first try.', glyph: 'perfect' },
  { id: 'domc-master', title: 'DOMC master', text: '20 DOMC questions right in a row.', glyph: 'domc' },
  { id: 'long-memory', title: 'Long memory', text: '20 flashcards reached the last review box (60 days).', glyph: 'memory' },
  { id: 'focus-10h', title: 'Ten hours of focus', text: '600 minutes logged with the focus timer.', glyph: 'focus' },
  { id: 'streak-30', title: 'Thirty days in a row', text: 'You studied 30 days in a row.', glyph: 'thirty' },
  { id: 'capstone', title: 'Capstone shipped', text: 'Every milestone of the ShopFlow capstone is done.', glyph: 'capstone' },
  { id: 'mock-80', title: 'Mock at 80%', text: 'A timed mock exam at 80% or more.', glyph: 'mock' },
  { id: 'notebook', title: 'Notebook re-read', text: 'You re-read your whole error notebook.', glyph: 'notebook' },
  { id: 'two-mocks', title: 'Two mocks at 80%', text: 'Two different timed mocks at 80% or more: one of the four conditions to book the exam.', glyph: 'ready' },
];

export interface GameState {
  xp: number;
  parts: { lessons: number; labs: number; questions: number; mocks: number; reviews: number; habits: number };
  level: LevelInfo;
  badges: BadgeState[];
  streak: { current: number; best: number };
  stats: {
    lessonsDone: number; stepsUnderstood: number; labStepsDone: number; labsDone: number;
    answers: number; questionsRight: number; mocksFinished: number; reviews: number;
    studyDays: number; focusMinutes: number; explainNotes: number; capstoneDone: number;
    domcBestRun: number; formatsRight: number; perfectQuizzes: string[];
  };
}

/** Days between two YYYY-MM-DD dates (calendar days, no time zone effects). */
function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** The longest run of consecutive days in a list of YYYY-MM-DD dates. */
export function bestStreak(dates: string[]): number {
  const days = [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(dayNumber))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** The longest run of right answers in a row, in answer order, among the questions that pass the test. */
export function bestRun(answers: Answer[], keep: (a: Answer) => boolean): number {
  let best = 0;
  let run = 0;
  for (const a of answers) {
    if (!keep(a)) continue;
    run = a.correct ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Chapters with a perfect quiz round: N answers in a row in the chapter quiz (mode 'quiz'), all right,
 * for the N questions of the quiz in their order. A retry of the missed questions is never a full round.
 */
export function perfectQuizzes(answers: Answer[], quizzes: Record<string, string[]>): string[] {
  const chapterOf = new Map<string, string>();
  for (const [ch, ids] of Object.entries(quizzes)) for (const id of ids) chapterOf.set(id, ch);
  const seqs = new Map<string, Answer[]>();
  for (const a of answers) {
    if (a.mode !== 'quiz') continue;
    const ch = chapterOf.get(a.qid);
    if (!ch) continue;
    const list = seqs.get(ch) ?? [];
    list.push(a);
    seqs.set(ch, list);
  }
  const out: string[] = [];
  for (const [ch, seq] of seqs) {
    const ids = quizzes[ch];
    const n = ids.length;
    if (!n) continue;
    for (let i = 0; i + n <= seq.length; i++) {
      let ok = true;
      for (let k = 0; k < n && ok; k++) ok = seq[i + k].qid === ids[k] && seq[i + k].correct;
      if (ok) { out.push(ch); break; }
    }
  }
  return out.sort();
}

/** Own words in an "explain it back" note: the text without its header and prompt lines. */
export function explainOwnWords(text: string): number {
  return text.split('\n').filter((l) => !/^(##\s|Explain it back:)/.test(l.trim())).join(' ').replace(/\s+/g, ' ').trim().length;
}

const ALL_FORMATS: Format[] = ['mc', 'ms', 'fill', 'match', 'hotspot', 'order', 'domc'];

export function computeGame(data: GameData, facts: GameFacts, now = new Date()): GameState {
  const answers = data.answers.filter((a) => a.mode !== 'flashcard').slice().sort((a, b) => a.at - b.at);

  // lessons
  const stepsUnderstood = data.progress.filter((p) => p.kind === 'step' && (p.status === 'understood' || p.status === 'done')).length;
  const lessonsDone = data.progress.filter((p) => p.kind === 'lesson' && p.status === 'done').length;

  // labs: the same counting as the dashboard (lib/progress-summary, lib/lab-steps)
  const labTicks = new Set(data.progress.filter((p) => p.kind === 'labstep').map((p) => p.ref));
  const labs = labsDoneOf(data.progress, facts.labSteps);
  const labsDone = labs.done.size;
  const capstoneDone = Math.min(facts.capstoneMilestones, capstoneDoneOf(data.progress, facts.labSteps));

  // questions
  const rightOnce = new Set<string>();
  for (const a of answers) if (a.correct) rightOnce.add(a.qid);
  const formatsRight = new Set([...rightOnce].map((id) => facts.formats[id]).filter(Boolean)).size;
  const domcBestRun = bestRun(answers, (a) => facts.formats[a.qid] === 'domc');
  const perfect = perfectQuizzes(answers, facts.quizzes);

  // mocks: timed (exam mode), finished
  const exams = data.attempts.filter((a) => a.status === 'finished' && a.mode === 'exam' && a.mock >= 1);
  const mocks80 = mocksAt80(exams);

  // reviews: Leitner boxes only go up one per remembered review, so (box - 1) + lapses is a safe count.
  // Question cards are reviewed by answering the question (counted above), so they are not counted twice.
  const cards = data.srs.filter((c) => c.kind !== 'question' && c.lastAt);
  const reviews = cards.reduce((n, c) => n + Math.max(0, c.box - 1) + c.lapses, 0);
  const lastBox = data.srs.filter((c) => c.box >= 5).length;

  // habits
  const studyDates = data.activity.filter((a) => a.events > 0 || a.minutes > 0).map((a) => a.date);
  const focusMinutes = data.activity.reduce((n, a) => n + Math.max(0, a.minutes || 0), 0);
  const explainNotes = new Set(data.notes.filter((n) => n.kind === 'explain' && explainOwnWords(n.text) >= 40).map((n) => n.ref ?? n.id)).size;
  const streak = { current: streakFrom(studyDates, now), best: bestStreak(studyDates) };

  const parts = {
    lessons: stepsUnderstood * XP.step + lessonsDone * XP.lesson,
    labs: labTicks.size * XP.labStep + labsDone * XP.lab + capstoneDone * XP.capstone,
    questions: answers.length * XP.answer + rightOnce.size * XP.firstRight,
    mocks: exams.length * XP.mock + exams.filter((a) => (a.score?.pct ?? 0) >= 80).length * XP.mock80,
    reviews: reviews * XP.review,
    habits: studyDates.length * XP.day + Math.floor(focusMinutes / 5) * XP.focus5 + explainNotes * XP.explain,
  };
  const xp = Object.values(parts).reduce((a, b) => a + b, 0);

  const firstModelTotal = facts.firstModelLab ? facts.labSteps[facts.firstModelLab] ?? 0 : 0;
  const firstModelTicked = facts.firstModelLab ? [...labTicks].filter((r) => r.startsWith(`${facts.firstModelLab}:`)).length : 0;
  const p = (value: number, target: number) => ({ value: Math.min(value, target), target });
  const state: Record<string, { earned: boolean; progress?: { value: number; target: number } }> = {
    'first-lesson': { earned: lessonsDone >= 1 },
    explain: { earned: explainNotes >= 1 },
    'first-model': {
      earned: !!facts.firstModelLab && labs.done.has(facts.firstModelLab),
      progress: firstModelTotal ? p(firstModelTicked, firstModelTotal) : undefined,
    },
    'green-build': { earned: !!facts.greenBuildStep && labTicks.has(facts.greenBuildStep) },
    'streak-7': { earned: streak.best >= 7, progress: p(streak.best, 7) },
    'all-formats': { earned: formatsRight >= ALL_FORMATS.length, progress: p(formatsRight, ALL_FORMATS.length) },
    'quiz-perfect': { earned: perfect.length > 0 },
    'domc-master': { earned: domcBestRun >= 20, progress: p(domcBestRun, 20) },
    'long-memory': { earned: lastBox >= 20, progress: p(lastBox, 20) },
    'focus-10h': { earned: focusMinutes >= 600, progress: p(focusMinutes, 600) },
    'streak-30': { earned: streak.best >= 30, progress: p(streak.best, 30) },
    capstone: { earned: capstoneDone >= facts.capstoneMilestones, progress: p(capstoneDone, facts.capstoneMilestones) },
    'mock-80': { earned: mocks80 >= 1 },
    notebook: { earned: !!data.settings?.notebookReread },
    'two-mocks': { earned: mocks80 >= 2, progress: p(mocks80, 2) },
  };
  const badges = BADGES.map((b) => ({ ...b, ...state[b.id] }));

  return {
    xp, parts, level: levelFor(xp), badges, streak,
    stats: {
      lessonsDone, stepsUnderstood, labStepsDone: labTicks.size, labsDone, answers: answers.length, questionsRight: rightOnce.size,
      mocksFinished: exams.length, reviews, studyDays: studyDates.length, focusMinutes, explainNotes, capstoneDone,
      domcBestRun, formatsRight, perfectQuizzes: perfect,
    },
  };
}

/** Badges earned now that were not in `seen` (the celebration host shows these). */
export function newBadges(state: GameState, seen: string[]): BadgeState[] {
  const s = new Set(seen);
  return state.badges.filter((b) => b.earned && !s.has(b.id));
}
