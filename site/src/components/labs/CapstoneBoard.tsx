// Capstone hub: the 15 ShopFlow milestones as a project board (to do, in progress, done).
// Each card holds the milestone's requirement checklist; a tick here is the same tick as on the lesson page
// (progress "labstep" rows), and a milestone is done when all its requirements are ticked.
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, markProgress, unmarkProgress, logActivity } from '../../lib/store/db';
import { Blocks } from '../content/Blocks';
import { Inline } from '../content/Inline';
import type { Block, Inline as InlineT } from '../../lib/content-types';
import { url } from '../../lib/url';
import './capstone.css';

export interface Milestone {
  id: string;            // "m02"
  labId: string;         // "ch26-lab3"
  number: string;        // "26.4"
  title: string;         // "Staging"
  lessonPath: string;
  goal: InlineT[];
  requirements: Block[][];
  expected?: InlineT[];
  hintsAnchor?: string;
  checkpointAnchor?: string;
  hints: number;
}

type Status = 'todo' | 'doing' | 'done';
const COLUMNS: { id: Status; title: string; empty: string }[] = [
  { id: 'doing', title: 'In progress', empty: 'Nothing started. Tick a requirement when you finish it.' },
  { id: 'todo', title: 'To do', empty: 'Nothing left to do.' },
  { id: 'done', title: 'Done', empty: 'Finished milestones move here.' },
];

export default function CapstoneBoard({ milestones }: { milestones: Milestone[] }) {
  const rows = useLiveQuery(() => db().progress.where('ref').startsWith('ch26-lab').toArray(), [], []);
  const saved = useMemo(() => new Set(rows.filter((r) => r.kind === 'labstep').map((r) => r.ref)), [rows]);
  // a tick shows at once; the saved rows catch up a moment later
  const [local, setLocal] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    setLocal((m) => { const n = new Map([...m].filter(([ref, on]) => saved.has(ref) !== on)); return n.size === m.size ? m : n; });
  }, [saved]);
  const ticked = useMemo(() => {
    const t = new Set(saved);
    for (const [ref, on] of local) { if (on) t.add(ref); else t.delete(ref); }
    return t;
  }, [saved, local]);
  // a tick can move the card to another column (a new element): keep the keyboard focus on that checkbox
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const setTick = (ref: string, on: boolean) => { setLocal((m) => new Map(m).set(ref, on)); setFocusRef(ref); };
  const status = (m: Milestone): Status => {
    const n = m.requirements.filter((_, i) => ticked.has(`${m.labId}:r${i + 1}`)).length;
    return n === m.requirements.length ? 'done' : n > 0 ? 'doing' : 'todo';
  };
  const done = milestones.filter((m) => status(m) === 'done').length;
  const next = milestones.find((m) => status(m) !== 'done');
  const reqTotal = milestones.reduce((n, m) => n + m.requirements.length, 0);

  return (
    <div className="cp">
      <section className="cp-track panel" aria-labelledby="cp-track-h">
        <div className="cp-track-head">
          <h2 id="cp-track-h">{done === milestones.length ? 'ShopFlow is released' : `${done} of ${milestones.length} milestones done`}</h2>
          <p>{ticked.size} of {reqTotal} requirements ticked{next ? <>. Next: <a href={url(next.lessonPath)}>{next.id} {next.title}</a></> : '. Well done: read the trap hunt and the rubric, then score your project.'}</p>
        </div>
        <ol className="cp-line" aria-label="Milestones in order">
          {milestones.map((m) => {
            const s = status(m);
            return (
              <li key={m.id} data-status={s}>
                <a href={`#card-${m.id}`} title={`${m.id} ${m.title}`}>
                  <span className="cp-node" aria-hidden="true">{s === 'done' ? '✓' : ''}</span>
                  <span className="cp-node-id">{m.id}</span>
                  <span className="visually-hidden">{m.title}, {s === 'done' ? 'done' : s === 'doing' ? 'in progress' : 'to do'}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="cp-board">
        {COLUMNS.map((col) => {
          const list = milestones.filter((m) => status(m) === col.id);
          return (
            <section key={col.id} className="cp-col" data-col={col.id} aria-labelledby={`cp-col-${col.id}`}>
              <h2 id={`cp-col-${col.id}`}>{col.title} <span className="cp-count">{list.length}</span></h2>
              {list.length === 0 ? <p className="cp-empty">{col.empty}</p> : (
                <ul className="cp-cards">
                  {list.map((m) => <Card key={m.id} m={m} ticked={ticked} onTick={setTick} focusRef={focusRef} open={col.id === 'doing' || m === next || m.requirements.some((_, i) => focusRef === `${m.labId}:r${i + 1}`)} />)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({ m, ticked, onTick, focusRef, open }: { m: Milestone; ticked: Set<string>; onTick: (ref: string, on: boolean) => void; focusRef: string | null; open: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const n = m.requirements.filter((_, i) => ticked.has(`${m.labId}:r${i + 1}`)).length;
  const toggle = async (ref: string, on: boolean) => {
    onTick(ref, on);
    try {
      if (on) { await markProgress('labstep', ref, 'done', { lesson: m.lessonPath }); await logActivity(0); }
      else await unmarkProgress('labstep', ref);
      setErr(null);
    } catch { setErr('This browser does not let the site save your ticks.'); }
  };
  return (
    <li className="cp-card" id={`card-${m.id}`}>
      <p className="cp-card-kicker"><span className="cp-mid">{m.id}</span> Lesson {m.number}</p>
      <h3><a href={url(m.lessonPath)}>{m.title}</a></h3>
      <p className="cp-goal"><Inline c={m.goal} /></p>
      <div className="cp-meter" aria-hidden="true"><span style={{ width: `${(100 * n) / m.requirements.length}%` }} /></div>
      <details className="cp-reqs" open={open}>
        <summary>Requirements <span className="cp-n">{n} of {m.requirements.length}</span></summary>
        <ul className="mc-steps mc-reqs">
          {m.requirements.map((blocks, i) => {
            const ref = `${m.labId}:r${i + 1}`;
            return (
              <li key={ref} className="mc-step">
                <label className="mc-tick" data-n="">
                  <input type="checkbox" checked={ticked.has(ref)} onChange={(e) => toggle(ref, e.currentTarget.checked)}
                    ref={(el) => { if (el && ref === focusRef && document.activeElement !== el && document.activeElement?.tagName !== 'INPUT') { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); } }} />
                  <span className="visually-hidden">Requirement {i + 1} of {m.id} done</span>
                </label>
                <div className="mc-step-body"><Blocks blocks={blocks} /></div>
              </li>
            );
          })}
        </ul>
        {m.expected && <p className="cp-expected"><Inline c={m.expected} /></p>}
        {err && <p className="cp-err" role="alert">{err}</p>}
      </details>
      <p className="cp-links">
        <a href={url(m.lessonPath)}>Open the milestone</a>
        {m.hintsAnchor && <a href={url(`${m.lessonPath}#${m.hintsAnchor}`)}>{m.hints === 1 ? '1 hint' : `${m.hints} hints`}</a>}
        {m.checkpointAnchor && <a href={url(`${m.lessonPath}#${m.checkpointAnchor}`)}>Check your output</a>}
        <a href={url(`labs/reference/?repo=shopflow&tag=${m.id}`)}>Solution</a>
      </p>
    </li>
  );
}
