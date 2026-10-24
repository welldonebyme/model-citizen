// Focus timer (Pomodoro), as a small launcher in the corner of every page. 25 minutes of focus, then a
// 5-minute break (Settings in the panel). The state lives in localStorage, so it keeps running when you
// change page or close the tab. Each focus period adds its minutes to today's study time (activity
// table): the Today page's "minutes studied today" and the streak use it. Sound is off by default;
// browser notifications are used only if the learner turns them on.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { db, logActivity, today } from '../../lib/store/db';
import {
  BREAK_CHOICES, DEFAULT_POMO, FOCUS_CHOICES, POMO_KEY, advance, claimLog, clockText, isRunning, loadPomo, pause,
  readMission, remaining, resume, savePomo, setDurations, startFocus, stop, type MissionHint, type PomoEvent, type PomoState, type Task,
} from '../../lib/pomodoro';
import { url } from '../../lib/url';
import { useLive } from './data';
import './delight.css';

type Choice = { key: string; title: string; href?: string; note?: string };

function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime + 0.02;
    for (const [f, dt] of [[659.25, 0], [987.77, 0.22]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + dt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 1.4);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 1.5);
    }
    setTimeout(() => ctx.close().catch(() => undefined), 2200);
  } catch { /* no sound on this device */ }
}

async function withLock(fn: () => Promise<void>) {
  const locks = (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<void>) => Promise<void> } }).locks;
  if (locks?.request) return locks.request('mc-pomodoro', fn);
  return fn();
}

/** Adds focus minutes to the day the period ended, once per period even with several tabs open. */
async function logFocus(id: string, minutes: number, at: number): Promise<boolean> {
  if (minutes <= 0) return false;
  let logged = false;
  await withLock(async () => {
    if (!claimLog(id)) return;
    try { await logActivity(minutes, today(new Date(at))); logged = true; } catch { /* storage blocked */ }
  });
  return logged;
}

function notify(title: string, body: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
    new Notification(title, { body, tag: 'mc-focus-timer' });
  } catch { /* some browsers allow notifications only from a service worker */ }
}

