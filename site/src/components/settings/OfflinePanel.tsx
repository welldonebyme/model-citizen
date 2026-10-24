// Settings section: save the whole course in this browser so it works without a connection (lib/offline.ts).
import { useEffect, useRef, useState } from 'react';
import { fetchManifest, offlineStatus, removeOffline, saveOffline, type OfflineStatus } from '../../lib/offline';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;

export default function OfflinePanel() {
  const [st, setSt] = useState<OfflineStatus | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = async () => setSt(await offlineStatus());
  useEffect(() => {
    refresh();
    fetchManifest().then((m) => { setSize(m.bytes); setLatest(m.version); }).catch(() => setSize(null));
  }, []);

  async function save() {
    setMsg(null);
    abort.current = new AbortController();
    try {
      const failed = await saveOffline((done, total) => setBusy({ done, total }), abort.current.signal);
      setMsg(abort.current.signal.aborted ? 'Stopped. What was saved stays saved; save again to finish.'
        : failed ? `Saved, except ${failed} files that could not be downloaded. Try again later.` : 'Saved. The course now works in this browser without a connection.');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(null);
    refresh();
  }
  async function remove() {
    abort.current?.abort();
    await removeOffline();
    setMsg('The offline copy is deleted.');
    refresh();
  }

  if (!st) return null;
  const outdated = st.on && latest && st.savedVersion !== latest;
  return (
    <section className="panel st-sec" aria-labelledby="off-h">
      <h2 id="off-h">Offline</h2>
      {!st.supported ? <p>This browser cannot keep an offline copy of the course.</p> : (
        <>
          <p>Save every lesson, quiz and mock exam in this browser, so you can study without internet (on a train, or with a poor connection). {size ? `It takes about ${mb(size)}.` : ''} The labs that run dbt or SQL in the browser download their engine the first time you start them, and keep it too.</p>
          {st.on && <p className="st-ok">{outdated ? 'An offline copy is saved, but the course has changed since: save again to update it.' : 'An offline copy is saved in this browser.'}</p>}
          <div className="st-row">
            <button type="button" className="btn btn-primary btn-small" onClick={save} disabled={!!busy}>{st.on ? 'Save again (update)' : 'Save the course for offline use'}</button>
            {busy && <button type="button" className="btn btn-quiet btn-small" onClick={() => abort.current?.abort()}>Stop</button>}
            {st.on && !busy && <button type="button" className="btn btn-quiet btn-small" onClick={remove}>Delete the offline copy</button>}
          </div>
          {busy && (
            <div className="st-progress">
              <progress max={busy.total} value={busy.done} aria-label="Saving the course" />
              <span role="status">{busy.done} of {busy.total} files</span>
            </div>
          )}
          {msg && <p role="status" className="st-muted">{msg}</p>}
        </>
      )}
    </section>
  );
}
