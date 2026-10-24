// Lesson -> checkpoint question ids, for the test page only: from the generated chapters when the converter
// has filled lesson.checkpoints, else from converter/overrides/question-map.yaml (question -> lesson).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// paths from the site folder (the build and the tests run there; import.meta.url moves when Astro bundles)
const GEN = resolve(process.cwd(), 'src/generated/chapters') + '/';
const YAML = resolve(process.cwd(), '../converter/overrides/question-map.yaml');

/** Reads the `questions:` map of question-map.yaml (only the lesson of each question is needed). */
export function parseQuestionMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^ {2}(q-ch\d\d-\d\d):\s*\n {4}lesson:\s*(ch\d\d-s\d+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}

export function checkpointMap(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (existsSync(GEN)) {
    for (const f of readdirSync(GEN).filter((x) => x.endsWith('.json'))) {
      const ch = JSON.parse(readFileSync(GEN + f, 'utf8')) as { lessons?: { id: string; checkpoints?: string[] }[] };
      for (const l of ch.lessons ?? []) if (l.checkpoints?.length) out[l.id] = l.checkpoints;
    }
  }
  if (Object.keys(out).length === 0 && existsSync(YAML)) {
    for (const [qid, lesson] of Object.entries(parseQuestionMap(readFileSync(YAML, 'utf8')))) (out[lesson] ??= []).push(qid);
    for (const k of Object.keys(out)) out[k].sort();
  }
  return out;
}
