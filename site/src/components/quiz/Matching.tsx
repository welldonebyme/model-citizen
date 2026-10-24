// Matching: every left item gets one right item.
// - Keyboard and phones: one select per left item (always available).
// - Mouse, pen and touch on wider screens: draw a line from a left dot to a right item (drag), or click a
//   left dot then a right item. The dots are buttons, so this way works with the keyboard too.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '../../lib/content-types';
import type { Response } from '../../lib/scoring';
import { Inline } from '../content/Inline';
import { plain } from '../../lib/exam/describe';
import { Mark } from './icons';

interface Props {
  q: Question;
  response: Response | undefined;
  onResponse: (r: Response | undefined) => void;
  locked?: boolean;
  review?: boolean;
  name: string;
}

interface Line { from: string; to: string; x1: number; y1: number; x2: number; y2: number; state?: 'right' | 'wrong' }

export function Matching({ q, response, onResponse, locked, review, name }: Props) {
  const left = q.match?.left ?? [];
  const right = q.match?.right ?? [];
  const pairs = useMemo(() => (response?.format === 'match' ? response.pairs : {}), [response]);
  const key = q.key as Record<string, string>;
  const boxRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [armed, setArmed] = useState<string | null>(null);   // left id picked with a click / Enter
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const [msg, setMsg] = useState('');

  const setPair = useCallback((l: string, r: string | null) => {
    if (locked) return;
    const next = { ...pairs };
    if (r) next[l] = r; else delete next[l];
    onResponse(Object.keys(next).length ? { format: 'match', pairs: next } : undefined);
    setMsg(r ? `${l} matched with ${r}.` : `${l} has no match now.`);
  }, [locked, pairs, onResponse]);

  // Measure the dots to draw the lines (and redraw when the layout changes).
  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const b = box.getBoundingClientRect();
    const out: Line[] = [];
    for (const l of left) {
      const r = pairs[l.id];
      if (!r) continue;
      const a = box.querySelector<HTMLElement>(`[data-dot-left="${l.id}"]`)?.getBoundingClientRect();
      const z = box.querySelector<HTMLElement>(`[data-dot-right="${r}"]`)?.getBoundingClientRect();
      if (!a || !z || a.width === 0 || z.width === 0) continue;
      out.push({ from: l.id, to: r, x1: a.left + a.width / 2 - b.left, y1: a.top + a.height / 2 - b.top, x2: z.left + z.width / 2 - b.left, y2: z.top + z.height / 2 - b.top, state: review ? (key[l.id] === r ? 'right' : 'wrong') : undefined });
    }
    setLines((old) => (JSON.stringify(old) === JSON.stringify(out) ? old : out));
  }, [left, pairs, review, key]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  const pointFrom = (e: { clientX: number; clientY: number }) => {
    const b = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  const onDotDown = (l: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ from: l, ...pointFrom(e) });
  };
  const onDotMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const lastY = drag.y + (boxRef.current?.getBoundingClientRect().top ?? 0);
    if (e.clientY < 70 && e.clientY < lastY) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - 70 && e.clientY > lastY) window.scrollBy(0, 14);
    setDrag({ ...drag, ...pointFrom(e) });
  };
  const onDotUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const from = drag.from;
    setDrag(null);
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const target = el?.closest<HTMLElement>('[data-right-id]')?.dataset.rightId;
    if (target) { setPair(from, target); setArmed(null); }
    else setArmed((a) => (a === from ? null : from)); // a click without moving arms the dot
  };

  const dragStart = drag ? box(drag.from) : null;
  function box(l: string) {
    const bx = boxRef.current?.getBoundingClientRect();
    const a = boxRef.current?.querySelector<HTMLElement>(`[data-dot-left="${l}"]`)?.getBoundingClientRect();
    return bx && a ? { x: a.left + a.width / 2 - bx.left, y: a.top + a.height / 2 - bx.top } : null;
  }

  const usedBy = (r: string) => left.filter((l) => pairs[l.id] === r).map((l) => l.id);

  return (
    <div className="qz-match" ref={boxRef} data-armed={armed ?? undefined}>
      <svg className="qz-match-lines" aria-hidden="true">
        {lines.map((ln) => (
          <path key={ln.from} d={`M${ln.x1},${ln.y1} C${(ln.x1 + ln.x2) / 2},${ln.y1} ${(ln.x1 + ln.x2) / 2},${ln.y2} ${ln.x2},${ln.y2}`} data-state={ln.state} />
        ))}
        {drag && dragStart && <path className="qz-drag-line" d={`M${dragStart.x},${dragStart.y} L${drag.x},${drag.y}`} />}
      </svg>

      <div className="qz-match-cols">
        <ol className="qz-match-left" aria-label="Items to match">
          {left.map((l) => {
            const sel = pairs[l.id] ?? '';
            const ok = review ? key[l.id] === sel : undefined;
            return (
              <li key={l.id} className="qz-match-row" data-state={review ? (ok ? 'right' : 'wrong') : undefined}>
                <button
                  type="button" className="qz-dot qz-dot-left" data-dot-left={l.id}
                  aria-pressed={armed === l.id}
                  aria-label={`Draw a line from ${l.id}`}
                  tabIndex={-1}
                  onPointerDown={onDotDown(l.id)} onPointerMove={onDotMove} onPointerUp={onDotUp}
                  onPointerCancel={() => setDrag(null)}
                  onClick={(e) => { if (e.detail === 0) setArmed((a) => (a === l.id ? null : l.id)); }}
                />
                <div className="qz-match-item">
                  <span className="qz-letter" aria-hidden="true">{l.id}</span>
                  <span className="qz-match-text" id={`${name}-l${l.id}`}><Inline c={l.c} /></span>
                </div>
                <div className="qz-match-ctl">
                  <label className="visually-hidden" htmlFor={`${name}-s${l.id}`}>Match for {l.id}: {plain(l.c)}</label>
                  <select
                    id={`${name}-s${l.id}`}
                    value={sel}
                    disabled={false}
                    aria-describedby={review ? `${name}-r${l.id}` : undefined}
                    onChange={(e) => setPair(l.id, e.target.value || null)}
                  >
                    <option value="">Choose…</option>
                    {right.map((r) => {
                      const used = usedBy(r.id).filter((x) => x !== l.id);
                      return <option key={r.id} value={r.id}>{r.id}. {plain(r.c)}{used.length ? ` (also used for ${used.join(', ')})` : ''}</option>;
                    })}
                  </select>

                </div>
                {review && (
                  <p className="qz-match-review" id={`${name}-r${l.id}`}>
                    <Mark ok={!!ok} label={ok ? 'Right' : sel ? `Wrong, the answer is ${key[l.id]}` : `No match chosen, the answer is ${key[l.id]}`} />
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        <ul className="qz-match-right" aria-label="Possible matches">
          {right.map((r) => {
            const users = usedBy(r.id);
            return (
              <li key={r.id} className="qz-match-target" data-right-id={r.id} data-used={users.length > 0 || undefined}>
                <button
                  type="button" className="qz-dot qz-dot-right" data-dot-right={r.id}
                  tabIndex={-1}
                  aria-label={armed ? `Match ${armed} with ${r.id}` : `${r.id}`}
                  onClick={() => { if (armed) { setPair(armed, r.id); setArmed(null); } }}
                />
                <span className="qz-letter" aria-hidden="true">{r.id}</span>
                <span className="qz-match-text"><span className="visually-hidden">{r.id}. </span><Inline c={r.c} /></span>
                {armed && !locked && (
                  <button type="button" className="qz-match-pick" onClick={() => { setPair(armed, r.id); setArmed(null); }}>
                    Match {armed} here
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="visually-hidden" aria-live="polite">{msg}</p>
    </div>
  );
}
