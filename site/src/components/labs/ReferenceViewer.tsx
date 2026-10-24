// Browse the reference projects at any chapter tag (practice project) or milestone (capstone),
// and see what each chapter changed. Data: public/reference/<repo>/<tag>.json and diff-<prev>-<tag>.json.
import { useEffect, useMemo, useState } from 'react';
import { highlight, type Lang } from '../../lib/highlight';
import { url } from '../../lib/url';

export interface TagInfo { tag: string; prev: string | null; message: string; subject: string }
export interface RepoInfo { id: 'jaffle' | 'shopflow'; name: string; label: string; tags: TagInfo[]; spoiler: boolean }

interface FileEntry { path: string; size: number; binary: boolean; content?: string; lines?: number }
interface TagFile { tag: string; tag_message?: string; subject?: string; files: FileEntry[] }
interface Hunk { old_start: number; old_lines: number; new_start: number; new_lines: number; section?: string; lines: string[] }
interface DiffFile { path: string; old_path?: string; status: 'added' | 'removed' | 'deleted' | 'modified' | 'renamed'; binary: boolean; hunks: Hunk[] }
interface DiffJson { files: DiffFile[]; stats?: Record<string, number> }

const LANG_BY_EXT: Record<string, Lang> = { sql: 'dbt', yml: 'yaml', yaml: 'yaml', py: 'python', sh: 'bash', md: 'plain', csv: 'plain', txt: 'plain' };
const langOf = (p: string): Lang => LANG_BY_EXT[p.split('.').pop() ?? ''] ?? 'plain';

function readParams() {
  const q = new URLSearchParams(location.search);
  return { repo: q.get('repo'), tag: q.get('tag'), view: q.get('view'), file: q.get('file') };
}

export default function ReferenceViewer({ repos }: { repos: RepoInfo[] }) {
  const init = typeof location !== 'undefined' ? readParams() : { repo: null, tag: null, view: null, file: null };
  const [repoId, setRepoId] = useState<RepoInfo['id']>((init.repo as RepoInfo['id']) || 'jaffle');
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];
  const [tag, setTag] = useState<string>(init.tag && repo.tags.some((t) => t.tag === init.tag) ? init.tag : repo.tags[1]?.tag ?? repo.tags[0]?.tag);
  const [view, setView] = useState<'diff' | 'files'>(init.view === 'files' ? 'files' : 'diff');
  const [file, setFile] = useState<string | null>(init.file);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [data, setData] = useState<{ tree?: TagFile; diff?: DiffJson; error?: string }>({});
  const info = repo.tags.find((t) => t.tag === tag);
  const hidden = repo.spoiler && !revealed[`${repo.id}:${tag}`];

  useEffect(() => {
    const q = new URLSearchParams({ repo: repo.id, tag, view, ...(file ? { file } : {}) });
    history.replaceState(null, '', `?${q}`);
  }, [repo.id, tag, view, file]);

  useEffect(() => {
    if (hidden) return;
    let off = false;
    setData({});
    const base = url(`reference/${repo.id}/`);
    const wants = view === 'files' ? fetch(`${base}${tag}.json`).then((r) => r.json()).then((tree: TagFile) => ({ tree }))
      : info?.prev ? fetch(`${base}diff-${info.prev}-${tag}.json`).then((r) => r.json()).then((diff: DiffJson) => ({ diff }))
      : fetch(`${base}${tag}.json`).then((r) => r.json()).then((tree: TagFile) => ({ tree, diff: { files: tree.files.map((f) => ({ path: f.path, status: 'added', binary: f.binary, hunks: f.content ? [{ old_start: 0, old_lines: 0, new_start: 1, new_lines: f.lines ?? 0, lines: f.content.replace(/\n$/, '').split('\n').map((l) => '+' + l) }] : [] })) } as DiffJson }));
    wants.then((d) => { if (!off) setData(d); }).catch(() => { if (!off) setData({ error: 'This reference file could not be loaded. Check your connection and reload the page.' }); });
    return () => { off = true; };
  }, [repo.id, tag, view, hidden, info?.prev]);

  const files = data.tree?.files ?? [];
  const selected = useMemo(() => files.find((f) => f.path === file) ?? files.find((f) => /models\//.test(f.path) && !f.binary) ?? files[0], [files, file]);

  return (
    <div className="rv">
      <div className="rv-bar">
        <div className="seg" role="group" aria-label="Project">
          {repos.map((r) => <button key={r.id} type="button" aria-pressed={r.id === repo.id} onClick={() => { setRepoId(r.id); setTag(r.tags[1]?.tag ?? r.tags[0].tag); setFile(null); }}>{r.label}</button>)}
        </div>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'diff'} onClick={() => setView('diff')}>What changed</button>
          <button type="button" aria-pressed={view === 'files'} onClick={() => setView('files')}>All files</button>
        </div>
      </div>

      <nav className="rv-tags" aria-label={`${repo.name} tags`}>
        {repo.tags.map((t) => (
          <button key={t.tag} type="button" aria-pressed={t.tag === tag} onClick={() => { setTag(t.tag); setFile(null); }} title={t.message}>{t.tag}</button>
        ))}
      </nav>

      <header className="rv-head">
        <h2><code className="mc-ic">{repo.name}</code> at tag <code className="mc-ic">{tag}</code></h2>
        {info && <p>{info.message || info.subject}</p>}
        <p className="rv-git">On your computer: <code className="mc-ic">git checkout {tag}</code> in your clone of <code className="mc-ic">{repo.name}.bundle</code> from the kit.</p>
      </header>

      {hidden ? (
        <div className="rv-spoiler panel">
          <h3>This is the solution of milestone {tag}</h3>
          <p>Try the milestone yourself first. Looking at the solution too early removes most of the learning.</p>
          <button type="button" className="btn btn-quiet" onClick={() => setRevealed((r) => ({ ...r, [`${repo.id}:${tag}`]: true }))}>Show the solution of {tag}</button>
        </div>
      ) : data.error ? (
        <p className="rv-error" role="alert">{data.error}</p>
      ) : view === 'diff' ? (
        <Diff diff={data.diff} from={info?.prev ?? null} />
      ) : (
        <div className="rv-files">
          <ul className="rv-tree" aria-label="Files">
            {files.map((f) => (
              <li key={f.path}><button type="button" aria-current={selected?.path === f.path ? 'true' : undefined} onClick={() => setFile(f.path)}>{f.path}</button></li>
            ))}
          </ul>
          <div className="rv-file">
            {selected && (selected.binary || selected.content == null
              ? <p className="rv-note">{selected.path} is a binary file ({selected.size} bytes).</p>
              : <figure className="mc-code mc-numbered"><figcaption className="mc-code-head"><span className="mc-code-label">{selected.path}</span></figcaption>
                  <pre className="mc-code-body"><code>{highlight(langOf(selected.path), selected.content.replace(/\n$/, '')).split('\n').map((l, i) => <span key={i} className="mc-ln"><span className="mc-n" aria-hidden="true">{i + 1}</span><span className="mc-lc" dangerouslySetInnerHTML={{ __html: l || ' ' }} /></span>)}</code></pre>
                </figure>)}
          </div>
        </div>
      )}
    </div>
  );
}

