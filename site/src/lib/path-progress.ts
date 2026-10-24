// Fills progress into the course map and chapter lists from this browser's saved progress.
import { db } from './store/db';

type Resume = { lesson: string; chapter: string; path: string };

export async function loadDoneLessons(): Promise<Set<string>> {
  try {
    const rows = await db().progress.where('kind').equals('lesson').toArray();
    return new Set(rows.filter((r) => r.status === 'done').map((r) => r.ref));
  } catch {
    return new Set();
  }
}

export function resume(): Resume | null {
  try { return JSON.parse(localStorage.getItem('mc:resume') || 'null'); } catch { return null; }
}

async function run() {
  const done = await loadDoneLessons();
  const r = resume();
  // chapters: [data-chapter-progress] with data-lessons="id,id,..."
  document.querySelectorAll<HTMLElement>('[data-chapter-progress]').forEach((el) => {
    const ids = (el.dataset.lessons || '').split(',').filter(Boolean);
    const n = ids.filter((id) => done.has(id)).length;
    const pct = ids.length ? Math.round((n / ids.length) * 100) : 0;
    el.style.setProperty('--p', String(pct));
    el.dataset.state = pct === 100 ? 'done' : pct > 0 || (r && el.dataset.chapterProgress === r.chapter) ? 'now' : 'todo';
    const label = el.querySelector<HTMLElement>('[data-progress-label]');
    if (label && ids.length) label.textContent = pct === 100 ? 'Done' : n ? `${n} of ${ids.length} lessons` : '';
  });
  document.querySelectorAll<HTMLElement>('[data-lesson-row]').forEach((el) => {
    if (done.has(el.dataset.lessonRow!)) el.dataset.state = 'done';
    if (r && r.lesson === el.dataset.lessonRow) el.dataset.current = '';
  });
  // course map
  const partOf = new Map<number, { total: number; done: number }>();
  document.querySelectorAll<HTMLElement>('[data-part-lessons]').forEach((el) => {
    const part = Number(el.dataset.partLessons);
    const ids = (el.dataset.lessons || '').split(',').filter(Boolean);
    partOf.set(part, { total: ids.length, done: ids.filter((id) => done.has(id)).length });
  });
  let nowSet = false;
  document.querySelectorAll<SVGGElement>('[data-part-node]').forEach((g) => {
    const p = partOf.get(Number(g.dataset.partNode));
    if (!p || !p.total) return;
    const frac = p.done / p.total;
    const bar = g.querySelector<SVGRectElement>('.bar');
    if (bar) bar.setAttribute('width', String(Math.round(Number(bar.dataset.barW) * frac)));
    if (frac === 1) g.dataset.state = 'done';
    else if (!nowSet && (frac > 0 || p.done === 0)) { g.dataset.state = 'now'; nowSet = true; }
  });
}
run();
