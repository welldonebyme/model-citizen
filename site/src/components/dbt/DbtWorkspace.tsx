// <DbtWorkspace preset="ch07-start" />: real dbt in the browser, for a lesson's workspace column or a full page.
//
// Props
//   preset         required. A preset id of public/presets/dbt/index.json: "ch06-start" ... "ch25-end".
//   workspace      saved-work id. Default: one per chapter ("jaffle-ch07" for ch07-start and ch07-end).
//   layout         "column" (default, lesson right column: Terminal / Files / Help tabs) or "wide" (files | terminal).
//   title          heading of the workspace. Default "dbt workspace".
//   onMachineHref  link to the lab's on-machine steps, shown when the learner types git.
//   suggestions    commands offered as buttons above the terminal ("dbt build", ...).
//
// Code blocks (CodeBlock.tsx) whose commands start with "dbt " get a "Try in the browser terminal" button once a
// workspace is on the page; clicking it sends `mc:dbt-try` (detail: { commands: string[] }) to document. Any code
// can send that event: the workspace puts the first command in its prompt (it never runs it by itself).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DbtEngine, loadManifest, loadPresets, presetTitleFromId, workspaceFor, type OutputHandlers } from '../../lib/dbt/client';
import { listMeta } from '../../lib/dbt/persist';
import { dbtCommandLines } from '../../lib/dbt/commands';
import { TerminalModel, type TermBlock } from '../../lib/dbt/terminal-model';
import type { EngineManifest, Preset, PresetIndex, Progress, WorkspaceMeta } from '../../lib/dbt/types';
import { Terminal, type TerminalHandle } from './Terminal';
import { FilesPanel } from './FilesPanel';
import { HelpPanel, engineLabel } from './HelpPanel';
import './dbt.css';

export interface DbtWorkspaceProps {
  preset: string;
  workspace?: string;
  layout?: 'column' | 'wide';
  title?: string;
  onMachineHref?: string;
  suggestions?: string[];
}

type Phase = 'idle' | 'booting' | 'opening' | 'ready' | 'error';
type Tab = 'terminal' | 'files' | 'help';
const HOME = '/home/pyodide';

const STEPS: { phase: Progress['phase']; label: string }[] = [
  { phase: 'download', label: 'Download the engine' },
  { phase: 'python', label: 'Start Python' },
  { phase: 'packages', label: 'Install dbt-core, dbt-duckdb and their packages' },
  { phase: 'dbt', label: 'Start dbt' },
  { phase: 'prepare', label: 'Prepare the workspace (real commands)' },
];
const ORDER: Progress['phase'][] = ['download', 'python', 'packages', 'dbt', 'workspace', 'prepare', 'ready'];

const mb = (n: number) => (n / 1e6).toFixed(1);

function when(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Small or memory-limited devices: dbt needs 200 to 340 MB of memory here. */
function smallDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem !== undefined && mem <= 4) return true;
  return typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches && matchMedia('(pointer: coarse)').matches;
}

// one delegated listener for every "Try in the browser terminal" button of the page
let tryListener = false;
function installTryButtons() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLButtonElement>('[data-dbt-try][hidden]').forEach((b) => { b.hidden = false; });
  if (tryListener) return;
  tryListener = true;
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-dbt-try]');
    if (!b) return;
    let commands = (b.dataset.dbtTry ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    // the commands of the pane the learner sees: the Windows pane shows PowerShell forms, and a command can go
    // on over several lines (a quoted --inline query)
    const os = document.documentElement.dataset.os || 'mac';
    const panes = [...(b.closest('[data-code]')?.querySelectorAll<HTMLElement>('pre.mc-code-body') ?? [])];
    const pane = panes.find((p) => !p.dataset.osOnly || p.dataset.osOnly.split(' ').includes(os)) ?? panes[0];
    if (pane) {
      const shown = dbtCommandLines(pane.textContent ?? '');
      if (shown.length) commands = shown;
    }
    if (commands.length) document.dispatchEvent(new CustomEvent('mc:dbt-try', { detail: { commands } }));
  });
}

