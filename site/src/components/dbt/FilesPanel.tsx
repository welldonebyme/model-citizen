// File tree + editor of the workspace. The tree reads the virtual file system through the engine; the editor
// (CodeMirror) is loaded the first time a file is opened.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { DbtEngine } from '../../lib/dbt/client';
import type { FileEntry } from '../../lib/dbt/types';

const CodeEditor = lazy(() => import('./CodeEditor'));

type Entry = FileEntry & { display: string };

interface Props {
  engine: DbtEngine;
  home: string;             // "/home/pyodide"
  projectDir: string | null; // absolute path of the project, expanded at first
  refreshKey: number;       // changes after every command
  openRequest?: { path: string; n: number } | null;
  onStatus(text: string): void;
  layout: 'column' | 'wide';
}

const GENERATED = /\/(target|logs|dbt_packages)(\/|$)/;

function Tree({ engine, dir, depth, expanded, toggle, selected, onSelect, refreshKey }: {
  engine: DbtEngine; dir: string; depth: number; expanded: Set<string>; toggle(p: string): void;
  selected: string | null; onSelect(p: string): void; refreshKey: number;
}) {
  const [items, setItems] = useState<Entry[] | null>(null);
  useEffect(() => {
    let alive = true;
    engine.list(dir).then((r) => { if (alive) setItems(r.filter((e) => e.name !== '.user.yml')); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [engine, dir, refreshKey]);
  if (!items) return <p className="f-loading" style={{ paddingLeft: depth * 14 + 8 }}>Loading...</p>;
  if (!items.length) return <p className="f-empty" style={{ paddingLeft: depth * 14 + 8 }}>(empty)</p>;
  const sorted = [...items].sort((a, b) => (a.dir === b.dir ? (a.name < b.name ? -1 : 1) : a.dir ? -1 : 1));
  return (
    <ul className="f-list" role="list">
      {sorted.map((e) => (
        <li key={e.path}>
          {e.dir ? (
            <>
              <button type="button" className="f-item f-dir" aria-expanded={expanded.has(e.path)} onClick={() => toggle(e.path)} style={{ paddingLeft: depth * 14 + 8 }}>
                <span className="f-chev" aria-hidden="true" />{e.name}
              </button>
              {expanded.has(e.path) && <Tree engine={engine} dir={e.path} depth={depth + 1} expanded={expanded} toggle={toggle} selected={selected} onSelect={onSelect} refreshKey={refreshKey} />}
            </>
          ) : (
            <button type="button" className="f-item f-file" aria-current={selected === e.path ? 'true' : undefined} onClick={() => onSelect(e.path)} style={{ paddingLeft: depth * 14 + 22 }}>
              {e.name}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FilesPanel({ engine, home, projectDir, refreshKey, openRequest, onStatus, layout }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([home + '/dbt-course', ...(projectDir ? [projectDir, projectDir + '/models'] : [])]));
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; text?: string; binary?: boolean; size?: number; mtime?: number } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = draft !== null && file?.text !== undefined && draft !== file.text;

  const toggle = useCallback((p: string) => setExpanded((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }), []);

  const open = useCallback(async (path: string) => {
    if (dirty && !window.confirm('Your changes to this file are not saved. Open the other file anyway?')) return;
    setSelected(path);
    setMessage(null);
    try {
      const r = await engine.read(path);
      setFile({ path: r.path, text: r.text, binary: r.binary, size: r.size, mtime: r.mtime });
      setDraft(r.text ?? null);
    } catch (e) {
      setFile(null);
      setMessage((e as Error).message);
    }
  }, [engine, dirty]);

  useEffect(() => {
    if (!openRequest) return;
    const parts = openRequest.path.split('/');
    setExpanded((s) => { const n = new Set(s); for (let i = 2; i < parts.length; i++) n.add(parts.slice(0, i).join('/')); return n; });
    void open(openRequest.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.n]);

  // after a command: reload the open file if it changed and the learner has no unsaved change
  useEffect(() => {
    if (!file || dirty) return;
    engine.read(file.path).then((r) => {
      if (r.text !== undefined && r.text !== file.text) { setFile({ ...file, text: r.text, mtime: r.mtime }); setDraft(r.text); }
    }).catch(() => { setFile(null); setMessage('This file does not exist any more.'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const save = useCallback(async () => {
    if (!file || draft === null) return;
    setSaving(true);
    try {
      const r = await engine.write(file.path, draft);
      setFile({ ...file, text: draft, mtime: r.mtime });
      const name = file.path.split('/').pop();
      setMessage(`Saved ${name}`);
      onStatus(`Saved ${name}`);
    } catch (e) {
      setMessage(`Not saved: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [engine, file, draft, onStatus]);

  const shown = file ? file.path.replace(home, '~') : '';
  const generated = file ? GENERATED.test(file.path) : false;
  return (
    <div className={`f-panel f-${layout}`}>
      <nav className="f-tree" aria-label="Files of the workspace">
        <div className="f-tree-head">~ (home folder)</div>
        <Tree engine={engine} dir={home} depth={0} expanded={expanded} toggle={toggle} selected={selected} onSelect={open} refreshKey={refreshKey} />
      </nav>
      <div className="f-editor">
        {file ? (
          <>
            <div className="f-editor-bar">
              <span className="f-path" title={file.path}>{shown}{dirty ? <span className="f-dirty"> (not saved)</span> : null}</span>
              {file.text !== undefined && (
                <button type="button" className="btn btn-small btn-ink" onClick={save} disabled={!dirty || saving} aria-keyshortcuts="Control+S Meta+S">{saving ? 'Saving...' : 'Save'}</button>
              )}
            </div>
            {generated && file.text !== undefined && <p className="f-note">dbt writes this folder: your changes are replaced the next time dbt runs.</p>}
            {file.text !== undefined ? (
              <Suspense fallback={<p className="f-loading">Loading the editor...</p>}>
                <CodeEditor key={file.path} path={file.path} text={file.text} onChange={setDraft} onSave={save} label={`Edit ${shown}`} />
              </Suspense>
            ) : (
              <p className="f-note">This is not a text file ({file.size} bytes), so it cannot be shown here. {file.path.endsWith('.duckdb') ? 'Query it in the terminal: duckdb ../practice/practice.duckdb -c "select ..."' : ''}</p>
            )}
            <p className="f-hint">Ctrl+S (or Cmd+S) saves. Tab indents. To leave the editor with the keyboard: Esc, then Tab.</p>
          </>
        ) : (
          <p className="f-placeholder">{message ?? 'Choose a file to read or edit it. Saved files are used by the next dbt command.'}</p>
        )}
        <p className="visually-hidden" role="status" aria-live="polite">{message ?? ''}</p>
      </div>
    </div>
  );
}
