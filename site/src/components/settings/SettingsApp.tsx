// Settings and the progress file (export / import). Everything stays in this browser.
import { useEffect, useRef, useState } from 'react';
import { db, getSettings, saveSettings, today, type Os, type Rhythm, type Settings } from '../../lib/store/db';
import { downloadProgress, importProgress, validateProgressFile, ImportError } from '../../lib/store/transfer';
import { RHYTHMS, calendar } from '../../lib/planner';
import OfflinePanel from './OfflinePanel';

function setLocal(key: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* not saved */ }
}
function getLocal(key: string) { try { return localStorage.getItem(key); } catch { return null; } }

export default function SettingsApp() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [theme, setTheme] = useState(getLocal('mc:theme') ?? 'system');
  const [size, setSize] = useState(getLocal('mc:size') ?? 'm');
  const [os, setOs] = useState<Os>((getLocal('mc:os') as Os) ?? (document.documentElement.dataset.os as Os) ?? 'mac');
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setS(await getSettings());
      setCounts({
        lessons: (await db().progress.where('kind').equals('lesson').toArray()).filter((r) => r.status === 'done').length,
        answers: await db().answers.count(),
        attempts: await db().examAttempts.count(),
        cards: await db().srs.count(),
        notes: await db().notes.count(),
      });
    } catch {
      setError('This browser does not let the site save data (private window or blocked storage). Your progress cannot be saved or exported here.');
    }
  }
  useEffect(() => { refresh(); }, []);

  async function patch(p: Partial<Settings>) { setS(await saveSettings(p)); }

  function applyTheme(v: string) {
    setTheme(v);
    if (v === 'system') { delete document.documentElement.dataset.theme; setLocal('mc:theme', null); }
    else { document.documentElement.dataset.theme = v; setLocal('mc:theme', v); }
  }
  function applySize(v: string) {
    setSize(v);
    if (v === 'm') { delete document.documentElement.dataset.size; setLocal('mc:size', null); }
    else { document.documentElement.dataset.size = v; setLocal('mc:size', v); }
  }
  function applyOs(v: Os) {
    setOs(v);
    document.documentElement.dataset.os = v;
    setLocal('mc:os', v);
    patch({ os: v });
  }

  async function onImport(file: File) {
    setMsg(null); setError(null);
    try {
      const parsed = validateProgressFile(JSON.parse(await file.text()));
      const r = await importProgress(parsed);
      // the computer chosen in the file applies here too (terminals, paths)
      const os = (await getSettings()).os;
      if (os) { setLocal('mc:os', os); document.documentElement.dataset.os = os; setOs(os); }
      setMsg(`Progress imported: ${r.added} new items, ${r.updated} updated, ${r.skipped} already here.`);
      refresh();
    } catch (e) {
      setError(e instanceof ImportError ? e.message : 'This file could not be read. Choose the .json file you exported from Model Citizen.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function resetAll() {
    if (!confirm('Delete all your progress in this browser? Export your progress file first if you want to keep it. This cannot be undone.')) return;
    await db().delete();
    // also the per-browser helpers (quiz sessions, timer, badges seen, hints opened...); reading preferences stay
    const KEEP = new Set(['mc:theme', 'mc:size', 'mc:os', 'mc:focus']);
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('mc:') && !KEEP.has(k)) localStorage.removeItem(k);
    } catch { /* storage blocked */ }
    location.reload();
  }

  if (error && !s) return <p className="st-error" role="alert">{error}</p>;
  if (!s) return <p aria-busy="true">Loading…</p>;

  return (
    <div className="st">
      <section className="panel st-sec" aria-labelledby="pf-h">
        <h2 id="pf-h">Your progress file</h2>
        <p>Your progress is saved only in this browser. To continue on another computer (or show a friend), export the file here and import it there. Importing adds to what is already here; it never deletes anything.</p>
        <p className="st-counts">In this browser: {counts.lessons ?? 0} lessons done, {counts.answers ?? 0} answers, {counts.attempts ?? 0} mock attempts, {counts.cards ?? 0} review cards, {counts.notes ?? 0} notes.</p>
        <div className="st-row">
          <button type="button" className="btn btn-primary" onClick={() => downloadProgress().then(() => setMsg('Progress file downloaded. Keep it in a safe place, for example your Documents folder.'))}>Export progress file</button>
          <label className="btn btn-quiet st-file">Import progress file<input ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} /></label>
        </div>
        {msg && <p className="st-ok" role="status">{msg}</p>}
        {error && <p className="st-error" role="alert">{error}</p>}
      </section>

      <section className="panel st-sec" aria-labelledby="pl-h">
        <h2 id="pl-h">Your plan</h2>
        <label className="st-field"><span>First name (shown on the Today page)</span><input value={s.name ?? ''} maxLength={40} onChange={(e) => patch({ name: e.target.value || undefined })} /></label>
        <fieldset className="st-field">
          <legend>Rhythm</legend>
          {(Object.keys(RHYTHMS) as Rhythm[]).map((k) => (
            <label key={k} className="st-radio"><input type="radio" name="rhythm" checked={s.rhythm === k} onChange={() => patch({ rhythm: k })} /> <span><b>{RHYTHMS[k].label}</b>, {RHYTHMS[k].hoursPerDay}, {calendar(k).length} weeks</span></label>
          ))}
        </fieldset>
        <div className="st-grid2">
          <label className="st-field"><span>Plan start date (day 1)</span><input type="date" value={s.startDate ?? ''} onChange={(e) => patch({ startDate: e.target.value || undefined })} /></label>
          <label className="st-field"><span>Exam date</span><input type="date" value={s.examDate ?? ''} onChange={(e) => patch({ examDate: e.target.value || undefined })} /></label>
        </div>
        <label className="st-field"><span>Daily study goal, in minutes (the line on the Progress page's study-time chart)</span><input type="number" min={15} max={480} step={15} value={s.dailyMinutes} onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 15 && v <= 480) patch({ dailyMinutes: v }); }} /></label>
        <label className="st-check"><input type="checkbox" checked={!!s.notebookReread} onChange={(e) => patch({ notebookReread: e.target.checked ? today() : undefined })} /> I have re-read my whole error notebook {s.notebookReread && <span className="st-muted">(on {s.notebookReread})</span>}</label>
      </section>

      <section className="panel st-sec" aria-labelledby="rd-h">
        <h2 id="rd-h">Reading</h2>
        <div className="st-field"><span>Your computer (for terminal commands)</span>
          <div className="seg" role="group" aria-label="Your computer">
            {(['mac', 'win', 'wsl'] as Os[]).map((v) => <button key={v} type="button" aria-pressed={os === v} onClick={() => applyOs(v)}>{{ mac: 'macOS', win: 'Windows', wsl: 'WSL' }[v]}</button>)}
          </div>
        </div>
        <div className="st-field"><span>Theme</span>
          <div className="seg" role="group" aria-label="Theme">
            {[['system', 'Like my computer'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => <button key={v} type="button" aria-pressed={theme === v} onClick={() => applyTheme(v)}>{l}</button>)}
          </div>
        </div>
        <div className="st-field"><span>Text size</span>
          <div className="seg" role="group" aria-label="Text size">
            {[['s', 'Small'], ['m', 'Normal'], ['l', 'Large'], ['xl', 'Extra large']].map(([v, l]) => <button key={v} type="button" aria-pressed={size === v} onClick={() => applySize(v)}>{l}</button>)}
          </div>
        </div>
      </section>

      <section className="panel st-sec" aria-labelledby="ex-h">
        <h2 id="ex-h">Mock exams</h2>
        <label className="st-check"><input type="checkbox" checked={s.domcEarlyEnd} onChange={(e) => patch({ domcEarlyEnd: e.target.checked })} /> DOMC: end a question as soon as its result is known (like the real exam)</label>
        <label className="st-check"><input type="checkbox" checked={s.domcExtraOption} onChange={(e) => patch({ domcExtraOption: e.target.checked })} /> DOMC: sometimes show one more option after the question is decided (like the real exam), so where a question ends does not tell you when it was decided</label>
        <label className="st-check"><input type="checkbox" checked={!!s.examPauseOnClose} onChange={(e) => patch({ examPauseOnClose: e.target.checked || undefined })} /> Pause the timer when I close the page (on the real exam, the time keeps passing: leave this off to practise like the real exam)</label>
      </section>

      <OfflinePanel />

      <section className="panel st-sec st-danger" aria-labelledby="dz-h">
        <h2 id="dz-h">Start again</h2>
        <p>Deletes all progress saved in this browser. Export your progress file first if you want to keep it.</p>
        <button type="button" className="btn btn-quiet" onClick={resetAll}>Delete my progress in this browser</button>
      </section>
    </div>
  );
}
