// Build-time facts for the badges (served as delight/facts.json): how many ticks finish each lab (lab-steps.ts),
// which lab runs the first dbt project, which lab step is the first passing `dbt build`, the format of
// every question and the order of each chapter quiz. Pure over the book content, so it can be tested.
import type { Block, Chapter, Question } from './content-types';
import type { GameFacts } from './gamification';
import { labStepRefs } from './lab-steps';

interface LabInfo { id: string; chapter: string; ticks: number; steps: { n: number; blocks: Block[] }[] }

/** Labs in reading order, with their checkable steps (top-level ordered lists of a lab, like the lesson page). */
export function labsOf(chapters: Chapter[]): LabInfo[] {
  const out: LabInfo[] = [];
  const walk = (blocks: Block[], chapter: string) => {
    for (const b of blocks) {
      if (b.t === 'lab') {
        const steps: LabInfo['steps'] = [];
        for (const x of b.blocks) if (x.t === 'list' && x.kind === 'ol') x.items.forEach((it, i) => steps.push({ n: (x.start ?? 1) + i, blocks: it.blocks }));
        out.push({ id: b.id, chapter, ticks: labStepRefs(b).length, steps });
      } else if (b.t === 'callout') walk(b.blocks, chapter);
      else if (b.t === 'list') b.items.forEach((it) => walk(it.blocks, chapter));
    }
  };
  for (const c of chapters) {
    walk(c.intro, c.id);
    for (const l of c.lessons) for (const s of l.steps) walk(s.blocks, c.id);
  }
  return out;
}

/** Code in a step: code blocks, and inline code in its paragraphs ("run `dbt run`"). */
function codes(blocks: Block[]): { lang: string; text: string }[] {
  const out: { lang: string; text: string }[] = [];
  const inline = (c: unknown[]) => {
    for (const n of c) {
      if (!n || typeof n !== 'object') continue;
      const node = n as { t?: string; v?: string; c?: unknown[] };
      if (node.t === 'code' && typeof node.v === 'string') out.push({ lang: 'inline', text: node.v });
      else if (Array.isArray(node.c)) inline(node.c);
    }
  };
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === 'code') out.push({ lang: b.lang, text: b.text });
      else if (b.t === 'p') inline(b.c);
      else if (b.t === 'callout' || b.t === 'lab') walk(b.blocks);
      else if (b.t === 'list') b.items.forEach((it) => walk(it.blocks));
    }
  };
  walk(blocks);
  return out;
}

const runsDbt = (c: { lang: string; text: string }) =>
  (c.lang === 'bash' && /(^|\s|\$ )dbt (run|build)\b/m.test(c.text)) || (c.lang === 'inline' && /^dbt (run|build)\b/.test(c.text.trim()));
const greenBuild = (cs: { lang: string; text: string }[]) =>
  cs.some((c) => c.lang === 'bash' && /(^|\$ )dbt build\b/m.test(c.text)) && cs.some((c) => c.lang === 'output' && /Completed successfully/.test(c.text) && /ERROR=0/.test(c.text));

export function buildFacts(chapters: Chapter[], questions: Question[], capstoneMilestones = 15): GameFacts {
  const labs = labsOf(chapters);
  const withSteps = labs.filter((l) => l.steps.length > 0);
  const firstModel = withSteps.find((l) => l.chapter === 'ch06' && l.steps.some((s) => codes(s.blocks).some(runsDbt)));
  let greenBuildStep: string | undefined;
  for (const l of withSteps) {
    const s = l.steps.find((st) => greenBuild(codes(st.blocks)));
    if (s) { greenBuildStep = `${l.id}:${s.n}`; break; }
  }
  const quizzes: Record<string, string[]> = {};
  for (const q of questions) {
    if (q.source.kind !== 'chapter') continue;
    const ch = `ch${String(q.source.chapter).padStart(2, '0')}`;
    (quizzes[ch] ??= []).push(q.id);
  }
  const order = new Map(questions.map((q) => [q.id, q.source.n]));
  for (const ids of Object.values(quizzes)) ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return {
    v: 1,
    labSteps: Object.fromEntries(labs.map((l) => [l.id, l.ticks])),
    firstModelLab: firstModel?.id,
    greenBuildStep,
    formats: Object.fromEntries(questions.map((q) => [q.id, q.format])),
    quizzes,
    capstoneMilestones,
  };
}
