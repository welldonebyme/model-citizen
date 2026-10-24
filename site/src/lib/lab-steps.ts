// What a learner ticks to finish a lab. Shared by the renderer (checkboxes), the build-time course facts
// (how many ticks finish each lab) and the progress summary (which lab a tick belongs to).
//   - numbered steps (an ordered list directly in the lab): one tick per step, ref "<lab>:<n>"
//   - capstone milestones (ch26): one tick per requirement of the checklist, ref "<lab>:r<n>"
//   - any other lab: a single "I did this lab" tick at the end, ref "<lab>:done"
import type { Block } from './content-types';

type LabBlock = Extract<Block, { t: 'lab' }>;

export const isCapstoneLab = (id: string) => /^ch26-lab\d+$/.test(id);

/** ch26-lab3 → "m02" (the capstone milestone the lab builds). */
export const milestoneOf = (labId: string) => `m${String(Number(labId.replace('ch26-lab', '')) - 1).padStart(2, '0')}`;

export function labStepRefs(lab: LabBlock): string[] {
  const lists = lab.blocks.filter((b): b is Extract<Block, { t: 'list' }> => b.t === 'list');
  if (isCapstoneLab(lab.id)) {
    const req = lists.find((l) => l.kind === 'ul');
    if (req) return req.items.map((_, i) => `${lab.id}:r${i + 1}`);
  }
  const nums = new Set<number>();
  for (const l of lists) if (l.kind === 'ol') l.items.forEach((_, i) => nums.add((l.start ?? 1) + i));
  if (nums.size) return [...nums].sort((a, b) => a - b).map((n) => `${lab.id}:${n}`);
  return [`${lab.id}:done`];
}

/** "ch07-lab2:3" → "ch07-lab2" */
export const labOfStep = (ref: string) => ref.replace(/:(r?\d+|done)$/, '');