export default function PomodoroLauncher() {
  const [s, setS] = useState<PomoState>(DEFAULT_POMO);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [choice, setChoice] = useState('');
  const [custom, setCustom] = useState('');
  const [notice, setNotice] = useState('');
  const uid = useId().replace(/:/g, '');
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const stateRef = useRef(s);
  stateRef.current = s;

  const minutesToday = useLive(() => db().activity.get(today()).then((a) => a?.minutes ?? 0), []).value ?? 0;

  const commit = useCallback((next: PomoState) => { setS(next); savePomo(next); }, []);

  const handle = useCallback((events: PomoEvent[], st: PomoState) => {
    const t = Date.now();
    for (const e of events) {
      const fresh = t - e.at < 90_000; // a period that ended long ago (page closed) is logged, not rung
      if (e.type === 'focus-done') {
        logFocus(e.id, e.minutes, e.at);
        const msg = `Focus period done: ${e.minutes} minutes added to today. Take a ${st.breakMin}-minute break.`;
        setAnnounce(msg);
        if (fresh && st.sound) playChime();
        if (fresh && st.notify) notify('Focus period done', `${e.minutes} minutes added to today. Take a ${st.breakMin}-minute break.`);
      } else {
        setAnnounce('The break is over. Start a new focus period when you are ready.');
        if (fresh && st.sound) playChime();
        if (fresh && st.notify) notify('The break is over', 'Start a new focus period when you are ready.');
      }
    }
  }, []);

  // Load the saved state, catch up with the time that passed, follow other tabs.
  useEffect(() => {
    const st = loadPomo();
    const r = advance(st, Date.now());
    if (r.events.length) { savePomo(r.state); handle(r.events, r.state); }
    setS(r.state);
    setLoaded(true);
    const onStorage = (e: StorageEvent) => { if (e.key === POMO_KEY) setS(loadPomo()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [handle]);

  // Tick every second while a period runs (or the panel is open).
  const running = isRunning(s);
  useEffect(() => {
    if (!running && !open) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const r = advance(stateRef.current, t);
      if (r.events.length) { commit(r.state); handle(r.events, r.state); }
    }, 1000);
    return () => clearInterval(id);
  }, [running, open, commit, handle]);

  // What can I work on: today's mission (from the Today page), this page, or something else.
  useEffect(() => {
    if (!open) return;
    const mission: MissionHint[] = readMission();
    const pageTitle = document.title.replace(/\s*\|\s*Model Citizen$/, '');
    const list: Choice[] = [
      ...mission.map((m, i) => ({ key: `m${i}`, title: m.title, href: m.href, note: m.minutes ? `${m.minutes} min` : undefined })),
      { key: 'page', title: `This page: ${pageTitle}`, href: location.pathname + location.hash },
      { key: 'other', title: 'Something else' },
    ];
    setChoices(list);
    setChoice((c) => (list.some((x) => x.key === c) ? c : list[0].key));
    requestAnimationFrame(() => headRef.current?.focus());
  }, [open]);

  // Close with Escape or a click outside; the focus goes back to the launcher.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const inside = panelRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inside || document.activeElement === document.body) btnRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const close = () => { setOpen(false); btnRef.current?.focus(); };

  const left = remaining(s, now);
  const total = s.phase === 'idle' ? s.focusMin * 60_000 : s.durationMs;
  const frac = s.phase === 'idle' ? 0 : 1 - left / total;
  const paused = s.phase !== 'idle' && s.runStart === null;
  const doneToday = s.done.date === today() ? s.done.count : 0;

  const start = () => {
    const c = choices.find((x) => x.key === choice);
    const task: Task | undefined = c?.key === 'other' ? (custom.trim() ? { title: custom.trim().slice(0, 120) } : undefined) : c ? { title: c.title, href: c.href } : undefined;
    const t = Date.now();
    commit(startFocus(stateRef.current, t, task));
    setNow(t);
    setAnnounce(`Focus period started: ${stateRef.current.focusMin} minutes.`);
    requestAnimationFrame(() => headRef.current?.focus());
  };
  const doStop = () => {
    const t = Date.now();
    const r = stop(stateRef.current, t);
    commit(r.state);
    if (r.minutes > 0) { logFocus(r.id, r.minutes, t); setAnnounce(`Stopped. ${r.minutes} ${r.minutes === 1 ? 'minute' : 'minutes'} added to today.`); }
    else setAnnounce('Stopped.');
    requestAnimationFrame(() => headRef.current?.focus());
  };
  const toggleNotify = async (on: boolean) => {
    setNotice('');
    if (!on) { commit({ ...stateRef.current, notify: false }); return; }
    if (typeof Notification === 'undefined') { setNotice('This browser cannot show notifications.'); return; }
    let p = Notification.permission;
    if (p === 'default') { try { p = await Notification.requestPermission(); } catch { p = 'denied'; } }
    if (p === 'granted') commit({ ...stateRef.current, notify: true });
    else setNotice('Your browser blocks notifications for this site. You can allow them in the site settings of the browser.');
  };

  const phaseName = s.phase === 'focus' ? (paused ? 'Focus, paused' : 'Focus') : s.phase === 'break' ? (paused ? 'Break, paused' : 'Break') : 'Ready';
  const minsLeft = Math.ceil(left / 60_000);
  const btnLabel = s.phase === 'idle' ? 'Focus timer' : `Focus timer: ${phaseName.toLowerCase()}, ${minsLeft} ${minsLeft === 1 ? 'minute' : 'minutes'} left`;
  const R = 15, C = 2 * Math.PI * R;

  return (
    <div className="dl-pomo no-print" data-phase={s.phase} data-loaded={loaded || undefined}>
      <button ref={btnRef} type="button" className="dl-pomo-btn" aria-expanded={open} aria-controls={`${uid}-panel`} aria-label={btnLabel} onClick={() => setOpen((o) => !o)} data-paused={paused || undefined}>
        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
          <circle className="dl-pomo-track" cx="18" cy="18" r={R} />
          {s.phase !== 'idle' && <circle className="dl-pomo-arc" cx="18" cy="18" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 18 18)" />}
          {s.phase === 'idle'
            ? <path d="M18 11.5V18l4 2.6M15.5 6.5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            : paused ? <path d="M15 13v10M21 13v10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /> : <circle cx="18" cy="18" r="3.2" fill="currentColor" />}
        </svg>
        {s.phase !== 'idle' && <span className="dl-pomo-time" aria-hidden="true">{clockText(left)}</span>}
      </button>

      <div ref={panelRef} id={`${uid}-panel`} className="dl-pomo-panel" role="dialog" aria-modal="false" aria-labelledby={`${uid}-h`} hidden={!open}
>
        <div className="dl-pomo-head">
          <h2 id={`${uid}-h`} ref={headRef} tabIndex={-1}>Focus timer</h2>
          <button type="button" className="dl-icon-btn" onClick={close} aria-label="Close the focus timer">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>

        <p className="dl-pomo-phase">{phaseName}</p>
        <p className="dl-pomo-clock" role="timer" aria-label={`${phaseName}, ${clockText(left)} left`}>{clockText(left)}</p>
        <div className="dl-bar dl-pomo-bar" aria-hidden="true"><span style={{ width: `${Math.round(frac * 100)}%` }} /></div>

        {s.phase === 'idle' ? (
          <div className="dl-pomo-task">
            <label htmlFor={`${uid}-task`}>What will you work on?</label>
            <select id={`${uid}-task`} value={choice} onChange={(e) => setChoice(e.target.value)}>
              {choices.filter((c) => c.key.startsWith('m')).length > 0 && (
                <optgroup label="Today's mission">
                  {choices.filter((c) => c.key.startsWith('m')).map((c) => <option key={c.key} value={c.key}>{c.title}{c.note ? ` (${c.note})` : ''}</option>)}
                </optgroup>
              )}
              {choices.filter((c) => !c.key.startsWith('m')).map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
            </select>
            {choice === 'other' && (
              <>
                <label htmlFor={`${uid}-custom`} className="visually-hidden">Describe what you will work on</label>
                <input id={`${uid}-custom`} type="text" value={custom} maxLength={120} onChange={(e) => setCustom(e.target.value)} placeholder="For example: re-read my error notebook" />
              </>
            )}
            {!choices.some((c) => c.key.startsWith('m')) && <p className="dl-small dl-muted">Open the <a href={url('')}>Today page</a> once to see your mission here.</p>}
          </div>
        ) : s.task ? (
          <p className="dl-pomo-working">Working on: {s.task.href ? <a href={s.task.href}>{s.task.title}</a> : <b>{s.task.title}</b>}</p>
        ) : null}

        <div className="dl-pomo-actions">
          {s.phase === 'idle' && <button type="button" className="btn btn-primary btn-small" onClick={start}>Start {s.focusMin} minutes of focus</button>}
          {s.phase !== 'idle' && !paused && <button type="button" className="btn btn-quiet btn-small" onClick={() => { commit(pause(stateRef.current, Date.now())); requestAnimationFrame(() => headRef.current?.focus()); }}>Pause</button>}
          {paused && <button type="button" className="btn btn-primary btn-small" onClick={() => { const t = Date.now(); commit(resume(stateRef.current, t)); setNow(t); requestAnimationFrame(() => headRef.current?.focus()); }}>Resume</button>}
          {s.phase === 'focus' && <button type="button" className="btn btn-quiet btn-small" onClick={doStop}>Stop</button>}
          {s.phase === 'break' && <button type="button" className="btn btn-quiet btn-small" onClick={doStop}>Skip the break</button>}
        </div>

        <p className="dl-pomo-today">
          <b>{minutesToday}</b> {minutesToday === 1 ? 'minute' : 'minutes'} studied today{doneToday > 0 ? `, ${doneToday} focus ${doneToday === 1 ? 'period' : 'periods'} in this browser` : ''}.
        </p>

        <details className="dl-more">
          <summary>Timer settings</summary>
          <div className="dl-pomo-settings">
            <label>Focus
              <select value={s.focusMin} disabled={s.phase === 'focus'} onChange={(e) => commit(setDurations(stateRef.current, Number(e.target.value), stateRef.current.breakMin))}>
                {FOCUS_CHOICES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </label>
            <label>Break
              <select value={s.breakMin} disabled={s.phase === 'break'} onChange={(e) => commit(setDurations(stateRef.current, stateRef.current.focusMin, Number(e.target.value)))}>
                {BREAK_CHOICES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </label>
            <label className="dl-check"><input type="checkbox" checked={s.sound} onChange={(e) => { commit({ ...stateRef.current, sound: e.target.checked }); if (e.target.checked) playChime(); }} /> Play a soft sound at the end of a period</label>
            <label className="dl-check"><input type="checkbox" checked={s.notify} onChange={(e) => toggleNotify(e.target.checked)} /> Show a notification when a period ends and this page is in the background</label>
            {notice && <p className="dl-small dl-warn" role="alert">{notice}</p>}
            <p className="dl-small dl-muted">Each focus period adds its minutes to your study time for today and keeps your streak. A stopped period counts its whole minutes.</p>
          </div>
        </details>
      </div>
      <p className="visually-hidden" aria-live="polite">{announce}</p>
    </div>
  );
}
