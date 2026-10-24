// Focus timer (Pomodoro): 25 minutes of focus, then a 5-minute break, by default. Pure state changes
// here; the launcher island runs them, saves the state in localStorage (so it survives navigation and
// reloads) and logs the focus minutes to the activity table (streaks, "minutes studied today").
// The state uses wall-clock times, so a closed page does not stop the clock.
import { today } from './store/db';

export type Phase = 'idle' | 'focus' | 'break';

export interface Task { title: string; href?: string }

export interface PomoState {
  v: 1;
  phase: Phase;
  /** id of the current period (focus minutes are logged once per id) */
  id: string;
  durationMs: number;
  /** time already run before the current run (pauses) */
  accMs: number;
  /** wall-clock start of the current run; null while paused */
  runStart: number | null;
  focusMin: number;
  breakMin: number;
  task?: Task;
  sound: boolean;
  notify: boolean;
  /** focus periods finished on that day (shown in the panel) */
  done: { date: string; count: number };
}

export const FOCUS_CHOICES = [15, 25, 30, 45, 50];
export const BREAK_CHOICES = [5, 10, 15];

export const DEFAULT_POMO: PomoState = {
  v: 1, phase: 'idle', id: '', durationMs: 25 * 60_000, accMs: 0, runStart: null,
  focusMin: 25, breakMin: 5, sound: false, notify: false, done: { date: '', count: 0 },
};

export type PomoEvent =
  | { type: 'focus-done'; id: string; minutes: number; at: number }
  | { type: 'break-done'; id: string; at: number };

export function elapsed(s: PomoState, now: number): number {
  return s.accMs + (s.runStart !== null ? Math.max(0, now - s.runStart) : 0);
}

export function remaining(s: PomoState, now: number): number {
  if (s.phase === 'idle') return s.focusMin * 60_000;
  return Math.max(0, s.durationMs - elapsed(s, now));
}

export const isRunning = (s: PomoState) => s.phase !== 'idle' && s.runStart !== null;

export function startFocus(s: PomoState, now: number, task?: Task): PomoState {
  return { ...s, phase: 'focus', id: `f${now.toString(36)}`, durationMs: s.focusMin * 60_000, accMs: 0, runStart: now, task: task ?? s.task };
}

export function startBreak(s: PomoState, now: number): PomoState {
  return { ...s, phase: 'break', id: `b${now.toString(36)}`, durationMs: s.breakMin * 60_000, accMs: 0, runStart: now };
}

export function pause(s: PomoState, now: number): PomoState {
  if (s.phase === 'idle' || s.runStart === null) return s;
  return { ...s, accMs: elapsed(s, now), runStart: null };
}

export function resume(s: PomoState, now: number): PomoState {
  if (s.phase === 'idle' || s.runStart !== null) return s;
  return { ...s, runStart: now };
}

/** Stops the period. A stopped focus period still counts its whole minutes. */
export function stop(s: PomoState, now: number): { state: PomoState; minutes: number; id: string } {
  const minutes = s.phase === 'focus' ? Math.floor(Math.min(elapsed(s, now), s.durationMs) / 60_000) : 0;
  return { state: { ...s, phase: 'idle', id: '', accMs: 0, runStart: null, durationMs: s.focusMin * 60_000 }, minutes, id: s.id };
}

function countDone(s: PomoState, at: number): PomoState['done'] {
  const d = today(new Date(at));
  return { date: d, count: (s.done.date === d ? s.done.count : 0) + 1 };
}

/**
 * Moves the clock to `now`: a finished focus period starts the break (at the exact time the focus
 * ended), a finished break goes back to idle. Several steps can happen when the page was closed.
 */
export function advance(s: PomoState, now: number): { state: PomoState; events: PomoEvent[] } {
  const events: PomoEvent[] = [];
  let st = s;
  for (let guard = 0; guard < 4 && st.phase !== 'idle' && st.runStart !== null; guard++) {
    const endAt = st.runStart + st.durationMs - st.accMs;
    if (now < endAt) break;
    if (st.phase === 'focus') {
      events.push({ type: 'focus-done', id: st.id, minutes: Math.round(st.durationMs / 60_000), at: endAt });
      st = { ...startBreak(st, endAt), done: countDone(st, endAt) };
    } else {
      events.push({ type: 'break-done', id: st.id, at: endAt });
      st = { ...st, phase: 'idle', id: '', accMs: 0, runStart: null, durationMs: st.focusMin * 60_000 };
    }
  }
  return { state: st, events };
}

