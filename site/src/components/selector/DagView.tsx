import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NodeInfoState } from '../../lib/selector/highlight';
import { edgePath, type Layout } from './layout';

export interface NodeLabel {
  title: string;
  kind: string;
  /** full text for screen readers and the tooltip */
  long: string;
}

interface Props {
  layout: Layout;
  states: Map<string, NodeInfoState>;
  labelOf: (id: string) => NodeLabel;
  picked: string | null;
  onPick: (id: string) => void;
  /** test nodes (dashed edges) */
  isTest: (id: string) => boolean;
  /** selected nodes: the view moves to show them when they change */
  focus: string[];
}

const STATE_TEXT: Record<string, string> = {
  matched: 'selected, matched by the method',
  neighbor: 'selected, added by a graph operator',
  indirect: 'selected, test added by indirect selection',
  excluded: 'removed by --exclude',
  filtered: 'selected, then hidden by the resource type filter',
  none: 'not selected',
};

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Node names lose their middle, not their end: the end tells staging models apart
 * ("stg_jaffle_…__order_items", "stg_jaffle_…__orders"). Both parts start or end at a _ or . when they can.
 */
export function clipMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  let tail = s.slice(-Math.ceil((max - 1) * 0.55));
  const t = tail.search(/[_.]/);
  if (t > 0 && tail.length - t >= 6) tail = tail.slice(t);
  let head = s.slice(0, max - 1 - tail.length);
  const h = Math.max(head.lastIndexOf('_'), head.lastIndexOf('.'));
  if (h >= head.length * 0.6) head = head.slice(0, h + 1);
  return `${head}…${tail}`;
}

