// Small accessible SVG charts for the results pages (dataviz method: one hue for one series, thin marks,
// rounded data-ends, hairline axes, values in text colours, hover/focus tooltip, a table twin for each).
import { useRef, useState } from 'react';
import { PASS_PCT, TARGET_PCT } from '../../lib/scoring';
import type { Row, Outcome } from '../../lib/exam/results';
import { mss, shortDate } from '../../lib/exam/time';
import type { Attempt } from '../../lib/exam/engine';

/** Score against the pass line and the target: a meter with two labelled markers. */
export function ScoreMeter({ pct }: { pct: number }) {
  const level = pct >= TARGET_PCT ? 'ready' : pct >= PASS_PCT ? 'pass' : 'fail';
  return (
    <div className="viz-meter" data-level={level} role="img" aria-label={`Score ${Math.floor(pct)}%. Pass line ${PASS_PCT}%, target ${TARGET_PCT}%.`}>
      <div className="viz-meter-track">
        <div className="viz-meter-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        <span className="viz-meter-mark" style={{ left: `${PASS_PCT}%` }} />
        <span className="viz-meter-mark" style={{ left: `${TARGET_PCT}%` }} />
      </div>
      <div className="viz-meter-labels" aria-hidden="true">
        <span style={{ left: '0%' }}>0%</span>
        <span style={{ left: `${PASS_PCT}%` }}>Pass line {PASS_PCT}%</span>
        <span style={{ left: `${TARGET_PCT}%` }}>Target {TARGET_PCT}%</span>
        <span style={{ left: '100%' }}>100%</span>
      </div>
    </div>
  );
}

