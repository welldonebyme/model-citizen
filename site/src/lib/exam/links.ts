// Build time only (Astro frontmatter): "what to review" links per objective, for the results pages.
// Uses generated/coverage.json (objective -> lessons, labs) and generated/chapters/*.json (titles) when
// the converter has written them; otherwise links to the chapters that teach each objective (Part 0 table).
import { CHAPTER_TITLES, OBJECTIVES } from './objectives';
import { url } from '../url';
import type { ObjectiveLinks, ReviewLink } from './links-types';

const COVERAGE = import.meta.glob('../../generated/coverage.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const CHAPTERS = import.meta.glob('../../generated/chapters/*.json', { eager: true, import: 'default' }) as Record<string, {
  id: string; number: number; title: string; lessons?: { id: string; number: string; titleText: string; labs?: string[] }[];
}>;

const chapterIdOf = (id: string) => (id.match(/^(ch\d\d)/) ?? [])[1];
const chapterNumOf = (id: string) => Number((id.match(/^ch(\d\d)/) ?? [])[1]);

function lessonLink(lessonId: string): ReviewLink | null {
  const cid = chapterIdOf(lessonId);
  if (!cid) return null;
  const ch = Object.values(CHAPTERS).find((c) => c.id === cid);
  const lesson = ch?.lessons?.find((l) => l.id === lessonId);
  const n = lessonId.match(/-s(\d+)$/)?.[1];
  const number = lesson?.number ?? (n ? `${chapterNumOf(lessonId)}.${n}` : '');
  return { kind: 'lesson', href: url(`learn/${cid}/${lessonId}/`), text: lesson ? `Lesson ${number}: ${lesson.titleText}` : `Lesson ${number}` };
}

function labLink(labId: string): ReviewLink | null {
  const cid = chapterIdOf(labId);
  if (!cid) return null;
  const ch = Object.values(CHAPTERS).find((c) => c.id === cid);
  const lesson = ch?.lessons?.find((l) => l.labs?.includes(labId));
  const k = labId.match(/-lab(\d+)$/)?.[1];
  const text = `Lab ${chapterNumOf(labId)}.${k ?? ''}`;
  return { kind: 'lab', href: url(lesson ? `learn/${cid}/${lesson.id}/#${labId}` : `learn/${cid}/#${labId}`), text };
}

function chapterLink(n: number): ReviewLink {
  const id = `ch${String(n).padStart(2, '0')}`;
  const title = Object.values(CHAPTERS).find((c) => c.number === n)?.title ?? CHAPTER_TITLES[n] ?? '';
  return { kind: 'chapter', href: url(`learn/${id}/`), text: `Chapter ${n}${title ? `, ${title}` : ''}` };
}

/** Normalises the coverage file: whatever its exact shape, returns objective -> { lessons, labs }. */
function readCoverage(): Record<string, { lessons: string[]; labs: string[] }> {
  const raw = Object.values(COVERAGE)[0];
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, { lessons: string[]; labs: string[] }> = {};
  const take = (id: unknown, v: unknown) => {
    if (typeof id !== 'string' || !v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
    out[id] = { lessons: arr(o.lessons ?? o.lessonIds), labs: arr(o.labs ?? o.labIds) };
  };
  const inner = (raw as { objectives?: unknown }).objectives;
  const src = inner && typeof inner === 'object' ? inner : raw;   // { objectives: {...} } or the map itself
  if (Array.isArray(src)) for (const item of src) take((item as { id?: unknown; objective?: unknown }).id ?? (item as { objective?: unknown }).objective, item);
  else for (const [k, v] of Object.entries(src as Record<string, unknown>)) take(k, v);
  return out;
}

export function objectiveLinks(): ObjectiveLinks {
  const cov = readCoverage();
  const out: ObjectiveLinks = {};
  for (const o of OBJECTIVES) {
    const c = cov[o.id];
    const links: ReviewLink[] = [];
    if (c) {
      for (const l of c.lessons.slice(0, 3)) { const x = lessonLink(l); if (x) links.push(x); }
      for (const l of c.labs.slice(0, 2)) { const x = labLink(l); if (x) links.push(x); }
    }
    if (!links.length) for (const n of o.chapters.slice(0, 2)) links.push(chapterLink(n));
    out[o.id] = links;
  }
  return out;
}