function Diff({ diff, from }: { diff?: DiffJson; from: string | null }) {
  if (!diff) return <p className="rv-note" aria-busy="true">Loading…</p>;
  if (!diff.files.length) return <p className="rv-note">No file changed in this tag.</p>;
  const label = { added: 'added', removed: 'deleted', deleted: 'deleted', modified: 'changed', renamed: 'renamed' } as const;
  return (
    <div className="rv-diff">
      <p className="rv-note">{from ? `Compared with ${from}: ` : 'First tag: every file is new. '}{diff.files.length} {diff.files.length === 1 ? 'file' : 'files'}.</p>
      <ul className="rv-summary">{diff.files.map((f) => <li key={f.path}><a href={`#d-${f.path}`}><span className={`rv-st rv-${f.status}`}>{label[f.status]}</span> {f.path}</a></li>)}</ul>
      {diff.files.map((f) => (
        <section key={f.path} id={`d-${f.path}`} className="rv-dfile">
          <h3><span className={`rv-st rv-${f.status}`}>{label[f.status]}</span> <code>{f.old_path && f.old_path !== f.path ? `${f.old_path} → ` : ''}{f.path}</code></h3>
          {f.binary ? <p className="rv-note">Binary file.</p> : f.hunks.map((h, i) => (
            <pre key={i} className="rv-hunk"><code>
              <span className="rv-hh">@@ -{h.old_start},{h.old_lines} +{h.new_start},{h.new_lines} @@ {h.section}</span>{'\n'}
              {h.lines.map((l, j) => <span key={j} className={l[0] === '+' ? 'rv-add' : l[0] === '-' ? 'rv-del' : 'rv-ctx'}>{l}{'\n'}</span>)}
            </code></pre>
          ))}
        </section>
      ))}
    </div>
  );
}