export default function DagView({ layout, states, labelOf, picked, onPick, isTest, focus }: Props) {
  const vp = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, SVGGElement>());
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [active, setActive] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; d?: number; k?: number } | null>(null);

  /** all = the whole graph in the view; otherwise a readable zoom, starting at the sources */
  const fit = useCallback((all = false) => {
    const el = vp.current;
    if (!el) return;
    const w = el.clientWidth || 800;
    const h = el.clientHeight || 500;
    const kFit = Math.min(1, (w - 16) / layout.width, (h - 16) / Math.max(layout.height, 1));
    const k = all ? Math.max(0.15, kFit) : Math.max(kFit, w < 600 ? 0.62 : 0.8);
    const tx = layout.width * k < w ? (w - layout.width * k) / 2 : 8;
    // the graph starts at the top of the canvas (the empty space goes below it)
    const ty = 12;
    setView({ k, tx, ty });
  }, [layout]);

  useLayoutEffect(() => { fit(); }, [fit]);

  // show the selected nodes: keep the zoom, move (or zoom out a little) only when some are outside the view
  const focusKey = focus.join('|');
  const viewRef = useRef(view);
  viewRef.current = view;
  useLayoutEffect(() => {
    const el = vp.current;
    const boxes = focus.map((id) => layout.nodes.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
    if (!el || !boxes.length) return;
    const w = el.clientWidth;
    const h = el.clientHeight - 40;
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const v = viewRef.current;
    const inside = x0 * v.k + v.tx >= 0 && x1 * v.k + v.tx <= w && y0 * v.k + v.ty >= 0 && y1 * v.k + v.ty <= h;
    if (inside) return;
    const k = Math.max(w < 600 ? 0.5 : 0.62, Math.min(v.k, (w - 32) / (x1 - x0), (h - 32) / (y1 - y0)));
    // the graph stays at the top of the canvas when the selection fits below it; otherwise the selection does
    setView({ k, tx: w / 2 - ((x0 + x1) / 2) * k, ty: y1 * k + 12 <= h - 16 ? 12 : 16 - y0 * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, layout]);

  const order = useMemo(() => layout.layers.flat(), [layout]);
  const first = order[0] ?? null;
  const roving = active && layout.nodes.has(active) ? active : first;

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = vp.current;
    const w = el?.clientWidth ?? 800;
    const h = el?.clientHeight ?? 500;
    const px = cx ?? w / 2;
    const py = cy ?? h / 2;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.2, v.k * factor));
      return { k, tx: px - ((px - v.tx) / v.k) * k, ty: py - ((py - v.ty) / v.k) * k };
    });
  };

  const reveal = (id: string) => {
    const n = layout.nodes.get(id);
    const el = vp.current;
    if (!n || !el) return;
    setView((v) => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const x0 = n.x * v.k + v.tx;
      const y0 = n.y * v.k + v.ty;
      const x1 = (n.x + n.w) * v.k + v.tx;
      const y1 = (n.y + n.h) * v.k + v.ty;
      let { tx, ty } = v;
      if (x0 < 12) tx += 12 - x0; else if (x1 > w - 12) tx -= x1 - (w - 12);
      if (y0 < 12) ty += 12 - y0; else if (y1 > h - 56) ty -= y1 - (h - 56);
      return { ...v, tx, ty };
    });
  };

  const move = (from: string, key: string): string | null => {
    const n = layout.nodes.get(from);
    if (!n) return null;
    const layer = layout.layers[n.layer] ?? [];
    const i = layer.indexOf(from);
    const near = (cands: string[]) => {
      if (!cands.length) return null;
      return cands.reduce((best, c) => (Math.abs(layout.nodes.get(c)!.y - n.y) < Math.abs(layout.nodes.get(best)!.y - n.y) ? c : best));
    };
    switch (key) {
      case 'ArrowUp': return layer[i - 1] ?? null;
      case 'ArrowDown': return layer[i + 1] ?? null;
      case 'ArrowLeft': {
        const ps = layout.edges.filter((e) => e.to === from).map((e) => e.from);
        return near(ps) ?? near(layout.layers[n.layer - 1] ?? []);
      }
      case 'ArrowRight': {
        const cs = layout.edges.filter((e) => e.from === from).map((e) => e.to);
        return near(cs) ?? near(layout.layers[n.layer + 1] ?? []);
      }
      case 'Home': return first;
      case 'End': return order[order.length - 1] ?? null;
      default: return null;
    }
  };

  const onKey = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(id); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.2); return; }
    if (e.key === '-') { e.preventDefault(); zoomAt(1 / 1.2); return; }
    const next = move(id, e.key);
    if (next) {
      e.preventDefault();
      setActive(next);
      reveal(next);
      requestAnimationFrame(() => refs.current.get(next)?.focus());
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('.msl-node') || (e.target as Element).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, tx: view.tx, ty: view.ty, d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d0 = drag.current;
    if (pointers.current.size >= 2 && d0.d && d0.k) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = vp.current!.getBoundingClientRect();
      const cx = d0.x - rect.left;
      const cy = d0.y - rect.top;
      const k = Math.min(2.5, Math.max(0.2, d0.k * (d / d0.d)));
      setView({ k, tx: cx - ((cx - d0.tx) / d0.k) * k, ty: cy - ((cy - d0.ty) / d0.k) * k });
    } else {
      setView((v) => ({ ...v, tx: d0.tx + (e.clientX - d0.x), ty: d0.ty + (e.clientY - d0.y) }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) drag.current = null;
  };
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the page; pinch / ctrl+wheel zooms
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const on = (id: string) => {
    const s = states.get(id)?.state;
    return s === 'matched' || s === 'neighbor' || s === 'indirect';
  };

  return (
    <div className="msl-viewport" ref={vp} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <svg role="group" aria-label="Lineage graph of the project. Use the arrow keys to move between nodes and Enter to see a node. The list view shows the same information.">
        <g transform={`translate(${view.tx.toFixed(1)} ${view.ty.toFixed(1)}) scale(${view.k.toFixed(3)})`}>
          <g aria-hidden="true">
            {layout.edges.map((e) => (
              <path key={`${e.from}>${e.to}`} className={`msl-edge${on(e.from) && on(e.to) ? ' on' : ''}${isTest(e.to) ? ' test' : ''}`} d={edgePath(e.points)} />
            ))}
          </g>
          {order.map((id) => {
            const n = layout.nodes.get(id)!;
            const st = states.get(id)?.state ?? 'none';
            const lab = labelOf(id);
            const maxChars = n.small ? 27 : 24;
            return (
              <g
                key={id}
                ref={(el) => { if (el) refs.current.set(id, el); else refs.current.delete(id); }}
                className={`msl-node is-${st}${n.small ? ' small' : ''}${picked === id ? ' picked' : ''}`}
                transform={`translate(${n.x} ${n.y})`}
                tabIndex={roving === id ? 0 : -1}
                role="button"
                aria-label={`${lab.long}. ${STATE_TEXT[st]}.`}
                aria-pressed={picked === id}
                onClick={() => { setActive(id); onPick(id); }}
                onKeyDown={(e) => onKey(e, id)}
                onFocus={() => setActive(id)}
              >
                <title>{lab.long}</title>
                <rect className="ring" x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={14} />
                <rect className="box" width={n.w} height={n.h} rx={n.small ? 8 : 11} />
                {n.small ? (
                  <text className="t" x={12} y={n.h / 2 + 4}>{clipMiddle(lab.title, maxChars)}</text>
                ) : (
                  <>
                    <text className="k" x={12} y={17}>{clip(lab.kind, 30)}</text>
                    <text className="t" x={12} y={34}>{clipMiddle(lab.title, maxChars)}</text>
                  </>
                )}
                <circle className="port" cx={0} cy={n.h / 2} r={3.5} />
                <circle className="port" cx={n.w} cy={n.h / 2} r={3.5} />
              </g>
            );
          })}
        </g>
      </svg>
      <p className="msl-help" aria-hidden="true">Drag to move. Ctrl + wheel or pinch to zoom.</p>
      <div className="msl-zoom">
        <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => fit(true)} aria-label="Show the whole graph">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
        </button>
      </div>
    </div>
  );
}
