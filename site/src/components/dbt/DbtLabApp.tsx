// The standalone page /labs/dbt/: choose a chapter and a starting point, then the wide workspace.
import { useEffect, useMemo, useState } from 'react';
import { loadPresets, workspaceFor } from '../../lib/dbt/client';
import { deleteWorkspace, listMeta } from '../../lib/dbt/persist';
import type { PresetIndex, WorkspaceMeta } from '../../lib/dbt/types';
import DbtWorkspace from './DbtWorkspace';

const DEFAULT = 'ch07-start';

function readPreset(): string {
  if (typeof location === 'undefined') return DEFAULT;
  const p = new URLSearchParams(location.search).get('preset');
  return p && /^(ch\d\d|m\d\d)-(start|end)$/.test(p) ? p : DEFAULT;
}

export default function DbtLabApp() {
  const [index, setIndex] = useState<PresetIndex | null>(null);
  const [preset, setPreset] = useState<string>(DEFAULT);
  const [saved, setSaved] = useState<WorkspaceMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreset(readPreset());
    loadPresets().then(setIndex).catch((e) => setError(e.message));
    const refresh = () => listMeta().then(setSaved).catch(() => setSaved([]));
    void refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, []);

  // one entry per chapter (ch06..ch25) and per capstone milestone (m00..m14)
  const units = useMemo(() => {
    const m = new Map<string, { id: string; label: string; title: string; project: string }>();
    for (const p of index?.presets ?? []) {
      const id = p.id.split('-')[0];
      if (!m.has(id)) m.set(id, { id, label: p.label, title: p.chapterTitle, project: p.project });
    }
    return [...m.values()];
  }, [index]);

  const [chapter, state] = preset.split('-');
  const choose = (next: string) => {
    setPreset(next);
    try { history.replaceState(null, '', `?preset=${next}`); } catch { /* the address only helps to share a link */ }
  };
  const current = workspaceFor(preset);

  return (
    <div className="dbt-lab">
      <form className="dbt-picker" onSubmit={(e) => e.preventDefault()} aria-label="Choose the lab">
        <div className="dbt-picker-field">
          <label htmlFor="dbt-chapter">Chapter or capstone milestone</label>
          <select id="dbt-chapter" value={chapter} onChange={(e) => choose(`${e.target.value}-${state}`)}>
            <optgroup label="Practice project jaffle_dbt (Chapters 6 to 25)">
              {units.filter((u) => u.project === 'jaffle').map((u) => <option key={u.id} value={u.id}>{`${u.label}: ${u.title}`}</option>)}
            </optgroup>
            {units.some((u) => u.project === 'shopflow') && (
              <optgroup label="Capstone ShopFlow (Chapter 26)">
                {units.filter((u) => u.project === 'shopflow').map((u) => <option key={u.id} value={u.id}>{`${u.label}: ${u.title}`}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <fieldset className="dbt-picker-field">
          <legend>Start from</legend>
          <div className="seg" role="radiogroup" aria-label="Start from">
            <label className="dbt-radio"><input type="radio" name="dbt-state" value="start" checked={state === 'start'} onChange={() => choose(`${chapter}-start`)} /> the start</label>
            <label className="dbt-radio"><input type="radio" name="dbt-state" value="end" checked={state === 'end'} onChange={() => choose(`${chapter}-end`)} /> the end (the solution)</label>
          </div>
        </fieldset>
      </form>
      {error && <p className="dbt-error" role="alert">{error}</p>}
      <DbtWorkspace preset={preset} layout="wide" title="dbt workspace" />
      {saved.length > 0 && (
        <section className="dbt-saved" aria-labelledby="dbt-saved-title">
          <h2 id="dbt-saved-title">Saved in this browser</h2>
          <div className="mc-table-wrap"><table className="mc-table">
            <thead><tr><th scope="col">Workspace</th><th scope="col">Started from</th><th scope="col">Saved</th><th scope="col">Size</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {saved.sort((a, b) => (a.ws < b.ws ? -1 : 1)).map((m) => (
                <tr key={m.ws}>
                  <td>{m.ws.startsWith('shopflow-') ? `Capstone ${m.ws.slice(9)}` : m.ws.replace(/^jaffle-ch0?/, 'Chapter ')}</td>
                  <td>{index?.presets.find((p) => p.id === m.preset)?.title ?? m.preset}</td>
                  <td>{new Date(m.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{(m.bytes / 1e6).toFixed(1)} MB</td>
                  <td>
                    {m.ws === current ? <span className="dbt-muted">open above</span> : (
                      <button type="button" className="btn btn-small btn-quiet" onClick={async () => {
                        if (!window.confirm(`Delete the saved workspace "${m.ws}"? Its files and database are removed from this browser.`)) return;
                        await deleteWorkspace(m.ws);
                        setSaved((s) => s.filter((x) => x.ws !== m.ws));
                      }}>Delete<span className="visually-hidden"> {m.ws}</span></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