export default function DbtWorkspace({ preset: presetId, workspace, layout = 'column', title = 'dbt workspace', onMachineHref, suggestions = [] }: DbtWorkspaceProps) {
  const engine = useMemo(() => DbtEngine.shared(), []);
  const model = useMemo(() => new TerminalModel(), []);
  const term = useRef<TerminalHandle>(null);
  const root = useRef<HTMLElement>(null);
  const [manifest, setManifest] = useState<EngineManifest | null>(null);
  const [index, setIndex] = useState<PresetIndex | null>(null);
  const [phase, setPhase] = useState<Phase>(engine.state === 'ready' ? 'opening' : 'idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<WorkspaceMeta | null>(null);
  const [prompt, setPrompt] = useState({ short: '$', full: '' });
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('terminal');
  const [sideTab, setSideTab] = useState<'files' | 'help'>('files');
  const [queued, setQueued] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | 'start' | 'end'>(null);
  const [menu, setMenu] = useState(false);
  const [status, setStatus] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [openReq, setOpenReq] = useState<{ path: string; n: number } | null>(null);
  const [cols, setCols] = useState(100);
  const [noPersist, setNoPersist] = useState(false);
  const [small, setSmall] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const stopping = useRef(false);
  const ws = workspace ?? workspaceFor(presetId);
  const preset: Preset | undefined = index?.presets.find((p) => p.id === presetId);
  const project = preset && index ? index.projects[preset.project] : undefined;
  const chapterId = presetId.split('-')[0];
  const unit = presetId.startsWith('m') ? 'milestone' : 'chapter';
  const unitLabel = preset?.label ?? (unit === 'milestone' ? `Capstone ${chapterId}` : `Chapter ${Number(chapterId.slice(2))}`);

  useEffect(() => {
    loadManifest().then(setManifest).catch((e) => setError(e.message));
    loadPresets().then(setIndex).catch((e) => setError(e.message));
    engine.isCached().then(setCached);
    listMeta().then((all) => setSaved(all.find((m) => m.ws === ws && m.state === 'ready') ?? null)).catch(() => setSaved(null));
    installTryButtons();
    setSmall(smallDevice());
  }, [engine, ws]);

  // commands sent by the lesson's code blocks
  useEffect(() => {
    const on = (e: Event) => {
      const cmds = ((e as CustomEvent).detail?.commands ?? []) as string[];
      if (!cmds.length) return;
      setQueued(cmds);
      setTab('terminal');
      root.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (engine.state === 'ready') term.current?.setInput(cmds[0]);
    };
    document.addEventListener('mc:dbt-try', on);
    return () => document.removeEventListener('mc:dbt-try', on);
  }, [engine]);

  // terminal width in characters (for DuckDB tables)
  useEffect(() => {
    const el = root.current?.querySelector('.t-screen');
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const fs = parseFloat(getComputedStyle(el).fontSize) || 13;
      setCols(Math.max(40, Math.floor((entry.contentRect.width - 24) / (fs * 0.6))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase, tab, layout]);

  const handlersFor = useCallback((block: TermBlock): OutputHandlers => ({
    line: (kind, text) => model.append(block, kind, text),
    note: (n) => model.append(block, 'note', n.text, n),
    cmd: (text) => model.append(block, 'cmd', text),
    clear: () => model.clear(),
  }), [model]);

  const sys = useCallback((text: string) => {
    const b = model.start({});
    model.append(b, 'sys', text);
    model.end(b);
  }, [model]);

  const note = useCallback((text: string, tone: 'info' | 'warn' | 'error' | 'ok' = 'info') => {
    const b = model.start({});
    model.append(b, 'note', text, { text, tone });
    model.end(b);
  }, [model]);

  const openWorkspace = useCallback(async (mode: 'continue' | 'reset', which: string, idxArg?: PresetIndex) => {
    const idx = idxArg ?? index;
    if (!idx) return;
    const p = idx.presets.find((x) => x.id === which);
    if (!p) { setError(`Unknown preset ${which}`); setPhase('error'); return; }
    setPhase('opening');
    setError(null);
    let group: TermBlock | null = null;
    const lazyGroup = () => (group ??= model.start({ title: `How this workspace was prepared: ${p.title}` }));
    const r = await engine.open(ws, which, mode, {
      line: (k, t) => model.append(lazyGroup(), k, t),
      note: (n) => model.append(lazyGroup(), 'note', n.text, n),
      cmd: (t) => model.append(lazyGroup(), 'cmd', t),
    });
    if (group) model.end(group, r.ok ? 0 : 1);
    if (r.busy) {
      setError('This workspace is open in another tab or window. Close it there, then try again.');
      setPhase('error');
      return;
    }
    setNoPersist(r.persist === false);
    if (r.restored) {
      sys(`Your saved workspace for ${p.label} is back (saved ${when(r.meta!.updatedAt)}). It started from: ${idx.presets.find((x) => x.id === r.meta!.preset)?.title ?? r.meta!.preset}.`);
      if (r.presetChanged) note(`The starting files of this ${p.project === 'shopflow' ? 'milestone' : 'chapter'} were updated on the site since you started. Use "Reset" in the Workspace menu to get them (your changes would be replaced).`, 'warn');
    } else if (r.ok) {
      sys(`Ready: ${p.title}${p.chapterTitle ? ` (${p.chapterTitle})` : ''}. Prepared in ${((r.prepareMs ?? 0) / 1000).toFixed(1)} s.`);
      for (const s of p.summary) sys(`  ${s}`);
    } else {
      setError(`The preparation stopped at "${r.failed}". Open "How this workspace was prepared" in the terminal log to see why, then try again or reset.`);
      setPhase('error');
      return;
    }
    if (r.persist === false) note('This browser does not let the page save files (private window?). Your work is lost when you close the page.', 'warn');
    const h = r.meta?.history ?? [];
    setHistory(h);
    const cwd = r.meta?.cwd ?? HOME + '/dbt-course';
    setPrompt({ short: (cwd.split('/').pop() || '~') + ' $', full: cwd.replace(HOME, '~') });
    setSaved(r.meta ?? null);
    setRefreshKey((k) => k + 1);
    setPhase('ready');
    setTab('terminal');
    requestAnimationFrame(() => {
      if (queued.length) term.current?.setInput(queued[0]);
      else term.current?.focus();
    });
  }, [engine, index, model, note, queued, sys, ws]);

  const start = useCallback(async () => {
    setPhase('booting');
    setError(null);
    try {
      // the manifest or the presets could not be loaded on arrival (offline, no saved copy): try again now
      const [m, idx] = await Promise.all([manifest ?? loadManifest(), index ?? loadPresets()]);
      if (!manifest) setManifest(m);
      if (!index) setIndex(idx);
      await engine.boot((p) => setProgress(p));
      await openWorkspace('continue', saved?.preset ?? presetId, idx);
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }, [engine, index, manifest, openWorkspace, presetId, saved]);

  // the engine was already started by another workspace of this page: open directly
  useEffect(() => {
    if (engine.state === 'ready' && index && phase === 'opening' && !running) void openWorkspace('continue', saved?.preset ?? presetId).catch((e) => { setError(e.message); setPhase('error'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // the page changed the preset (standalone lab page): open that chapter
  const lastPreset = useRef(presetId);
  useEffect(() => {
    if (lastPreset.current === presetId) return;
    lastPreset.current = presetId;
    if (engine.state === 'ready' && phase === 'ready') {
      model.clear();
      listMeta().then((all) => {
        const m = all.find((x) => x.ws === ws && x.state === 'ready');
        // same chapter, other state ("start" -> "end"): replace only if asked
        if (m && m.preset !== presetId) setConfirm(presetId.endsWith('-end') ? 'end' : 'start');
        return openWorkspace('continue', m?.preset ?? presetId);
      }).catch((e) => { setError((e as Error).message); setPhase('error'); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  const run = useCallback(async (line: string) => {
    const trimmed = line.trim();
    if (/^(clear|cls|clear-host)$/i.test(trimmed)) { model.clear(); return; }
    const block = model.start({ prompt: prompt.short, command: line });
    if (!trimmed) { model.end(block, 0); return; }
    setHistory((h) => (h[h.length - 1] === line ? h : [...h, line]));
    if (trimmed === 'history') {
      history.forEach((h, i) => model.append(block, 'out', `${String(i + 1).padStart(5)}  ${h}`));
      model.end(block, 0);
      return;
    }
    setRunning(true);
    setStatus(`Running ${trimmed}`);
    stopping.current = false;
    try {
      const r = await engine.exec(line, { cols, onMachineHref }, handlersFor(block));
      model.end(block, r.code);
      setPrompt({ short: (r.cwd.split('/').pop() || '~') + ' $', full: r.prompt });
      const done = [...block.lines].reverse().find((l) => /^(\d\d:\d\d:\d\d\s+)?Done\. PASS=/.test(l.text));
      setStatus(`Finished${r.code ? ` with exit code ${r.code}` : ''}.${done ? ' ' + done.text.replace(/^\d\d:\d\d:\d\d\s+/, '') : ''}`);
      if (queued.length && queued[0] === trimmed) {
        const rest = queued.slice(1);
        setQueued(rest);
        if (rest.length) term.current?.setInput(rest[0]);
      }
    } catch (e) {
      model.end(block, 130);
      if (stopping.current) {
        const t = 'Stopped. The engine started again; your files and database are as they were after the last command that finished.';
        model.append(block, 'note', t, { text: t, tone: 'warn' });
        setStatus('Stopped');
      } else {
        const t = `The engine stopped: ${(e as Error).message}`;
        model.append(block, 'note', t, { text: t, tone: 'error' });
        setStatus('The engine stopped');
      }
    } finally {
      setRunning(false);
      setRefreshKey((k) => k + 1);
    }
  }, [cols, engine, handlersFor, history, model, onMachineHref, prompt.short, queued]);

  const stop = useCallback(async () => {
    if (!running || stopping.current) return;
    stopping.current = true;
    setStatus('Stopping');
    setRestarting(true);
    try {
      await engine.cancel();
      setStatus('Stopped. The terminal is ready again.');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    } finally {
      setRestarting(false);
      requestAnimationFrame(() => term.current?.focus());
    }
  }, [engine, running]);

  const doReset = useCallback(async (which: 'start' | 'end') => {
    setConfirm(null);
    setMenu(false);
    model.clear();
    try {
      await openWorkspace('reset', `${chapterId}-${which}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }, [chapterId, model, openWorkspace]);

  const exportZip = useCallback(async () => {
    setMenu(false);
    try {
      const blob = await engine.exportZip();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${project?.dir ?? 'project'}-${chapterId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setStatus('The project was downloaded as a zip file');
    } catch (e) {
      note(`Export failed: ${(e as Error).message}`, 'error');
    }
  }, [chapterId, engine, note, project?.dir]);

  const openFile = useCallback(async (path: string) => {
    const w = window.open('', '_blank');
    try {
      const r = await engine.read(path);
      const blob = new Blob([r.text ?? ''], { type: 'text/html' });
      const href = URL.createObjectURL(blob);
      if (w) w.location.href = href;
      else window.location.assign(href);
    } catch (e) {
      w?.close();
      note(`Cannot open ${path}: ${(e as Error).message}`, 'error');
    }
  }, [engine, note]);

  // close the menu with Escape
  useEffect(() => {
    if (!menu) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [menu]);

  const label = engineLabel(manifest);
  const downloadMb = manifest ? mb(manifest.groups.boot.gzip + manifest.groups.core.gzip) : '...';
  const diskMb = manifest ? mb(manifest.groups.boot.size + manifest.groups.core.size) : '...';
  const projectDir = project ? `${HOME}/dbt-course/${project.dir}` : null;
  const chips = [...queued, ...suggestions.filter((s) => !queued.includes(s))].slice(0, 6);

  const terminal = (
    <Terminal
      ref={term}
      model={model}
      prompt={prompt.short}
      promptTitle={prompt.full}
      running={running}
      disabled={phase !== 'ready' || restarting}
      history={history}
      onRun={run}
      onStop={stop}
      onOpenFile={openFile}
      status={status}
      label="Terminal"
    />
  );
  const files = phase === 'ready' ? (
    <FilesPanel engine={engine} home={HOME} projectDir={projectDir} refreshKey={refreshKey} openRequest={openReq} onStatus={setStatus} layout={layout} />
  ) : null;
  const help = <HelpPanel manifest={manifest} packages={project?.packages} />;

  return (
    <section className={`dbt-ws dbt-ws-${layout}`} ref={root} aria-label={title}>
      <header className="dbt-ws-head">
        <div className="dbt-ws-titles">
          <h2 className="dbt-ws-title">{title}</h2>
          <p className="dbt-ws-sub">{preset ? `${preset.title}${preset.chapterTitle ? `: ${preset.chapterTitle}` : ''}` : presetTitleFromId(presetId)}</p>
        </div>
        {phase === 'ready' && (
          <div className="dbt-ws-menu">
            <button type="button" className="btn btn-small btn-quiet" aria-expanded={menu} aria-controls={`${ws}-menu`} onClick={() => setMenu((m) => !m)}>Workspace</button>
            {menu && (
              <div className="dbt-menu" id={`${ws}-menu`} role="group" aria-label="Workspace actions">
                <button type="button" onClick={() => { setMenu(false); setConfirm('start'); }}>Reset to the start of this {unit}</button>
                <button type="button" onClick={() => { setMenu(false); setConfirm('end'); }}>Load the end of this {unit} (the solution)</button>
                <button type="button" onClick={exportZip}>Export the project (.zip)</button>
                {running && <button type="button" onClick={() => { setMenu(false); void stop(); }}>Stop the running command</button>}
              </div>
            )}
          </div>
        )}
      </header>
      <p className="dbt-ws-label"><span className="dbt-dot" aria-hidden="true" />{label}</p>

      {confirm && (
        <div className="dbt-confirm" role="alertdialog" aria-labelledby={`${ws}-confirm`}>
          <p id={`${ws}-confirm`}>
            {confirm === 'start'
              ? `Reset ${unitLabel} to its start? Your files and database in this workspace are replaced.`
              : `Load the end of ${unitLabel} (the reference project at its git tag)? Your files and database in this workspace are replaced.`}
          </p>
          <div className="dbt-confirm-actions">
            <button type="button" className="btn btn-small btn-primary" onClick={() => doReset(confirm)} autoFocus>{confirm === 'start' ? 'Reset' : 'Load the end'}</button>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {(phase === 'idle' || (phase === 'error' && engine.state !== 'ready')) && (
        <div className="dbt-start">
          <h3>Run real dbt in your browser</h3>
          <p>This workspace runs dbt-core with dbt-duckdb inside this page: nothing to install. Your files and the practice database stay in this browser.</p>
          {preset && (
            <div className="dbt-start-preset">
              <p><strong>{saved ? 'Your saved work:' : 'You start at:'}</strong> {saved ? `${index?.presets.find((x) => x.id === saved.preset)?.title ?? saved.preset}, saved ${when(saved.updatedAt)}. It opens where you left it.` : preset.title + '.'}</p>
              {!saved && <ul>{preset.summary.map((s) => <li key={s}>{s}</li>)}</ul>}
            </div>
          )}
          {manifest && (
            <p className="dbt-start-size">
              {cached ? 'Already downloaded: it starts from your browser\'s cache (a few seconds).' : `First start: about ${downloadMb} MB to download (${diskMb} MB once unpacked). Later starts use your browser's cache.`}
            </p>
          )}
          {small && (
            <p className="dbt-warn">This works best on a computer. dbt here needs about 300 MB of memory: on a phone or a small tablet it can be slow, or the page can reload. You can still try.</p>
          )}
          {queued.length > 0 && <p className="dbt-start-queued">After the start, this command is ready in the terminal: <code>{queued[0]}</code></p>}
          {error && <p className="dbt-error" role="alert">{error}</p>}
          <div className="dbt-start-actions">
            <button type="button" className="btn btn-primary" onClick={start} disabled={(!manifest || !index) && !error}>{error && (!manifest || !index) ? 'Try again' : 'Start dbt in your browser'}</button>
            {error && manifest && (
              <button type="button" className="btn btn-quiet" onClick={async () => {
                // a damaged download in the cache: remove the engine files kept by this browser, then start again
                try { for (const n of await caches.keys()) if (n.startsWith('mc-engines-')) await caches.delete(n); } catch { /* no Cache Storage */ }
                setCached(false);
                void start();
              }}>Download the engine again</button>
            )}
          </div>
        </div>
      )}

      {(phase === 'booting' || phase === 'opening') && (
        <div className="dbt-progress" aria-live="polite">
          <h3>{phase === 'booting' ? 'Starting dbt in your browser' : 'Opening the workspace'}</h3>
          <ProgressView progress={progress ?? engine.lastProgress} />
        </div>
      )}

      {phase === 'error' && engine.state === 'ready' && (
        <div className="dbt-start">
          <p className="dbt-error" role="alert">{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => openWorkspace('continue', presetId).catch((e) => setError(e.message))}>Try again</button>
          <button type="button" className="btn btn-quiet" onClick={() => setConfirm('start')}>Reset to the start of this {unit}</button>
        </div>
      )}

      <div className="dbt-ws-body" hidden={!(phase === 'ready' || ((phase === 'opening' || phase === 'error') && model.blocks.length > 0))}>
        {layout === 'column' ? (
          <>
            <Tabs ws={ws} tabs={[['terminal', 'Terminal'], ['files', 'Files'], ['help', 'What is different?']]} value={tab} onChange={(t) => setTab(t as Tab)} />
            <div role="tabpanel" id={`${ws}-panel-terminal`} aria-labelledby={`${ws}-tab-terminal`} hidden={tab !== 'terminal'} className="dbt-panel">
              {chips.length > 0 && <Chips chips={chips} onPick={(c) => term.current?.setInput(c)} />}
              {terminal}
            </div>
            <div role="tabpanel" id={`${ws}-panel-files`} aria-labelledby={`${ws}-tab-files`} hidden={tab !== 'files'} className="dbt-panel">{tab === 'files' && files}</div>
            <div role="tabpanel" id={`${ws}-panel-help`} aria-labelledby={`${ws}-tab-help`} hidden={tab !== 'help'} className="dbt-panel">{help}</div>
          </>
        ) : (
          <div className="dbt-wide">
            <div className="dbt-side">
              <Tabs ws={ws} tabs={[['files', 'Files'], ['help', 'What is different?']]} value={sideTab} onChange={(t) => setSideTab(t as 'files' | 'help')} />
              <div role="tabpanel" id={`${ws}-panel-files`} aria-labelledby={`${ws}-tab-files`} hidden={sideTab !== 'files'} className="dbt-panel">{files}</div>
              <div role="tabpanel" id={`${ws}-panel-help`} aria-labelledby={`${ws}-tab-help`} hidden={sideTab !== 'help'} className="dbt-panel">{help}</div>
            </div>
            <div className="dbt-main">
              {chips.length > 0 && <Chips chips={chips} onPick={(c) => term.current?.setInput(c)} />}
              {terminal}
            </div>
          </div>
        )}
        {noPersist && <p className="dbt-warn">Saving is not possible in this browser window: your work is lost when you close the page.</p>}
      </div>
    </section>
  );
}

function Chips({ chips, onPick }: { chips: string[]; onPick(c: string): void }) {
  return (
    <div className="dbt-chips">
      <span className="dbt-chips-label">From the lesson:</span>
      {chips.map((c) => <button key={c} type="button" className="dbt-chip" onClick={() => onPick(c)}><code>{c}</code></button>)}
    </div>
  );
}

function Tabs({ ws, tabs, value, onChange }: { ws: string; tabs: [string, string][]; value: string; onChange(v: string): void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j < 0) return;
    e.preventDefault();
    onChange(tabs[j][0]);
    refs.current[j]?.focus();
  };
  return (
    <div className="dbt-tabs" role="tablist" aria-label="Workspace views">
      {tabs.map(([id, text], i) => (
        <button
          key={id}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          id={`${ws}-tab-${id}`}
          aria-selected={value === id}
          aria-controls={`${ws}-panel-${id}`}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(e) => onKey(e, i)}
        >{text}</button>
      ))}
    </div>
  );
}

function ProgressView({ progress }: { progress: Progress | null }) {
  const p = progress;
  const at = p ? ORDER.indexOf(p.phase) : 0;
  const bytes = p?.total ? `${mb(p.loaded ?? 0)} of ${mb(p.total)} MB` : '';
  // one honest bar for the whole start: bytes while downloading, then the remaining steps
  const dl = p?.total ? (p.loaded ?? 0) / p.total : 0;
  const pct = !p ? 0
    : p.phase === 'download' ? 0.55 * dl
    : p.phase === 'python' ? 0.55 + 0.05 * dl
    : p.phase === 'packages' ? 0.6 + 0.1 * dl
    : p.phase === 'dbt' ? 0.75
    : p.phase === 'workspace' ? 0.9
    : p.phase === 'prepare' && p.steps ? 0.8 + 0.2 * ((p.step ?? 1) - 1) / p.steps
    : 1;
  return (
    <div className="dbt-prog">
      <progress max={100} value={Math.round(pct * 100)} aria-label={p ? `${p.label}${bytes ? ', ' + bytes : ''}` : 'Starting'} />
      <p className="dbt-prog-now">
        {p ? (p.phase === 'prepare' ? `Step ${p.step} of ${p.steps}: ${p.label}` : p.label) : 'Starting'}
        {p?.phase === 'download' && bytes ? ` (${bytes})` : ''}
      </p>
      <ol className="dbt-steps">
        {STEPS.map((s) => {
          const i = ORDER.indexOf(s.phase);
          const state = i < at ? 'done' : i === at ? 'now' : 'todo';
          return (
            <li key={s.phase} data-state={state}>
              <span className="visually-hidden">{state === 'done' ? 'Done: ' : state === 'now' ? 'Now: ' : 'Next: '}</span>
              {s.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
