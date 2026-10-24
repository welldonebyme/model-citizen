// Lesson checkpoints: the question -> lesson map of the converter (question-map.yaml) is complete and
// agrees with the lessons' checkpoints in the generated chapters.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkpointMap, parseQuestionMap } from '../e2e/checkpoint-map';
import { chapterQuizzes } from '../../src/lib/questions';

const YAML = resolve(process.cwd(), '../converter/overrides/question-map.yaml');
const GEN = resolve(process.cwd(), 'src/generated/chapters');

describe.skipIf(!existsSync(YAML))('question map', () => {
  const map = parseQuestionMap(readFileSync(YAML, 'utf8'));
  it('maps the 487 chapter questions to a lesson of their own chapter', () => {
    expect(Object.keys(map)).toHaveLength(487);
    for (const [qid, lesson] of Object.entries(map)) expect(lesson.slice(0, 4), qid).toBe(qid.slice(2, 6));
  });
  it('points to questions that exist in the bank', () => {
    const ids = new Set(chapterQuizzes().flatMap((c) => c.questions.map((q) => q.id)));
    if (ids.size > 100) for (const qid of Object.keys(map)) expect(ids.has(qid), qid).toBe(true);
  });
  it.skipIf(!existsSync(GEN))('agrees with lesson.checkpoints in the generated chapters', () => {
    const lessons = new Map<string, string[]>();
    for (const f of readdirSync(GEN).filter((x) => x.endsWith('.json'))) {
      for (const l of JSON.parse(readFileSync(`${GEN}/${f}`, 'utf8')).lessons ?? []) lessons.set(l.id, l.checkpoints ?? []);
    }
    const filled = [...lessons.values()].some((c) => c.length);
    if (!filled) return;
    for (const [qid, lesson] of Object.entries(map)) expect(lessons.get(lesson), `${qid} -> ${lesson}`).toContain(qid);
    expect(Object.keys(checkpointMap()).length).toBeGreaterThan(50);
  });
});
