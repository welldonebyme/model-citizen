// One per page: watches the learner's progress and shows a small, calm celebration when a badge is
// earned or a new level is reached (a node of the graph lights up; no animation with reduced motion).
// Also shows any celebration sent with the 'mc:celebrate' event (see celebrate.ts).
// The badges already celebrated are remembered in localStorage (a per-browser convenience); the first
// time, every badge already earned is recorded silently, so an imported progress file is not a flood.
import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../../lib/store/db';
import { computeGame, type Glyph } from '../../lib/gamification';
import { url } from '../../lib/url';
import { loadFacts, prefersReducedMotion, readGameData } from './data';
import { GlyphSvg } from './Glyphs';
import { CELEBRATE_EVENT, type CelebrateDetail } from './celebrate';
import './delight.css';

const SEEN_KEY = 'mc:delight-seen';
interface Seen { v: 1; badges: string[]; level: number }

function readSeen(): Seen | null {
  try {
    const s = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null') as Seen | null;
    return s && s.v === 1 && Array.isArray(s.badges) && typeof s.level === 'number' ? s : null;
  } catch { return null; }
}
function writeSeen(s: Seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* not remembered: celebrations may repeat */ }
}

interface Toast { id: string; kicker: string; title: string; text?: string; glyph?: Glyph; label?: string; href?: string; linkText?: string }

/** A cheap fingerprint of the progress tables: when it changes, the badges are checked again. */
async function signature(): Promise<string> {
  const d = db();
  return d.transaction('r', [d.progress, d.answers, d.examAttempts, d.srs, d.notes, d.activity, d.settings], async () => {
    const act = await d.activity.toArray();
    return [
      await d.progress.count(), (await d.progress.orderBy('updatedAt').last())?.updatedAt ?? 0,
      await d.answers.count(),
      await d.examAttempts.where('status').equals('finished').count(),
      await d.srs.count(), await d.srs.where('box').equals(5).count(),
      (await d.notes.orderBy('updatedAt').last())?.updatedAt ?? 0,
      act.length, act.reduce((n, a) => n + a.minutes + a.events, 0),
      (await d.settings.get('settings'))?.notebookReread ?? '',
    ].join('|');
  });
}

export interface CelebrationHostProps {
  /** where "See your badges" goes (the page with the XP and badges panel) */
  badgesHref?: string;
}

export default function CelebrationHost({ badgesHref = url('') + '#badges' }: CelebrationHostProps) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const [reduced, setReduced] = useState(false);
  const busy = useRef(false);
  const again = useRef(false);

  const push = useCallback((t: Toast | Toast[]) => setQueue((q) => [...q, ...(Array.isArray(t) ? t : [t])].slice(-6)), []);

  const evaluate = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return; // the tab you look at celebrates
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      const [facts, data] = await Promise.all([loadFacts(), readGameData()]);
      const game = computeGame(data, facts);
      const earned = game.badges.filter((b) => b.earned);
      const seen = readSeen();
      if (!seen) { writeSeen({ v: 1, badges: earned.map((b) => b.id), level: game.level.n }); return; }
      const fresh = earned.filter((b) => !seen.badges.includes(b.id));
      const levelUp = game.level.n > seen.level;
      writeSeen({ v: 1, badges: [...new Set([...seen.badges, ...earned.map((b) => b.id)])], level: game.level.n });
      const out: Toast[] = [];
      if (fresh.length >= 3) {
        out.push({ id: `b-${fresh.map((b) => b.id).join('-')}`, kicker: 'New badges', title: `${fresh.length} new badges`, text: fresh.map((b) => b.title).join(', ') + '.', glyph: fresh[0].glyph, href: badgesHref, linkText: 'See your badges' });
      } else {
        for (const b of fresh) out.push({ id: `b-${b.id}`, kicker: 'Badge earned', title: b.title, text: b.text, glyph: b.glyph, href: badgesHref, linkText: 'See your badges' });
      }
      if (levelUp) out.push({ id: `l-${game.level.n}`, kicker: 'New level', title: `Level ${game.level.n}: ${game.level.name}`, text: game.level.line, label: String(game.level.n), href: badgesHref, linkText: 'See your level' });
      if (out.length) push(out);
    } catch {
      /* no facts (offline) or no storage: no celebration, nothing breaks */
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; setTimeout(evaluate, 300); }
    }
  }, [badgesHref, push]);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    let sub: { unsubscribe: () => void } | undefined;
    try {
      sub = liveQuery(signature).subscribe({
        next: () => {
          clearTimeout(timer);
          timer = setTimeout(evaluate, first ? 50 : 600);
          first = false;
        },
        error: () => undefined,
      });
    } catch { /* no IndexedDB: nothing to watch */ }
    const onVisible = () => { if (!document.hidden) evaluate(); };
    const onCelebrate = (e: Event) => {
      const d = (e as CustomEvent<CelebrateDetail>).detail;
      if (!d?.title) return;
      push({ id: `c-${Date.now()}`, kicker: d.kicker ?? 'Well done', title: d.title, text: d.text, glyph: d.glyph, href: d.href, linkText: d.linkText });
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => {
      clearTimeout(timer);
      sub?.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener(CELEBRATE_EVENT, onCelebrate);
    };
  }, [evaluate, push]);

  const current = queue[0];
  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  return (
    <div className="dl-toasts" aria-live="polite" aria-relevant="additions">
      {current && <ToastView key={current.id} t={current} reduced={reduced} onClose={dismiss} more={queue.length - 1} />}
    </div>
  );
}

