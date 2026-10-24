import { useState } from 'react';
import type { NodeInfoState } from '../../lib/selector/highlight';
import type { Project } from '../../lib/selector/project';
import { STATE_LABEL } from './Details';
import { displayName, typeWord } from './labels';

interface Props {
  project: Project;
  ids: string[];
  states: Map<string, NodeInfoState>;
  picked: string | null;
  onPick: (id: string) => void;
}

const SHORT: Record<string, string> = {
  matched: 'matched', neighbor: 'graph operator', indirect: 'test added', filtered: 'hidden by type', excluded: 'excluded', none: 'not selected',
};

const RANK: Record<string, number> = { matched: 0, neighbor: 1, indirect: 2, filtered: 3, excluded: 4, none: 5 };

/** The same information as the graph, as a table (screen readers, phones). */
export default function NodeList({ project, ids, states, picked, onPick }: Props) {
  const [onlySelected, setOnlySelected] = useState(false);
  const rows = ids
    .map((id) => ({ id, st: states.get(id)?.state ?? 'none' }))
    .filter((r) => !onlySelected || ['matched', 'neighbor', 'indirect'].includes(r.st))
    .sort((a, b) => RANK[a.st] - RANK[b.st] || (a.id < b.id ? -1 : 1));
  const selectedCount = ids.filter((id) => ['matched', 'neighbor', 'indirect'].includes(states.get(id)?.state ?? 'none')).length;
  return (
    <div className="msl-list">
      <div style={{ padding: '10px 14px 0' }}>
        <label className="msl-toggle"><input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> Only the selected nodes</label>
      </div>
      <table className="msl-table">
        <caption>{selectedCount} of {ids.length} nodes selected. Selected nodes first, then the others.</caption>
        <thead><tr><th scope="col">Node</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {rows.map(({ id, st }) => {
            const n = project.get(id);
            const info = states.get(id);
            return (
              <tr key={id} className={picked === id ? 'sel' : undefined}>
                <td className="n">
                  <button type="button" className="msl-linkbtn" onClick={() => onPick(id)} aria-pressed={picked === id}>{displayName(n)}</button>
                  <span className="msl-row-meta">{typeWord(n)}{info?.why.length ? `, from ${info.why.join(', ')}` : ''}</span>
                </td>
                <td><span className={`msl-pill ${st}`} title={STATE_LABEL[st]}>{SHORT[st]}</span><span className="visually-hidden">: {STATE_LABEL[st]}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
