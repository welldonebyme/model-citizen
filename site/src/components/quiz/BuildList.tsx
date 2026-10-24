// Build list: put the items in order.
// - Mouse, pen and touch: drag an item by its handle.
// - Keyboard: on the handle, Up/Down arrows move the item; or use the Move up / Move down buttons.
// The question counts as answered after the first move, or after "Use this order".
import { useLayoutEffect, useRef, useState } from 'react';
import type { Question } from '../../lib/content-types';
import type { Response } from '../../lib/scoring';
import { Inline } from '../content/Inline';
import { plain } from '../../lib/exam/describe';
import { IconDown, IconGrip, IconUp, Mark } from './icons';

interface Props {
  q: Question;
  response: Response | undefined;
  onResponse: (r: Response | undefined) => void;
  locked?: boolean;
  review?: boolean;
  name: string;
}

export function BuildList({ q, response, onResponse, locked, review, name }: Props) {
  const options = q.options ?? [];
  const byId = new Map(options.map((o) => [o.id, o]));
  const order = response?.format === 'order' && response.order.length === options.length ? response.order : options.map((o) => o.id);
  const answered = response?.format === 'order' && response.order.length > 0;
  const key = q.key as string[];
  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocus = useRef<{ id: string; ctl: 'handle' | 'up' | 'down' } | null>(null);
  const [msg, setMsg] = useState('');
  const [drag, setDrag] = useState<{ id: string; startY: number; dy: number; target: number } | null>(null);

  const move = (from: number, to: number, ctl: 'handle' | 'up' | 'down') => {
    if (locked) return;
    const id = order[from];
    if (to < 0 || to >= order.length || from === to) {
      setMsg(to < 0 ? 'This item is already first.' : to >= order.length ? 'This item is already last.' : '');
      pendingFocus.current = { id, ctl };
      return;
    }
    const next = order.slice();
    next.splice(from, 1);
    next.splice(to, 0, id);
    onResponse({ format: 'order', order: next });
    pendingFocus.current = { id, ctl };
    setMsg(`${plain(byId.get(id)?.c)} moved to position ${to + 1} of ${order.length}.`);
  };

  // Keep the focus on the moved item (React moves the DOM node, which can drop the focus).
  useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f || !listRef.current) return;
    pendingFocus.current = null;
    const el = listRef.current.querySelector<HTMLElement>(`[data-item="${f.id}"] [data-ctl="${f.ctl}"]`);
    if (el && document.activeElement !== el) el.focus();
  });

  const onHandleKey = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1, 'handle'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1, 'handle'); }
    else if (e.key === 'Home') { e.preventDefault(); move(i, 0, 'handle'); }
    else if (e.key === 'End') { e.preventDefault(); move(i, order.length - 1, 'handle'); }
  };

  // Pointer drag: the item follows the pointer; a line shows where it will land.
  const rects = useRef<DOMRect[]>([]);
  const onDown = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    rects.current = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-item]') ?? []).map((el) => el.getBoundingClientRect());
    setDrag({ id, startY: e.clientY, dy: 0, target: order.indexOf(id) });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const from = order.indexOf(drag.id);
    const r = rects.current[from];
    if (!r) return;
    const center = r.top + r.height / 2 + (e.clientY - drag.startY);
    // final position = how many other items have their middle above the dragged item's middle
    let target = 0;
    rects.current.forEach((rc, k) => { if (k !== from && center > rc.top + rc.height / 2) target++; });
    setDrag({ ...drag, dy: e.clientY - drag.startY, target });
  };
  const onUp = () => {
    if (!drag) return;
    const from = order.indexOf(drag.id);
    const moved = Math.abs(drag.dy) > 4;
    setDrag(null);
    if (moved) move(from, drag.target, 'handle');
  };

  return (
    <div className="qz-order">
      {!locked && <p className="qz-hint" id={`${name}-help`}>Drag an item by its handle, or use the arrow keys on the handle, or the Move up and Move down buttons.</p>}
      <ol className="qz-order-list" ref={listRef} aria-label="Your order, from first to last">
        {order.map((id, i) => {
          const o = byId.get(id);
          const right = review ? key[i] === id : undefined;
          const isDragged = drag?.id === id;
          const from = drag ? order.indexOf(drag.id) : -1;
          const others = drag ? order.filter((x) => x !== drag.id) : [];
          const changes = !!drag && drag.target !== from;
          const dropBefore = changes && others[drag!.target] === id;
          const dropAfter = changes && drag!.target === others.length && others[others.length - 1] === id;
          return (
            <li
              key={id} data-item={id}
              className="qz-order-item"
              data-dragging={isDragged || undefined}
              data-drop={dropBefore ? 'before' : dropAfter ? 'after' : undefined}
              data-state={review ? (right ? 'right' : 'wrong') : undefined}
              style={isDragged ? { transform: `translateY(${drag!.dy}px)` } : undefined}
            >
              <span className="qz-pos" aria-hidden="true">{i + 1}</span>
              {!locked && (
                <button
                  type="button" className="qz-handle" data-ctl="handle"
                  aria-label={`Move ${plain(o?.c)}, position ${i + 1} of ${order.length}`}
                  aria-describedby={`${name}-help`}
                  onKeyDown={onHandleKey(i)}
                  onPointerDown={onDown(id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
                ><IconGrip /></button>
              )}
              <span className="qz-letter" aria-hidden="true">{id}</span>
              <span className="qz-order-text"><Inline c={o?.c} /></span>
              {!locked && (
                <span className="qz-order-btns">
                  <button type="button" className="qz-icon-btn" data-ctl="up" aria-label={`Move up: ${plain(o?.c)}`} aria-disabled={i === 0 || undefined} onClick={() => move(i, i - 1, 'up')}><IconUp /><span className="qz-btn-text">Move up</span></button>
                  <button type="button" className="qz-icon-btn" data-ctl="down" aria-label={`Move down: ${plain(o?.c)}`} aria-disabled={i === order.length - 1 || undefined} onClick={() => move(i, i + 1, 'down')}><IconDown /><span className="qz-btn-text">Move down</span></button>
                </span>
              )}
              {review && <span className="qz-choice-mark"><Mark ok={!!right} label={right ? 'Right place' : `Wrong place, ${key[i]} goes here`} /></span>}
            </li>
          );
        })}
      </ol>
      {!locked && !answered && (
        <p className="qz-order-keep">
          <button type="button" className="btn btn-quiet btn-small" onClick={() => onResponse({ format: 'order', order })}>Use this order</button>
          <span className="qz-hint">Not answered yet. Move an item, or choose “Use this order” if this order is your answer.</span>
        </p>
      )}
      {!locked && answered && <p className="qz-hint">Your order is saved.</p>}
      {review && <p className="qz-hint">Correct order: <b>{key.join(', ')}</b>.</p>}
      <p className="visually-hidden" aria-live="polite">{msg}</p>
    </div>
  );
}
