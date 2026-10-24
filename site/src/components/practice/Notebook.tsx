// Error notebook: one entry per missed question (written by quizzes and mocks) plus your own notes.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Note } from '../../lib/store/db';
import { url } from '../../lib/url';

export default function Notebook() {
  const notes = useLiveQuery(() => db().notes.orderBy('updatedAt').reverse().toArray(), [], [] as Note[]);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'all' | 'error' | 'personal' | 'explain'>('all');
  const shown = notes.filter((n) => filter === 'all' || n.kind === filter);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const now = Date.now();
    await db().notes.put({ id: `note:${now}`, kind: 'personal', text: t, createdAt: now, updatedAt: now });
    setText('');
  }
  async function edit(n: Note, value: string) { await db().notes.put({ ...n, text: value, updatedAt: Date.now() }); }
  async function remove(n: Note) { if (confirm('Delete this note?')) await db().notes.delete(n.id); }

  const refHref = (ref?: string) => {
    if (!ref) return undefined;
    const q = ref.match(/^q-(ch\d+)-/); if (q) return url(`quiz/${q[1]}/#${ref}`);
    const m = ref.match(/^m(\d)-q\d+$/); if (m) return url(`exams/mock${m[1]}/`);
    if (/^ch\d+$/.test(ref)) return url(`learn/${ref}/`);
    return undefined;
  };

  return (
    <div className="nb">
      <form className="nb-add panel" onSubmit={add}>
        <label htmlFor="nb-new">Add a note in your own words</label>
        <textarea id="nb-new" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: --empty limits ref() and source(), not tables written by hand." />
        <button className="btn btn-primary btn-small" type="submit">Save note</button>
      </form>
      <div className="seg" role="group" aria-label="Show">
        {([['all', 'All'], ['error', 'Missed questions'], ['explain', 'Explain it back'], ['personal', 'My notes']] as const).map(([v, l]) => (
          <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      {shown.length === 0 && <p className="nb-empty">{filter === 'error' || notes.length === 0 ? 'No entries yet. When you miss a quiz or mock question, it appears here with a link to review it.' : 'Nothing in this view.'}</p>}
      <ul className="nb-list">
        {shown.map((n) => (
          <li key={n.id} className={`panel nb-item nb-${n.kind}`}>
            <p className="nb-meta">
              <span className="pill pill-muted">{n.kind === 'error' ? 'Missed question' : n.kind === 'explain' ? 'Explain it back' : 'My note'}</span>
              {refHref(n.ref) && <a href={refHref(n.ref)}>{n.ref}</a>}
              <span className="nb-date">{new Date(n.updatedAt).toLocaleDateString()}</span>
            </p>
            <textarea aria-label="Note text" defaultValue={n.text} rows={Math.min(8, Math.max(2, Math.ceil(n.text.length / 80)))} onBlur={(e) => e.target.value !== n.text && edit(n, e.target.value)} />
            <button type="button" className="nb-del" onClick={() => remove(n)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