function ToastView({ t, reduced, onClose, more }: { t: Toast; reduced: boolean; onClose: () => void; more: number }) {
  // Closes by itself after 9 s of not being hovered or focused.
  const hold = useRef(false);
  useEffect(() => {
    const step = 250;
    let left = 9000;
    const id = setInterval(() => {
      if (hold.current) return;
      left -= step;
      if (left <= 0) { clearInterval(id); onClose(); }
    }, step);
    return () => clearInterval(id);
  }, [onClose]);
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
  return (
    <div className="dl-toast" data-anim={reduced ? undefined : ''} role="status" onKeyDown={onKey}
      onMouseEnter={() => { hold.current = true; }} onMouseLeave={() => { hold.current = false; }}
      onFocus={() => { hold.current = true; }} onBlur={() => { hold.current = false; }}>
      <Burst glyph={t.glyph} label={t.label} />
      <div className="dl-toast-body">
        <p className="dl-toast-kicker">{t.kicker}</p>
        <p className="dl-toast-title">{t.title}</p>
        {t.text && <p className="dl-toast-text">{t.text}</p>}
        <p className="dl-toast-actions">
          {t.href && <a href={t.href}>{t.linkText ?? 'See more'}</a>}
          {more > 0 && <span className="dl-muted">{more} more</span>}
        </p>
      </div>
      <button type="button" className="dl-toast-close" onClick={onClose} aria-label="Close this message">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

/** Two finished nodes feed the new one, which lights up: the lineage of what you did. */
function Burst({ glyph, label }: { glyph?: Glyph; label?: string }) {
  return (
    <span className="dl-burst" aria-hidden="true">
      <svg viewBox="0 0 96 64" width="96" height="64" focusable="false">
        <path className="dl-burst-edge" d="M30 15 C 46 15, 44 32, 58 32" pathLength="60" />
        <path className="dl-burst-edge" d="M30 49 C 46 49, 44 32, 58 32" pathLength="60" />
        <rect className="dl-burst-up" x="4" y="8" width="26" height="14" rx="4" />
        <rect className="dl-burst-up" x="4" y="42" width="26" height="14" rx="4" />
        <circle className="dl-burst-ring" cx="75" cy="32" r="17" />
        <circle className="dl-burst-node" cx="75" cy="32" r="17" />
        <circle className="dl-burst-port" cx="58" cy="32" r="3" />
      </svg>
      <span className="dl-burst-glyph">{label ? <b>{label}</b> : glyph ? <GlyphSvg glyph={glyph} size={18} /> : null}</span>
    </span>
  );
}
