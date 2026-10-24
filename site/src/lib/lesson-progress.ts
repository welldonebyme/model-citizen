// Lesson page enhancements: remembers seen and understood steps, ticked lab steps, and the reading position.
// The page is fully readable without this script.
import { db, markProgress, unmarkProgress } from './store/db';

const lessonEl = document.querySelector<HTMLElement>('[data-lesson]');
const lessonId = lessonEl?.dataset.lesson;
const chapterId = lessonEl?.dataset.chapter;

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e) { console.warn('Progress is not saved in this browser:', e); return undefined; }
}

function setDot(stepId: string, state: string) {
  const dot = document.querySelector<HTMLElement>(`[data-step-dot="${stepId}"]`);
  if (dot && dot.dataset.state !== 'understood') dot.dataset.state = state;
}

async function restore() {
  if (!lessonId) return;
  const rows = await safe(() => db().progress.where('kind').anyOf('step', 'labstep', 'lesson').toArray());
  if (!rows) return;
  for (const r of rows) {
    if (r.kind === 'step') {
      setDot(r.ref, r.status);
      if (r.status === 'understood') {
        const b = document.querySelector<HTMLButtonElement>(`[data-understood="${r.ref}"]`);
        if (b) { b.setAttribute('aria-pressed', 'true'); b.textContent = 'Understood'; }
        const dot = document.querySelector<HTMLElement>(`[data-step-dot="${r.ref}"]`);
        if (dot) dot.dataset.state = 'understood';
      }
    } else if (r.kind === 'labstep') {
      const box = document.querySelector<HTMLInputElement>(`[data-lab-step="${r.ref}"]`);
      if (box) box.checked = true;
    } else if (r.kind === 'lesson' && r.status === 'done') {
      document.querySelector<HTMLElement>(`[data-outline-lesson="${r.ref}"]`)?.setAttribute('data-state', 'done');
    }
  }
}

document.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-understood]');
  if (!b) return;
  const step = b.dataset.understood!;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Understood' : 'I understood this';
  const dot = document.querySelector<HTMLElement>(`[data-step-dot="${step}"]`);
  if (dot) dot.dataset.state = on ? 'understood' : 'seen';
  await safe(() => (on ? markProgress('step', step, 'understood', { lesson: lessonId }) : markProgress('step', step, 'seen', { lesson: lessonId })));
  if (on) {
    // When every step is understood, the lesson is done.
    const all = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-understood]'));
    if (all.every((x) => x.getAttribute('aria-pressed') === 'true') && lessonId) {
      await safe(() => markProgress('lesson', lessonId, 'done', { chapter: chapterId }));
      document.querySelector<HTMLElement>(`[data-outline-lesson="${lessonId}"]`)?.setAttribute('data-state', 'done');
    }
    const section = b.closest('[data-step]');
    const nextSection = section?.nextElementSibling as HTMLElement | null;
    if (nextSection?.matches('[data-step]')) nextSection.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
});

document.addEventListener('change', async (e) => {
  const box = e.target as HTMLInputElement;
  if (!box.matches?.('[data-lab-step]')) return;
  const ref = box.dataset.labStep!;
  await safe(() => (box.checked ? markProgress('labstep', ref, 'done', { lesson: lessonId }) : unmarkProgress('labstep', ref)));
});

// Seen steps and current position.
const seen = new Set<string>();
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const id = (en.target as HTMLElement).dataset.step!;
    if (en.isIntersecting) {
      document.querySelectorAll('[data-step-dot]').forEach((d) => d.removeAttribute('data-current'));
      document.querySelector(`[data-step-dot="${id}"]`)?.setAttribute('data-current', '');
      if (!seen.has(id)) {
        seen.add(id);
        setDot(id, 'seen');
        safe(() => markProgress('step', id, 'seen', { lesson: lessonId }));
      }
      if (lessonId) {
        try { localStorage.setItem('mc:resume', JSON.stringify({ lesson: lessonId, chapter: chapterId, step: id, path: location.pathname, at: Date.now() })); } catch { /* not saved */ }
      }
    }
  }
}, { rootMargin: '-35% 0px -55% 0px' });
document.querySelectorAll<HTMLElement>('[data-step]').forEach((s) => io.observe(s));

restore();