export function setDurations(s: PomoState, focusMin: number, breakMin: number): PomoState {
  const f = FOCUS_CHOICES.includes(focusMin) ? focusMin : DEFAULT_POMO.focusMin;
  const b = BREAK_CHOICES.includes(breakMin) ? breakMin : DEFAULT_POMO.breakMin;
  return { ...s, focusMin: f, breakMin: b, durationMs: s.phase === 'idle' ? f * 60_000 : s.durationMs };
}

/** "24:59" */
export function clockText(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** A state read from storage, checked field by field (old or damaged values fall back to defaults). */
export function sanitize(raw: unknown): PomoState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_POMO };
  const r = raw as Partial<PomoState>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const phase: Phase = r.phase === 'focus' || r.phase === 'break' ? r.phase : 'idle';
  const s = setDurations({ ...DEFAULT_POMO }, num(r.focusMin, 25), num(r.breakMin, 5));
  const task = r.task && typeof r.task.title === 'string' ? { title: r.task.title.slice(0, 200), href: typeof r.task.href === 'string' ? r.task.href : undefined } : undefined;
  return {
    ...s,
    phase,
    id: typeof r.id === 'string' ? r.id : '',
    durationMs: phase === 'idle' ? s.focusMin * 60_000 : num(r.durationMs, s.focusMin * 60_000),
    accMs: phase === 'idle' ? 0 : num(r.accMs, 0),
    runStart: phase === 'idle' || r.runStart === null ? null : num(r.runStart, 0) || null,
    task,
    sound: r.sound === true,
    notify: r.notify === true,
    done: r.done && typeof r.done.date === 'string' && typeof r.done.count === 'number' ? r.done : { date: '', count: 0 },
  };
}

// ---- storage (per-browser conveniences) ----

export const POMO_KEY = 'mc:pomodoro';
export const LOGGED_KEY = 'mc:pomodoro-logged';
export const MISSION_KEY = 'mc:mission';

export function loadPomo(): PomoState {
  try { return sanitize(JSON.parse(localStorage.getItem(POMO_KEY) || 'null')); } catch { return { ...DEFAULT_POMO }; }
}
export function savePomo(s: PomoState) {
  try { localStorage.setItem(POMO_KEY, JSON.stringify(s)); } catch { /* storage blocked: the timer works on this page only */ }
}

/** Remembers that a period's minutes were logged; false when another tab already did it. */
export function claimLog(id: string): boolean {
  if (!id) return false;
  try {
    const list = JSON.parse(localStorage.getItem(LOGGED_KEY) || '[]') as string[];
    if (list.includes(id)) return false;
    localStorage.setItem(LOGGED_KEY, JSON.stringify([...list, id].slice(-30)));
    return true;
  } catch {
    return true;
  }
}

/** One item of today's mission, as the Today page shows it. */
export interface MissionHint { title: string; minutes?: number; href?: string; kind?: string }

/**
 * Today page: call this with today's mission so the focus timer can offer its items.
 * Example (TodayApp): useEffect(() => rememberMission(m.items.map((it) => ({ title: it.title, minutes: it.minutes, kind: it.kind, href }))), [...]).
 */
export function rememberMission(items: MissionHint[], date = today()) {
  try { localStorage.setItem(MISSION_KEY, JSON.stringify({ date, items: items.slice(0, 12) })); } catch { /* not saved */ }
}

export function readMission(date = today()): MissionHint[] {
  try {
    const m = JSON.parse(localStorage.getItem(MISSION_KEY) || 'null') as { date?: string; items?: MissionHint[] } | null;
    if (!m || m.date !== date || !Array.isArray(m.items)) return [];
    return m.items.filter((i) => i && typeof i.title === 'string').map((i) => ({ title: i.title, minutes: typeof i.minutes === 'number' ? i.minutes : undefined, href: typeof i.href === 'string' ? i.href : undefined, kind: typeof i.kind === 'string' ? i.kind : undefined }));
  } catch {
    return [];
  }
}