/** Horizontal bars, one per topic or objective: share of correct answers, value at the tip. */
export function RowBars({ rows, label, idLabel }: { rows: Row[]; label: string; idLabel: (r: Row) => string }) {
  return (
    <table className="viz-rows">
      <caption className="visually-hidden">{label}</caption>
      <thead className="visually-hidden"><tr><th scope="col">Item</th><th scope="col">Correct</th><th scope="col">Share</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row"><span className="viz-row-id">{idLabel(r)}</span><span className="viz-row-title">{r.title}</span></th>
            <td className="viz-row-n">{r.correct} of {r.total}</td>
            <td className="viz-row-bar">
              <div className="viz-row-bar-in">
                <span className="viz-bar-track" aria-hidden="true">
                  <span className="viz-bar" style={{ width: `${r.pct}%` }} />
                  <span className="viz-bar-ref" style={{ left: `${PASS_PCT}%` }} />
                </span>
                <span className="viz-bar-val">{Math.round(r.pct)}%</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Tip { x: number; y: number; text: string; sub: string }

/** Time spent on each question (columns) against the 1 min 50 s pace (a labelled reference line). */
export function TimeChart({ outcomes, paceMs }: { outcomes: Outcome[]; paceMs: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const n = outcomes.length;
  if (!n) return null;
  const W = 720, H = 200, L = 44, R = 12, T = 14, B = 26;
  const maxMs = Math.max(paceMs * 1.5, ...outcomes.map((o) => o.ms));
  const step = maxMs > 6 * 60_000 ? 120_000 : 60_000;
  const top = Math.ceil(maxMs / step) * step;
  const y = (ms: number) => T + (H - T - B) * (1 - ms / top);
  const band = (W - L - R) / n;
  const bw = Math.max(2, Math.min(24, band - 2));
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const show = (i: number, el: Element | null) => {
    const o = outcomes[i];
    const box = boxRef.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    if (!box || !r) return;
    setTip({ x: r.left + r.width / 2 - box.left, y: r.top - box.top, text: mss(o.ms), sub: `Question ${o.index + 1}${o.correct ? ', correct' : ', not correct'}` });
  };
  const xLabelEvery = n > 40 ? 10 : n > 15 ? 5 : 1;
  return (
    <div className="viz-box" ref={boxRef} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={`Time per question. Pace line at ${mss(paceMs)}. ${outcomes.filter((o) => o.ms > paceMs).length} questions took longer.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={L - 6} y={y(t) + 4} className="viz-tick" textAnchor="end">{mss(t)}</text>
          </g>
        ))}
        {outcomes.map((o, i) => {
          const x = L + i * band + (band - bw) / 2;
          const h = Math.max(0, y(0) - y(o.ms));
          const r = Math.min(4, bw / 2, h);
          const yy = y(o.ms);
          return (
            <g key={o.q.id} className="viz-col" onPointerEnter={(e) => show(i, e.currentTarget.querySelector('.viz-hit'))}>
              <rect className="viz-hit" x={L + i * band} y={T} width={band} height={H - T - B} fill="transparent" />
              {h > 0 && <path className={o.ms > paceMs ? 'viz-mark viz-mark-over' : 'viz-mark'} d={`M${x},${y(0)} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${y(0)} Z`} />}
              {(i + 1) % xLabelEvery === 0 || i === 0 ? <text x={L + i * band + band / 2} y={H - 8} className="viz-tick" textAnchor="middle">{o.index + 1}</text> : null}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(paceMs)} y2={y(paceMs)} className="viz-ref" />
        <text x={W - R} y={y(paceMs) - 5} className="viz-ref-label" textAnchor="end">Pace {mss(paceMs)} per question</text>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="viz-axis" />
      </svg>
      {tip && (
        <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="presentation">
          <b>{tip.text}</b><span>{tip.sub}</span>
        </div>
      )}
    </div>
  );
}

/** Score of every finished attempt over time, with the pass line and the target. */
export function HistoryChart({ attempts, currentId }: { attempts: Attempt[]; currentId?: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const list = attempts.filter((a) => a.status === 'finished' && a.score).sort((a, b) => a.startedAt - b.startedAt);
  if (!list.length) return null;
  const W = 720, H = 220, L = 44, R = 16, T = 16, B = 34;
  const x = (i: number) => (list.length === 1 ? (L + W - R) / 2 : L + ((W - L - R) * i) / (list.length - 1));
  const y = (p: number) => T + (H - T - B) * (1 - p / 100);
  const pts = list.map((a, i) => ({ a, x: x(i), y: y(a.score!.pct) }));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const every = Math.ceil(list.length / 7);
  const show = (i: number) => {
    const p = pts[i];
    const box = boxRef.current;
    if (!box) return;
    const sx = box.getBoundingClientRect().width / W;
    setTip({ x: p.x * sx, y: p.y * sx, text: `${Math.floor(p.a.score!.pct)}%`, sub: `Mock ${p.a.mock}, ${p.a.mode} mode, ${shortDate(p.a.startedAt)}` });
  };
  return (
    <div className="viz-box" ref={boxRef} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={`Your mock exam scores over time: ${list.map((a) => `${Math.floor(a.score!.pct)}%`).join(', ')}.`}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={L - 6} y={y(t) + 4} className="viz-tick" textAnchor="end">{t}%</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(PASS_PCT)} y2={y(PASS_PCT)} className="viz-ref" />
        <text x={L + 4} y={y(PASS_PCT) - 5} className="viz-ref-label">Pass line {PASS_PCT}%</text>
        <line x1={L} x2={W - R} y1={y(TARGET_PCT)} y2={y(TARGET_PCT)} className="viz-ref viz-ref-target" />
        <text x={L + 4} y={y(TARGET_PCT) - 5} className="viz-ref-label">Target {TARGET_PCT}%</text>
        {pts.length > 1 && <path d={line} className="viz-line" />}
        {pts.map((p, i) => (
          <g key={p.a.id} className="viz-pt" tabIndex={0} role="img"
            aria-label={`Mock ${p.a.mock}, ${p.a.mode} mode, ${shortDate(p.a.startedAt)}: ${Math.floor(p.a.score!.pct)}%`}
            onPointerEnter={() => show(i)} onFocus={() => show(i)} onBlur={() => setTip(null)}>
            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={p.a.id === currentId ? 6 : 5} className={p.a.mode === 'exam' ? 'viz-dot' : 'viz-dot viz-dot-open'} />
            {(i % every === 0 || i === pts.length - 1) && <text x={p.x} y={H - 12} className="viz-tick" textAnchor="middle">M{p.a.mock} {shortDate(p.a.startedAt)}</text>}
          </g>
        ))}
      </svg>
      <ul className="viz-legend">
        <li><span className="viz-key viz-key-dot" aria-hidden="true" />Exam mode (timed)</li>
        <li><span className="viz-key viz-key-open" aria-hidden="true" />Practice mode</li>
      </ul>
      {tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="presentation"><b>{tip.text}</b><span>{tip.sub}</span></div>}
    </div>
  );
}
