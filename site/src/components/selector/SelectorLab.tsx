import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TAGS, loadProject } from '../../lib/selector/data';
import { explain } from '../../lib/selector/explain';
import { nodeStates } from '../../lib/selector/highlight';
import { compareLs, parseLsOutput } from '../../lib/selector/lsparse';
import type { Project } from '../../lib/selector/project';
import { scenariosFor } from '../../lib/selector/scenarios';
import { buildCommandLine, parseCommandLine, type Shell } from '../../lib/selector/cli';
import { runCommand, type CommandResult } from '../../lib/selector/tasks';
import { withDemoSelectors } from '../../lib/selector/demo-selectors';
import DagView from './DagView';
import Details from './Details';
import NodeList from './NodeList';
import Challenges from './Challenges';
import Facts from './Facts';
import { layoutDag } from './layout';
import { labelOf } from './labels';
import './selector.css';

const DEFAULT_PROJECT = 'jaffle-ch16';
const DEFAULT_CMD = 'dbt ls -s +fct_orders --resource-type model';

interface Example { cmd: string; title: string; trap?: boolean }
const EXAMPLES: Record<'jaffle' | 'shopflow', Example[]> = {
  jaffle: [
    { cmd: 'dbt ls -s +fct_orders --resource-type model', title: 'all parents' },
    { cmd: 'dbt ls -s fct_orders+ --resource-type model', title: 'all children' },
    { cmd: 'dbt ls -s 2+dim_customers --resource-type model', title: 'two levels up' },
    { cmd: 'dbt ls -s @int_orders__enriched --resource-type model', title: 'the @ operator' },
    { cmd: 'dbt ls -s "tag:staging,+fct_monthly_revenue" --resource-type model', title: 'intersection' },
    { cmd: 'dbt ls -s "tag:finance, tag:marketing" --resource-type model', title: 'comma + space trap', trap: true },
    { cmd: 'dbt ls -s tag:marts --exclude fct_orders+ --resource-type model', title: 'exclude a branch' },
    { cmd: 'dbt ls -s path:models/staging/stripe', title: 'path: with sources and tests' },
    { cmd: 'dbt ls -s source:stripe+ --resource-type model', title: 'below a source' },
    { cmd: 'dbt ls -s stg_jaffle_shop__*', title: 'zsh eats the star', trap: true },
    { cmd: 'dbt ls --selector nightly --resource-type model', title: 'YAML selector' },
    { cmd: 'dbt ls -s selector:nightly', title: 'not in 1.11', trap: true },
    { cmd: 'dbt ls --selector cli_union --resource-type model', title: 'YAML string trap (adds the book demo selectors)', trap: true },
    { cmd: 'dbt build -s stg_stripe__payments+', title: 'build order' },
    { cmd: 'dbt ls -s state:modified+ --state prod-artifacts', title: 'state (needs --state)', trap: true },
  ],
  shopflow: [
    { cmd: 'dbt ls -s +fct_orders --resource-type model', title: 'all parents' },
    { cmd: 'dbt ls -s tag:finance --resource-type model', title: 'a tag' },
    { cmd: 'dbt ls -s group:marketing', title: 'a group' },
    { cmd: 'dbt ls -s +exposure:weekly_revenue_dashboard --resource-type model', title: 'what an exposure needs' },
    { cmd: 'dbt ls --selector nightly --resource-type model', title: 'YAML selector' },
    { cmd: 'dbt build --selector ci_slim --state prod-artifacts', title: 'slim CI', trap: true },
    { cmd: 'dbt ls -s version:latest --resource-type model', title: 'latest versions' },
  ],
};

const SHELLS: { id: Shell; label: string }[] = [
  { id: 'zsh', label: 'zsh (macOS)' },
  { id: 'powershell', label: 'PowerShell (Windows)' },
  { id: 'bash', label: 'bash (Linux, WSL)' },
];

function readHash(): { p?: string; c?: string; s?: string } {
  try {
    const h = new URLSearchParams(window.location.hash.slice(1));
    return { p: h.get('p') ?? undefined, c: h.get('c') ?? undefined, s: h.get('state') ?? undefined };
  } catch { return {}; }
}

