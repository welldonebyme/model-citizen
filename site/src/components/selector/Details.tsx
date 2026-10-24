import type { NodeInfoState } from '../../lib/selector/highlight';
import type { Project } from '../../lib/selector/project';
import { displayName, typeWord } from './labels';

export const STATE_LABEL: Record<string, string> = {
  matched: 'Selected: matched by the method',
  neighbor: 'Selected: added by a graph operator',
  indirect: 'Selected: test added by indirect selection',
  excluded: 'Removed by --exclude',
  filtered: 'Selected, then hidden by the resource type filter',
  none: 'Not selected',
};

interface Props {
  project: Project;
  id: string | null;
  info: NodeInfoState | undefined;
  onPick: (id: string) => void;
  onClose?: () => void;
}

export default function Details({ project, id, info, onPick, onClose }: Props) {
  if (!id || !project.nodes.has(id)) {
    return (
      <aside className="msl-details" aria-label="Node details">
        <h3>Node details</h3>
        <p className="msl-muted">Click a node (or press Enter on it) to see its type, file, tags and why it is selected.</p>
      </aside>
    );
  }
  const n = project.get(id);
  const st = info?.state ?? 'none';
  const parents = [...(project.parents.get(id) ?? [])].sort();
  const children = [...(project.children.get(id) ?? [])].sort();
  const cfg = project.config(id);
  const list = (ids: string[]) => (ids.length ? (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {ids.slice(0, 30).map((x) => <li key={x}><button type="button" className="msl-linkbtn" onClick={() => onPick(x)}>{displayName(project.get(x))}</button></li>)}
      {ids.length > 30 && <li className="msl-muted">and {ids.length - 30} more</li>}
    </ul>
  ) : <span className="msl-muted">none</span>);
  return (
    <aside className="msl-details" aria-label="Node details" aria-live="polite">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <h3>{displayName(n)}</h3>
        {onClose && <button type="button" className="msl-btn msl-btn-small" onClick={onClose} aria-label="Close the node details">Close</button>}
      </div>
      <span className={`msl-pill ${st}`}>{STATE_LABEL[st]}</span>
      {info && info.why.length > 0 && (
        <p className="msl-why">Brought by: {info.why.map((w, i) => (
          <span key={w}>{i > 0 && ', '}<code>{w}</code> ({info.how[i] === 'method' ? 'the method matches it' : info.how[i] === 'graph' ? 'graph operator' : 'indirect selection'})</span>
        ))}</p>
      )}
      <dl>
        <dt>Type</dt><dd>{typeWord(n)}</dd>
        <dt>dbt ls</dt><dd><code>{n.ls}</code></dd>
        <dt>File</dt><dd><code>{n.original_file_path}</code></dd>
        {n.patch_path && <><dt>YAML</dt><dd><code>{n.patch_path}</code></dd></>}
        {n.resource_type === 'model' && <><dt>Materialized</dt><dd>{String(cfg.materialized ?? '')}</dd></>}
        {n.tags.length > 0 && <><dt>Tags</dt><dd>{n.tags.join(', ')}</dd></>}
        {(n.group || typeof cfg.group === 'string') ? <><dt>Group</dt><dd>{String(n.group ?? cfg.group)}</dd></> : null}
        {n.access && n.resource_type === 'model' && <><dt>Access</dt><dd>{n.access}</dd></>}
        {n.version !== null && n.version !== undefined && n.resource_type === 'model' && <><dt>Version</dt><dd>v{String(n.version)} (latest: v{String(n.latest_version)})</dd></>}
        <dt>Package</dt><dd>{n.package_name}</dd>
        <dt>Unique ID</dt><dd><code>{n.unique_id}</code></dd>
      </dl>
      <h4 className="msl-small">Parents</h4>
      {list(parents)}
      <h4 className="msl-small" style={{ marginTop: 8 }}>Children</h4>
      {list(children)}
    </aside>
  );
}
