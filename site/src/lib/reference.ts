// Build-time access to the reference datasets written by the converter (glossary, traps, objectives,
// coverage, cheat sheets). Every loader returns an empty value until the converter has produced the file.
import type { Block, Chapter, Inline } from './content-types';

const one = <T>(glob: Record<string, unknown>): T | undefined => Object.values(glob)[0] as T | undefined;

export interface Term { id: string; en: string; fr: string; chapter: number; occurrences?: { lesson: string; anchor?: string }[] }
export interface Trap { id: string; n: number; topic?: string; confusion: Inline[]; truth: Inline[]; where?: Inline[]; chapters?: number[] }
export interface Objective { id: string; topic?: number | string; title: string; chapters?: number[]; labs?: string[]; mockQuestions?: string[] }
export interface CoverageRow { objective: string; lessons: string[]; labs: string[]; questions: string[] }

const glossRaw = one<Term[] | { terms: Term[] }>(import.meta.glob('../generated/glossary.json', { eager: true, import: 'default' }));
export const glossary: Term[] = Array.isArray(glossRaw) ? glossRaw : glossRaw?.terms ?? [];

const trapsRaw = one<Trap[] | { traps: Trap[] }>(import.meta.glob('../generated/traps.json', { eager: true, import: 'default' }));
export const traps: Trap[] = Array.isArray(trapsRaw) ? trapsRaw : trapsRaw?.traps ?? [];

const objRaw = one<Objective[] | { objectives: Objective[] }>(import.meta.glob('../generated/objectives.json', { eager: true, import: 'default' }));
export const objectives: Objective[] = Array.isArray(objRaw) ? objRaw : objRaw?.objectives ?? [];

type CovRaw = CoverageRow[] | Record<string, { lessons?: string[]; labs?: string[]; questions?: string[]; mockQuestions?: string[]; chapterQuestions?: string[] }>;
const covRaw = one<CovRaw>(import.meta.glob('../generated/coverage.json', { eager: true, import: 'default' }));
export const coverage: CoverageRow[] = !covRaw ? [] : Array.isArray(covRaw) ? covRaw
  : Object.entries(covRaw).map(([objective, v]) => ({
      objective, lessons: v.lessons ?? [], labs: v.labs ?? [],
      questions: [...(v.questions ?? []), ...(v.chapterQuestions ?? []), ...(v.mockQuestions ?? [])],
    }));

const cheatRaw = one<Chapter | { blocks: Block[] }>(import.meta.glob('../generated/cheatsheets.json', { eager: true, import: 'default' }));
export const cheatsheets: Chapter | undefined = cheatRaw && 'lessons' in cheatRaw ? (cheatRaw as Chapter) : undefined;

export const TOPICS: Record<string, string> = {
  CP0: 'Prerequisites',
  '1': 'Developing and optimizing dbt models',
  '2': 'Managing dbt model governance',
  '3': 'Debugging data modeling errors',
  '4': 'Troubleshooting and optimizing dbt pipelines',
  '5': 'Implementing dbt tests',
  '6': 'Implementing and maintaining external dependencies',
  '7': 'Leveraging dbt state',
};
export const topicOf = (objectiveId: string) => (objectiveId.startsWith('CP0') ? 'CP0' : objectiveId.split('.')[0]);
