// What happens after an answer: it is recorded (answers table); a wrong answer creates or updates an
// error-notebook entry (notes, id "error:<question id>") and puts the question in the spaced-repetition
// queue (srs, kind "question"). A right answer on a card that is due moves the card up one box.
import type { Question } from '../content-types';
import type { Response } from '../scoring';
import { db, logActivity, type AnswerMode, type Note } from '../store/db';
import { isDue, newCard, review } from '../srs';
import { describeKey, describeResponse, sourceLabel } from './describe';

export const RULE_MARK = 'The rule in my own words:';

export function errorNoteId(qid: string) { return `error:${qid}`; }

export function errorNoteText(q: Question, r: Response | undefined, rule = ''): string {
  return [
    `Question: ${sourceLabel(q)} (${q.id})`,
    `What I answered: ${describeResponse(q, r)}`,
    `Correct answer: ${describeKey(q)}`,
    `${RULE_MARK} ${rule}`.trimEnd(),
  ].join('\n');
}

/** The learner's own words in an error note (the text after the rule marker). */
export function ruleOf(note: Note | undefined): string {
  if (!note) return '';
  const i = note.text.indexOf(RULE_MARK);
  return i < 0 ? '' : note.text.slice(i + RULE_MARK.length).trim();
}

interface Ctx { mode: AnswerMode; attemptId?: string; ms?: number; at?: number }

async function learn(q: Question, response: Response | undefined, correct: boolean, now: number) {
  const card = await db().srs.get(q.id);
  if (!correct) {
    const id = errorNoteId(q.id);
    const old = await db().notes.get(id);
    const text = errorNoteText(q, response, ruleOf(old));
    await db().notes.put({ id, kind: 'error', ref: q.id, text, createdAt: old?.createdAt ?? now, updatedAt: now });
    await db().srs.put(card ? review(card, false) : newCard(q.id, 'question'));
  } else if (card && isDue(card)) {
    await db().srs.put(review(card, true));
  }
}

/** One answer (chapter quiz, drill, mock practice). */
export async function recordOutcome(q: Question, response: Response | undefined, correct: boolean, ctx: Ctx): Promise<void> {
  const now = ctx.at ?? Date.now();
  await db().transaction('rw', [db().answers, db().notes, db().srs], async () => {
    await db().answers.add({ qid: q.id, mode: ctx.mode, attemptId: ctx.attemptId, response: response ?? null, correct, ms: ctx.ms, at: now });
    await learn(q, response, correct, now);
  });
  await logActivity(0);
}

/** Many answers at once (a submitted mock exam). */
export async function recordMany(items: { q: Question; response?: Response; correct: boolean; ms?: number }[], ctx: Omit<Ctx, 'ms'>): Promise<void> {
  const now = ctx.at ?? Date.now();
  await db().transaction('rw', [db().answers, db().notes, db().srs], async () => {
    await db().answers.bulkAdd(items.map((it, k) => ({ qid: it.q.id, mode: ctx.mode, attemptId: ctx.attemptId, response: it.response ?? null, correct: it.correct, ms: it.ms, at: now + k })));
    for (const it of items) await learn(it.q, it.response, it.correct, now);
  });
  await logActivity(0);
}

/** Saves the learner's rule ("in my own words") into the error note of a question. */
export async function saveRule(q: Question, response: Response | undefined, rule: string): Promise<void> {
  const id = errorNoteId(q.id);
  const old = await db().notes.get(id);
  const now = Date.now();
  await db().notes.put({ id, kind: 'error', ref: q.id, text: errorNoteText(q, response, rule.trim()), createdAt: old?.createdAt ?? now, updatedAt: now });
}

export async function getNote(qid: string): Promise<Note | undefined> {
  return db().notes.get(errorNoteId(qid));
}

/** Per question: was it ever answered, and was the latest answer wrong? */
export async function answerHistory(): Promise<{ seen: Set<string>; mistakes: Set<string>; last: Map<string, { correct: boolean; at: number }> }> {
  const all = await db().answers.toArray();
  const last = new Map<string, { correct: boolean; at: number }>();
  for (const a of all) {
    const prev = last.get(a.qid);
    if (!prev || a.at >= prev.at) last.set(a.qid, { correct: a.correct, at: a.at });
  }
  return {
    seen: new Set(last.keys()),
    mistakes: new Set([...last.entries()].filter(([, v]) => !v.correct).map(([k]) => k)),
    last,
  };
}