function tagTitle(id: string): string {
  const t = TAGS.find((x) => x.id === id);
  if (!t) return id;
  return t.key === 'jaffle' ? `Practice project, Chapter ${Number(t.tag.slice(2))}` : `Capstone, milestone ${Number(t.tag.slice(1))}`;
}

const TYPE_CHOICES = ['model', 'test', 'unit_test', 'source', 'seed', 'snapshot', 'exposure', 'analysis'];

export default function SelectorLab() {
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT);
  const [baseProject, setProject] = useState<Project | null>(null);
  const [demo, setDemo] = useState(false);
  const project = useMemo(() => (baseProject && demo ? withDemoSelectors(baseProject) : baseProject), [baseProject, demo]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cmd, setCmd] = useState(DEFAULT_CMD);
  const [shell, setShell] = useState<Shell>('zsh');
  const [scenarioId, setScenarioId] = useState<string>('prev-tag');
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [showTests, setShowTests] = useState(false);
  const [showAnalyses, setShowAnalyses] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  // first load: URL hash, phone = list view, Windows = PowerShell; later: links that change the hash
  useEffect(() => {
    const apply = () => {
      const h = readHash();
      if (h.p && TAGS.some((t) => t.id === h.p)) setProjectId(h.p);
      if (h.c) setCmd(h.c);
      if (h.s) { setScenarioId(h.s); urlScenario.current = h.s; }
    };
    if (!started.current) {
      started.current = true;
      apply();
      try {
        if (window.matchMedia('(max-width: 700px)').matches) setView('list');
        if (document.documentElement.dataset.os === 'win') setShell('powershell');
      } catch { /* ignore */ }
    }
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  useEffect(() => {
    let live = true;
    setProject(null);
    setLoadError(null);
    loadProject(projectId).then((p) => { if (live) { setProject(p); setPicked(null); } }, (e: Error) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [projectId]);

  useEffect(() => {
    try {
      const q = new URLSearchParams({ p: projectId, c: cmd });
      if (scenarioId !== 'prev-tag') q.set('state', scenarioId);
      history.replaceState(null, '', `#${q.toString()}`);
    } catch { /* ignore */ }
  }, [projectId, cmd, scenarioId]);

  const scenarios = useMemo(() => (project ? scenariosFor(project) : []), [project]);
  // a new project: the --state folder of the URL if it fits, else the chapter's own experiment (or the previous tag)
  const urlScenario = useRef<string | null>(null);
  useEffect(() => {
    if (!scenarios.length) return;
    const want = urlScenario.current;
    urlScenario.current = null;
    setScenarioId(want && scenarios.some((x) => x.id === want) ? want : scenarios[0].id);
  }, [scenarios]);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null;
  const previous = useMemo(() => (project && scenario ? scenario.build(project) : null), [project, scenario]);

  const result: CommandResult | null = useMemo(() => (project ? runCommand(project, cmd, { previous, shell }) : null), [project, cmd, previous, shell]);
  const states = useMemo(() => (result ? nodeStates(result) : new Map()), [result]);
  const lines = useMemo(() => (project && result ? explain(project, result) : []), [project, result]);

  const visible = useMemo(() => {
    if (!project) return [] as string[];
    return [...project.nodes.values()].filter((n) => {
      if (n.resource_type === 'test' || n.resource_type === 'unit_test') return showTests;
      if (n.resource_type === 'analysis') return showAnalyses;
      return true;
    }).map((n) => n.unique_id);
  }, [project, showTests, showAnalyses]);

  const layout = useMemo(() => {
    if (!project) return null;
    const set = new Set(visible);
    const edges: [string, string][] = [];
    for (const [a, cs] of project.children) if (set.has(a)) for (const b of cs) if (set.has(b)) edges.push([a, b]);
    return layoutDag(visible.map((id) => {
      const n = project.get(id);
      return { id, small: n.resource_type === 'test' || n.resource_type === 'unit_test', first: n.resource_type === 'source' };
    }), edges);
  }, [project, visible]);

  // the view moves to show what the selection touched: selected, hidden by --resource-type, or excluded
  const focusIds = useMemo(() => {
    if (!result || !layout) return [] as string[];
    return [...states.entries()].filter(([id, x]) => x.state !== 'none' && layout.nodes.has(id)).map(([id]) => id).sort();
  }, [result, layout, states]);

  const labeler = useCallback((id: string) => labelOf(project!, id), [project]);
  const isTest = useCallback((id: string) => { const t = project?.nodes.get(id)?.resource_type; return t === 'test' || t === 'unit_test'; }, [project]);

  /** open a command from a challenge or a fact: project, command, --state folder, demo selectors */
  const openCommand = (pid: string, command: string, scen?: string, demoOn?: boolean) => {
    if (scen) {
      setScenarioId(scen);
      urlScenario.current = pid === projectId ? null : scen;
    }
    if (demoOn !== undefined) setDemo(demoOn);
    setProjectId(pid);
    setCmd(command);
    setPicked(null);
    document.getElementById('msl-cmd')?.scrollIntoView({ block: 'center' });
  };

  const pick = (id: string) => {
    setPicked(id);
    const n = project?.nodes.get(id);
    if (n && (n.resource_type === 'test' || n.resource_type === 'unit_test') && !showTests) setShowTests(true);
    if (n && n.resource_type === 'analysis' && !showAnalyses) setShowAnalyses(true);
  };

  // structured fields <-> command line
  const parsed = useMemo(() => { try { return parseCommandLine(cmd, { shell: 'powershell' }); } catch { return null; } }, [cmd]);
  const fields = {
    command: parsed?.command ?? 'ls',
    select: parsed?.args.select?.join(' ') ?? '',
    exclude: parsed?.args.exclude?.join(' ') ?? '',
    selector: parsed?.args.selector ?? '',
    resourceTypes: parsed?.args.resourceTypes ?? [],
    excludeResourceTypes: parsed?.args.excludeResourceTypes ?? [],
    indirect: parsed?.args.indirectSelection ?? 'eager',
    output: parsed?.args.output ?? 'selector',
    state: !!parsed?.args.state,
    target: parsed?.args.target ?? 'dev',
  };
  const setField = (patch: Partial<typeof fields>) => setCmd(buildCommandLine({ ...fields, ...patch }));

  const terminalText = result ? [`$ ${cmd}`, ...result.terminal].join('\n') : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(terminalText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const tagGroups = [
    { label: 'Practice project jaffle_dbt (book chapters)', items: TAGS.filter((t) => t.key === 'jaffle') },
    { label: 'Capstone shopflow_dbt (milestones)', items: TAGS.filter((t) => t.key === 'shopflow') },
  ];
  // examples that make sense at this tag: traps always (if their nodes exist), others only when they select something
  const examples = useMemo(() => {
    if (!baseProject) return [] as Example[];
    const list = EXAMPLES[(baseProject.key as 'jaffle' | 'shopflow') ?? 'jaffle'];
    return list.filter((x) => {
      if (x.cmd.includes('--selector') && !baseProject.dag.selectors_yml) return false;
      if (x.trap) return !x.cmd.includes('--state') || !!baseProject.extras?.state_prev;
      const r = runCommand(baseProject, x.cmd, { shell: 'powershell', previous: null });
      return !r.error && r.selected.length > 0 && !r.logs.some((l) => l.text.includes('does not match'));
    });
  }, [baseProject]);
  const usesState = !!parsed?.args.state;

  const counts = useMemo(() => {
    if (!project || !result) return '';
    const c = new Map<string, number>();
    for (const id of [...result.selected, ...result.selectedUnitTests]) {
      const t = project.get(id).resource_type;
      c.set(t, (c.get(t) ?? 0) + 1);
    }
    return [...c.entries()].map(([t, n]) => `${n} ${t === 'unit_test' ? 'unit test' : t === 'analysis' ? 'analys' : t}${n === 1 ? (t === 'analysis' ? 'is' : '') : t === 'analysis' ? 'es' : 's'}`).join(', ');
  }, [project, result]);

  return (
    <div className="msl">
      <section className="msl-panel" aria-labelledby="msl-cmd-h">
        <div className="msl-controls">
          <h2 id="msl-cmd-h" className="visually-hidden">Command</h2>
          <form className="msl-cmd" onSubmit={(e) => e.preventDefault()} role="search" aria-label="Command line">
            <label htmlFor="msl-cmd" className="visually-hidden">dbt command</label>
            <input id="msl-cmd" className="msl-input" value={cmd} onChange={(e) => setCmd(e.target.value)} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" />
            <button type="button" className="msl-btn" onClick={() => setCmd(DEFAULT_CMD)}>Reset</button>
          </form>
          <div className="msl-examples" role="group" aria-label="Examples from the book">
            <span className="msl-legend">Try:</span>
            {examples.map((x) => <button key={x.cmd} type="button" className="msl-chip" onClick={() => { if (x.cmd.includes('--selector cli_')) setDemo(true); setCmd(x.cmd); }} title={x.title}>{x.cmd.replace(/^dbt /, '')}</button>)}
          </div>
          <div className="msl-row">
            <label className="msl-field">
              <span>Project (git tag)</span>
              <select className="msl-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {tagGroups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((t) => <option key={t.id} value={t.id}>{tagTitle(t.id)} (tag {t.tag}, {t.nodes + t.sources + t.exposures} nodes)</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="msl-field">
              <span>Shell</span>
              <select className="msl-select" value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
                {SHELLS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="msl-field">
              <span>The --state folder holds</span>
              <select className="msl-select" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                {scenarios.length === 0 && <option value="prev-tag">nothing (no earlier state for this tag)</option>}
                {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.origin})</option>)}
              </select>
            </label>
          </div>
          {scenario && usesState && (
            <p className="msl-state-note"><b>{scenario.origin === 'real' ? 'Real dbt 1.11.16 data.' : 'Simulated with the rules of dbt 1.11.16.'}</b> {scenario.description}</p>
          )}
          <details className="msl-fields">
            <summary>Build the command with fields</summary>
            <div className="msl-fields-grid">
              <label className="msl-field"><span>Command</span>
                <select className="msl-select" value={fields.command} onChange={(e) => setField({ command: e.target.value as typeof fields.command })}>
                  {['ls', 'build', 'run', 'test', 'seed', 'snapshot', 'compile'].map((c) => <option key={c} value={c}>dbt {c}</option>)}
                </select>
              </label>
              <label className="msl-field"><span>--select</span><input className="msl-input msl-mono" value={fields.select} onChange={(e) => setField({ select: e.target.value })} /></label>
              <label className="msl-field"><span>--exclude</span><input className="msl-input msl-mono" value={fields.exclude} onChange={(e) => setField({ exclude: e.target.value })} /></label>
              <label className="msl-field"><span>--selector (selectors.yml)</span>
                <select className="msl-select" value={fields.selector} onChange={(e) => setField({ selector: e.target.value })}>
                  <option value="">(none)</option>
                  {project?.selectorNames.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="msl-toggle"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} disabled={!baseProject?.dag.selectors_yml} /> Add the 4 demo selectors of Chapter 16 to selectors.yml (cli_union, cli_intersection, cli_parents, one_key)</label>
              <fieldset className="msl-fieldset"><legend className="msl-legend">--resource-type</legend>
                <div className="msl-checks">
                  {TYPE_CHOICES.map((t) => (
                    <label key={t}><input type="checkbox" checked={fields.resourceTypes.includes(t)} onChange={(e) => setField({ resourceTypes: e.target.checked ? [...fields.resourceTypes, t] : fields.resourceTypes.filter((x) => x !== t) })} />{t}</label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="msl-fieldset"><legend className="msl-legend">--exclude-resource-type</legend>
                <div className="msl-checks">
                  {TYPE_CHOICES.map((t) => (
                    <label key={t}><input type="checkbox" checked={fields.excludeResourceTypes.includes(t)} onChange={(e) => setField({ excludeResourceTypes: e.target.checked ? [...fields.excludeResourceTypes, t] : fields.excludeResourceTypes.filter((x) => x !== t) })} />{t}</label>
                  ))}
                </div>
              </fieldset>
              <label className="msl-field"><span>--indirect-selection</span>
                <select className="msl-select" value={fields.indirect} onChange={(e) => setField({ indirect: e.target.value as typeof fields.indirect })}>
                  {['eager', 'cautious', 'buildable', 'empty'].map((m) => <option key={m} value={m}>{m}{m === 'eager' ? ' (default)' : ''}</option>)}
                </select>
              </label>
              <label className="msl-field"><span>--output (dbt ls)</span>
                <select className="msl-select" value={fields.output} onChange={(e) => setField({ output: e.target.value as typeof fields.output })}>
                  {['selector', 'name', 'path', 'json'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="msl-field"><span>--target</span>
                <select className="msl-select" value={fields.target} onChange={(e) => setField({ target: e.target.value })}>
                  {['dev', 'prod', 'ci'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="msl-toggle"><input type="checkbox" checked={fields.state} onChange={(e) => setField({ state: e.target.checked })} /> --state (the folder chosen above)</label>
            </div>
          </details>
        </div>
      </section>

      <section className="msl-panel" aria-labelledby="msl-graph-h">
        <div className="msl-graph-head">
          <h2 id="msl-graph-h">{project ? `${project.name} at tag ${project.tag}` : 'Loading the project'}</h2>
          <div className="msl-tools">
            <div className="msl-seg" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>Graph</button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
            </div>
            <label className="msl-toggle"><input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} /> Tests</label>
            <label className="msl-toggle"><input type="checkbox" checked={showAnalyses} onChange={(e) => setShowAnalyses(e.target.checked)} /> Analyses</label>
          </div>
        </div>
        {loadError && <p className="msl-loading">The project could not be loaded: {loadError}</p>}
        {!project && !loadError && <p className="msl-loading">Loading the DAG of {tagTitle(projectId)}…</p>}
        {project && result && layout && (
          <>
            <div className={`msl-graph-body${picked ? ' with-details' : ''}`}>
              {view === 'graph'
                ? <DagView layout={layout} states={states} labelOf={labeler} picked={picked} onPick={pick} isTest={isTest} focus={focusIds} />
                : <NodeList project={project} ids={[...project.nodes.keys()]} states={states} picked={picked} onPick={pick} />}
              {picked && <Details project={project} id={picked} info={states.get(picked)} onPick={pick} onClose={() => setPicked(null)} />}
            </div>
            <div className="msl-keybar" aria-label="Legend">
              <span><i className="m" /> selected: matched by the method</span>
              <span><i className="n" /> selected: added by a graph operator or indirect selection</span>
              <span><i className="f" /> hidden by --resource-type</span>
              <span><i className="x" /> removed by --exclude</span>
              <span><i /> not selected</span>
              <span>Click a node (or Enter) for its details.{!showTests ? ' Tests are hidden: tick Tests to see them.' : ''}</span>
            </div>
          </>
        )}
      </section>

      {project && result && (
        <div className="msl-out-grid">
          <section className="msl-term" aria-labelledby="msl-term-h">
            <div className="msl-term-head">
              <h2 id="msl-term-h" style={{ fontSize: 'inherit', color: 'inherit', fontWeight: 600 }}>What dbt prints <span aria-hidden="true">·</span> <b>{result.error ? 'error' : result.command === 'ls' ? `${result.output.length} lines` : `${result.execution.filter((s) => s.index !== null).length} nodes, one thread`}</b></h2>
              <button type="button" className="msl-term-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <pre tabIndex={0} aria-label="Terminal output"><code>
              <span className="p">$ </span>{cmd}{'\n'}
              {result.terminal.map((l, i) => {
                const cls = /^\d\d:\d\d:\d\d {2}(The selection criterion|No nodes selected|Nothing to do|Warning|\[WARNING\]|Usage of)/.test(l) ? 'w'
                  : /Encountered an error|Error|zsh:/.test(l) && (result.error !== null) ? 'e' : /^\d\d:\d\d:\d\d/.test(l) ? 'd' : '';
                return <span key={i} className={cls}>{l}{'\n'}</span>;
              })}
            </code></pre>
          </section>
          <section className="msl-panel" aria-labelledby="msl-exp-h">
            <div className="msl-summary">
              <h2 id="msl-exp-h" style={{ fontSize: 'var(--fs-md)', width: '100%' }}>What this selection means</h2>
              {!result.error && <span><b>{result.selected.length + result.selectedUnitTests.length}</b> selected{counts ? `: ${counts}` : ''}</span>}
            </div>
            <ul className="msl-explain">
              {lines.map((l, i) => (
                <li key={i} style={{ paddingLeft: l.level * 16 }}>
                  <code title={l.part}>{l.part}</code>
                  <span>{l.text}</span>
                  {l.count && <span className="c">{l.count}</span>}
                </li>
              ))}
              {result.error && <li><code>error</code><span>{result.error.hint ?? 'dbt stops: read the message in the terminal.'}</span></li>}
            </ul>
            {(result.notes.length > 0 || (usesState && previous)) && (
              <div className="msl-notes">
                {usesState && previous && <p className="msl-note info"><b>--state:</b> {previous.label}.</p>}
                {result.notes.map((n) => <p key={n} className="msl-note"><b>dbt 1.11.16:</b> {n}</p>)}
              </div>
            )}
          </section>
        </div>
      )}

      {project && result && result.execution.length > 0 && (
        <section className="msl-panel" aria-labelledby="msl-exec-h">
          <div className="msl-pad" style={{ paddingBottom: 6 }}>
            <h2 id="msl-exec-h" style={{ fontSize: 'var(--fs-md)' }}>Order of execution (dbt {result.command}, --threads 1)</h2>
            <p className="msl-muted msl-small" style={{ margin: '4px 0 0' }}>Nothing runs here: this is the order dbt would start the nodes with one thread. Unit tests run right before their model; an ephemeral model has no line of its own.</p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="msl-exec">
              <thead><tr><th scope="col">#</th><th scope="col">dbt prints</th></tr></thead>
              <tbody>
                {result.execution.map((s) => (
                  <tr key={s.uid}><td className="i">{s.index === null ? '–' : `${s.index} of ${s.total}`}</td><td className="d">{s.index === null ? `(ephemeral, no line) ${s.desc}` : `START ${s.desc}`}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {project && result && <PasteCheck result={result} />}

      <Facts onTry={(f) => openCommand(f.project, f.cmd, f.scenario, f.demo)} />

      <Challenges onOpen={(pid, command, scen) => openCommand(pid, command, scen)} />
    </div>
  );
}

function PasteCheck({ result }: { result: CommandResult }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<null | { ok: boolean; missing: string[]; extra: string[]; count: number }>(null);
  const isLs = result.command === 'ls' && !result.error;
  const check = () => {
    const p = parseLsOutput(text);
    const c = compareLs(result.output, p.nodes);
    setRes({ ok: c.ok, missing: c.missing, extra: c.extra, count: p.nodes.length });
  };
  return (
    <section className="msl-panel msl-pad msl-paste" aria-labelledby="msl-paste-h">
      <details>
        <summary><h2 id="msl-paste-h" style={{ display: 'inline', fontSize: 'var(--fs-md)' }}>Check your own terminal</h2></summary>
        <p className="msl-small msl-muted" style={{ marginTop: 8 }}>Run the same <code>dbt ls</code> command in your project at the same tag, paste everything it printed, and compare. Log lines with a time stamp are ignored.</p>
        {!isLs && <p className="msl-small">Use a <code>dbt ls</code> command above to compare.</p>}
        <label htmlFor="msl-paste" className="visually-hidden">Your dbt ls output</label>
        <textarea id="msl-paste" value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} placeholder="Paste the output of dbt ls here" />
        <p style={{ margin: '8px 0 0' }}><button type="button" className="msl-btn msl-btn-ink" onClick={check} disabled={!isLs || !text.trim()}>Compare</button></p>
        <div aria-live="polite">
          {res && (res.ok
            ? <p className="msl-result-ok" style={{ marginTop: 8 }}>Same {res.count} lines as the playground.</p>
            : (
              <div style={{ marginTop: 8 }}>
                <p className="msl-result-bad" style={{ margin: 0 }}>Different from the playground.</p>
                {res.missing.length > 0 && <><p className="msl-small" style={{ margin: '6px 0 0' }}>Missing in your output:</p><ul className="msl-diff">{res.missing.map((m) => <li key={m}>{m}</li>)}</ul></>}
                {res.extra.length > 0 && <><p className="msl-small" style={{ margin: '6px 0 0' }}>Not in the playground output:</p><ul className="msl-diff">{res.extra.map((m) => <li key={m}>{m}</li>)}</ul></>}
              </div>
            ))}
        </div>
      </details>
    </section>
  );
}
