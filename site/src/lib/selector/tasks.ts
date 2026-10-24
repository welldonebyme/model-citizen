/**
 * dbt commands on top of the selector: which resource types each command keeps, how `dbt ls` prints,
 * and in which order `dbt build/run/test/seed/snapshot` would execute the selected nodes (single thread).
 */
import { parseCommandLine, supportsSelection, type CommandName, type DbtArgs, type ParsedCommand, type Shell } from './cli';
import { DbtError, pyListRepr, runtimeError } from './errors';
import type { MethodContext, PreviousState } from './methods';
import { Project, pySort, type Target } from './project';
import { pyJsonDumps } from './pyjson';
import { NodeSelector, type CriteriaTrace } from './selector';
import { parseDifference, parseSelectors, type Spec } from './spec';

// ---------------------------------------------------------------------------------------- resource types
const LS_DEFAULT = ['model', 'snapshot', 'seed', 'test', 'source', 'exposure', 'metric', 'saved_query', 'semantic_model', 'unit_test', 'function'];
const LS_ALL = [...LS_DEFAULT, 'analysis'];
const BUILD_ALL = ['model', 'snapshot', 'seed', 'test', 'unit_test', 'saved_query', 'exposure', 'function'];
const TEST_TYPES = ['test', 'unit_test'];
const REFABLE = ['model', 'seed', 'snapshot'];
const EXECUTABLE = ['model', 'test', 'snapshot', 'analysis', 'operation', 'seed', 'doc', 'rpc', 'sql_operation', 'function'];
const NODE_TYPE_VALUES = ['model', 'analysis', 'test', 'snapshot', 'operation', 'seed', 'rpc', 'sql_operation', 'doc', 'source', 'macro', 'exposure', 'metric', 'group', 'saved_query', 'semantic_model', 'unit_test', 'fixture', 'function'];

function nodeType(v: string): string {
  if (!NODE_TYPE_VALUES.includes(v)) throw new DbtError('Unhandled', `'${v}' is not a valid NodeType`);
  return v;
}

/** dbt/task/base.py resource_types_from_args */
export function resourceTypesFromArgs(args: DbtArgs, all: string[], deflt: string[]): Set<string> {
  let types: Set<string>;
  if (!args.resourceTypes.length) types = new Set(deflt);
  else {
    const a = new Set(args.resourceTypes);
    if (a.has('all')) { a.delete('all'); for (const x of all) a.add(x); }
    if (a.has('default')) { a.delete('default'); for (const x of deflt) a.add(x); }
    types = new Set([...a].map(nodeType));
  }
  if (args.excludeResourceTypes.length) {
    const ex = new Set(args.excludeResourceTypes.map(nodeType));
    types = new Set([...types].filter((t) => !ex.has(t)));
  }
  return types;
}

function commandResourceTypes(cmd: CommandName, args: DbtArgs, unitTests = true): Set<string> {
  switch (cmd) {
    case 'ls':
      if (args.models) return new Set(['model']);
      return resourceTypesFromArgs(args, LS_ALL, LS_DEFAULT);
    case 'build': {
      const t = resourceTypesFromArgs(args, BUILD_ALL, BUILD_ALL);
      if (!unitTests) t.delete('unit_test');
      return t;
    }
    case 'run': return new Set(['model']);
    case 'test': return new Set([...resourceTypesFromArgs(args, TEST_TYPES, TEST_TYPES)].filter((t) => TEST_TYPES.includes(t)));
    case 'seed': return new Set(['seed']);
    case 'snapshot': return new Set(['snapshot']);
    case 'clone': return new Set([...resourceTypesFromArgs(args, REFABLE, REFABLE)].filter((t) => REFABLE.includes(t)));
    case 'source freshness': return new Set(['source']);
    default: return new Set(EXECUTABLE);
  }
}

// ------------------------------------------------------------------------------------------------ output
export interface ExecStep {
  uid: string;
  /** "N" of "N of M"; null for ephemeral models (never printed) */
  index: number | null;
  total: number;
  kind: 'node' | 'unit_test' | 'ephemeral';
  /** what dbt prints after START, e.g. "sql view model dbt_adnane.stg_x" */
  desc: string;
}

export interface CommandResult {
  parsed: ParsedCommand | null;
  command: CommandName | null;
  exitCode: number;
  error: DbtError | null;
  /** log lines (what dbt prints with a timestamp), in order */
  logs: { level: 'info' | 'warn' | 'error'; text: string }[];
  /** what `dbt ls` prints for the selected nodes (one line each) */
  output: string[];
  /** selected unique ids after the command's resource type filter (sorted like dbt ls) */
  selected: string[];
  /** build: unit tests selected with their models */
  selectedUnitTests: string[];
  execution: ExecStep[];
  spec: Spec | null;
  traces: CriteriaTrace[];
  resourceTypes: string[];
  target: Target;
  /** the full terminal text (logs with a fake time stamp, results, errors) */
  terminal: string[];
  /** facts where dbt 1.11.16 differs from the documentation or surprises learners */
  notes: string[];
  /** the selector used (--selector or default) */
  selectorUsed: string | null;
}

export interface RunOptions {
  /** the folder given with --state (simulated): its manifest comparison, run results, sources.json */
  previous?: PreviousState | null;
  shell?: Shell;
  /** fixed clock for the terminal text */
  clock?: string;
}

function relDesc(p: Project, uid: string, target: Target): string {
  const r = p.relation(uid, target);
  return `${r.schema}.${r.alias}`;
}

export function describeNode(p: Project, uid: string, target: Target): string {
  const n = p.get(uid);
  switch (n.resource_type) {
    case 'model': {
      const cfg = p.config(uid, target);
      let mat = String(cfg.materialized ?? 'view');
      if (mat === 'incremental' && cfg.incremental_strategy === 'microbatch') mat = 'microbatch';
      return `${n.language ?? 'sql'} ${mat} model ${relDesc(p, uid, target)}`;
    }
    case 'seed': return `seed file ${relDesc(p, uid, target)}`;
    case 'snapshot': return `snapshot ${relDesc(p, uid, target)}`;
    case 'test': return `test ${n.name}`;
    case 'unit_test': {
      const vn = n.version === null || n.version === undefined ? n.name : `${n.name}_v${n.version}`;
      return `unit_test ${n.model}::${vn}`;
    }
    case 'exposure': return `exposure ${n.name}`;
    case 'saved_query': return `saved query ${n.name}`;
    default: return `${n.resource_type} ${n.name}`;
  }
}

/** The canonical form used by the golden set: rel:schema.alias, test:name, unit_test:model::name ... */
export function canonical(desc: string): string {
  if (desc.startsWith('test ')) return 'test:' + desc.slice(5);
  if (desc.startsWith('unit_test ')) return 'unit_test:' + desc.slice(10);
  if (desc.startsWith('exposure ')) return 'exposure:' + desc.slice(9);
  if (desc.startsWith('seed file ')) return 'rel:' + desc.slice(10);
  if (desc.startsWith('snapshot ')) return 'rel:' + desc.slice(9);
  const m = /^(?:sql|python) (?:\w+ )*model (.+)$/.exec(desc);
  if (m) return 'rel:' + m[1];
  return 'other:' + desc;
}

function getNested(data: unknown, path: string): unknown {
  let cur = data;
  for (const k of path.split('.')) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && k in (cur as object)) cur = (cur as Record<string, unknown>)[k];
    else return null;
  }
  return cur;
}

const ALLOWED_KEYS = new Set(['alias', 'name', 'package_name', 'depends_on', 'tags', 'config', 'resource_type', 'source_name', 'original_file_path', 'unique_id']);
const DROPPED_KEYS = new Set(['raw_code', 'compiled_code', 'created_at', 'config_call_dict', 'unrendered_config_call_dict', 'build_path', 'compiled_path', 'extra_ctes', 'extra_ctes_injected', 'compiled']);

/** One `dbt ls --output json` line. Exact with the extras file (node.to_dict()); approximate without it. */
export function jsonLine(p: Project, uid: string, outputKeys: string[], target: Target): string {
  const n = p.get(uid);
  let dict = p.extras?.dicts[uid] as Record<string, unknown> | undefined;
  if (!dict) {
    // fallback: the compact DAG node (config without empty keys): flagged in the UI as approximate
    dict = { ...n } as unknown as Record<string, unknown>;
    delete dict.bucket; delete dict.ls; delete dict.search_name; delete dict.prod;
  }
  if (target !== 'dev') {
    const r = p.relation(uid, target);
    dict = { ...dict };
    if ('schema' in dict) dict.schema = r.schema;
    if ('alias' in dict) dict.alias = r.alias;
    if ('database' in dict) dict.database = r.database;
    if (target === 'prod' && n.prod?.relation_name && 'relation_name' in dict) dict.relation_name = n.prod.relation_name;
    if (target === 'prod' && n.prod?.config && dict.config) dict.config = { ...(dict.config as object), ...n.prod.config };
  }
  const result: Record<string, unknown> = {};
  if (outputKeys.length) {
    for (const key of outputKeys) {
      if (key.includes('.')) {
        const v = getNested(dict, key);
        if (v !== null && v !== undefined) result[key] = v;
      } else if (key in dict) {
        result[key] = dict[key];
      } else if (DROPPED_KEYS.has(key)) {
        result[key] = `<${key} is not stored in this playground>`;
      }
    }
  } else {
    for (const [k, v] of Object.entries(dict)) if (ALLOWED_KEYS.has(k)) result[k] = v;
  }
  return pyJsonDumps(result);
}

export function lsLine(p: Project, uid: string, args: DbtArgs, target: Target): string {
  const n = p.get(uid);
  switch (args.output) {
    case 'name': return n.search_name;
    case 'path': return n.original_file_path ?? '';
    case 'json': return jsonLine(p, uid, args.outputKeys, target);
    default: return n.ls;
  }
}

// ------------------------------------------------------------------------------------------ execution
/** Graph.get_subset_graph: keep the selected nodes and the paths between them through unselected ones. */
function subsetGraph(p: Project, selected: Set<string>, withTestEdges: boolean): Map<string, Set<string>> {
  const succ = new Map<string, Set<string>>();
  const pred = new Map<string, Set<string>>();
  for (const id of p.nodes.keys()) { succ.set(id, new Set()); pred.set(id, new Set()); }
  const add = (a: string, b: string) => { succ.get(a)!.add(b); pred.get(b)!.add(a); };
  for (const [a, cs] of p.children) for (const b of cs) add(a, b);
  if (withTestEdges) for (const [a, cs] of p.testEdgeChildren) for (const b of cs) add(a, b);
  const remove = (n: string) => {
    for (const s of succ.get(n)!) pred.get(s)!.delete(n);
    for (const q of pred.get(n)!) succ.get(q)!.delete(n);
    succ.delete(n); pred.delete(n);
  };
  for (;;) {
    const drop = [...succ.keys()].filter((n) => !selected.has(n) && pred.get(n)!.size * succ.get(n)!.size === 0);
    if (!drop.length) break;
    drop.forEach(remove);
  }
  const remaining = [...succ.keys()].sort((a, b) => pred.get(a)!.size * succ.get(a)!.size - pred.get(b)!.size * succ.get(b)!.size);
  for (const n of remaining) {
    if (selected.has(n) || !succ.has(n)) continue;
    for (const s of pred.get(n)!) for (const t of succ.get(n)!) if (s !== t) add(s, t);
    remove(n);
  }
  return succ;
}

/**
 * The START order of `--threads 1`: dbt's main loop pops every ready node from the priority queue
 * (lowest depth level first, then unique_id) and submits it to the thread pool, which runs them first in,
 * first out. When a node finishes, its children that are now ready join the queue, then the pool's line.
 */
export function executionOrder(p: Project, selected: Set<string>, withTestEdges: boolean): string[] {
  const succ = subsetGraph(p, selected, withTestEdges);
  const indeg = new Map<string, number>();
  for (const n of succ.keys()) indeg.set(n, 0);
  for (const cs of succ.values()) for (const c of cs) indeg.set(c, indeg.get(c)! + 1);
  // scores: grouped topological sort inside each weakly connected component (GraphQueue._get_scores)
  const score = new Map<string, number>();
  const und = new Map<string, Set<string>>();
  for (const n of succ.keys()) und.set(n, new Set());
  for (const [a, cs] of succ) for (const b of cs) { und.get(a)!.add(b); und.get(b)!.add(a); }
  const seen = new Set<string>();
  for (const start of succ.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) { const x = stack.pop()!; comp.push(x); for (const y of und.get(x)!) if (!seen.has(y)) { seen.add(y); stack.push(y); } }
    const deg = new Map(comp.map((n) => [n, 0]));
    for (const a of comp) for (const b of succ.get(a)!) deg.set(b, deg.get(b)! + 1);
    let level = comp.filter((n) => deg.get(n) === 0);
    let l = 0;
    while (level.length) {
      const next: string[] = [];
      for (const v of level) {
        score.set(v, l);
        for (const c of succ.get(v)!) { deg.set(c, deg.get(c)! - 1); if (deg.get(c) === 0) next.push(c); }
      }
      level = next;
      l++;
    }
  }
  const cmp = (a: string, b: string) => (score.get(a)! - score.get(b)!) || (a < b ? -1 : a > b ? 1 : 0);
  const queue = [...succ.keys()].filter((n) => indeg.get(n) === 0);
  const pool: string[] = [];
  const drain = () => { queue.sort(cmp); pool.push(...queue.splice(0)); };
  drain();
  const order: string[] = [];
  while (pool.length) {
    const n = pool.shift()!;
    order.push(n);
    for (const c of succ.get(n)!) { indeg.set(c, indeg.get(c)! - 1); if (indeg.get(c) === 0) queue.push(c); }
    drain();
  }
  return order;
}

// ------------------------------------------------------------------------------------------------ main
export function fakeClock(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
}

/** dbt_common warn_or_error with --warn-error / --warn-error-options (or their env vars). */
export class WarnPolicy {
  private all = false;
  private error = new Set<string>();
  private warn = new Set<string>();
  private silence = new Set<string>();
  constructor(args: DbtArgs, env: Record<string, string>) {
    const envGet = (n: string) => env[n.replace(/^DBT_/, 'DBT_ENGINE_')] ?? env[n];
    const we = args.other.warn_error ?? ['1', 'true', 'True', 'TRUE'].includes(envGet('DBT_WARN_ERROR') ?? '');
    if (we === true) this.all = true;
    const raw = (args.other.warn_error_options as string | undefined) ?? envGet('DBT_WARN_ERROR_OPTIONS');
    if (raw) {
      let o: Record<string, unknown>;
      try { o = JSON.parse(raw); } catch { throw runtimeError(`--warn-error-options must be a JSON or YAML mapping (got ${raw})`); }
      const list = (v: unknown) => (v === 'all' || v === '*' ? ['*'] : Array.isArray(v) ? v.map(String) : []);
      for (const x of [...list(o.error), ...list(o.include)]) this.error.add(x);
      for (const x of [...list(o.warn), ...list(o.exclude)]) this.warn.add(x);
      for (const x of list(o.silence)) this.silence.add(x);
    }
  }
  /** true = raise, false = print, null = silenced */
  decide(event: string): boolean | null {
    if (this.all) return true;
    if ((this.error.has('*') || this.error.has(event)) && !this.warn.has(event)) return true;
    if (this.silence.has(event)) return null;
    return false;
  }
}

function targetOf(args: DbtArgs): Target {
  return args.target === 'prod' ? 'prod' : args.target === 'ci' ? 'ci' : 'dev';
}

export function runCommand(project: Project, line: string, opts: RunOptions = {}): CommandResult {
  const res: CommandResult = {
    parsed: null, command: null, exitCode: 0, error: null, logs: [], output: [], selected: [], selectedUnitTests: [],
    execution: [], spec: null, traces: [], resourceTypes: [], target: 'dev', terminal: [], notes: [], selectorUsed: null,
  };
  const clock = opts.clock ?? fakeClock();
  const log = (level: 'info' | 'warn' | 'error', text: string) => res.logs.push({ level, text });
  try {
    const parsed = parseCommandLine(line, { shell: opts.shell, fs: project.fs });
    res.parsed = parsed;
    res.command = parsed.command;
    res.target = targetOf(parsed.args);
    execute(project, parsed, opts, res, log);
  } catch (e) {
    if (e instanceof DbtError) {
      res.error = e;
      res.exitCode = e.exitCode;
      if (e.hint) res.notes.push(e.hint);
    } else throw e;
  }
  res.terminal = renderTerminal(res, clock, project);
  return res;
}

function execute(project: Project, parsed: ParsedCommand, opts: RunOptions, res: CommandResult, log: (l: 'info' | 'warn' | 'error', t: string) => void): void {
  const { args, command } = parsed;
  const target = res.target;
  const policy = new WarnPolicy(args, parsed.env);
  /** warn_or_error: print the warning, raise it (Compilation Error) or say nothing */
  const warnOrError = (event: string, message: string) => {
    const d = policy.decide(event);
    if (d === true) throw new DbtError('Compilation Error', message);
    if (d === false) log('warn', message);
  };
  for (const n of parsed.notices) log('warn', n);
  if (!supportsSelection(command)) {
    throw runtimeError(`This playground runs node selection only (dbt ls, build, run, test, seed, snapshot, compile, clone). \`dbt ${command}\` does not select nodes.`);
  }
  if (command === 'ls' && args.models) {
    if (args.select) throw runtimeError('"models" and "select" are mutually exclusive arguments');
    if (args.resourceTypes.length) throw runtimeError('"models" and "resource_type" are mutually exclusive arguments');
  }
  if (args.state === 'target' || args.state === 'target/') {
    log('warn', "Warning: The state and target directories are the same: 'target'. This could lead to missing changes due to overwritten state including non-idempotent retries.");
  }
  const previous: PreviousState | null = args.state ? (opts.previous ?? null) : null;
  const ctx: MethodContext = { project, target, previous };

  // selection spec (GraphRunnableTask.get_selection_spec)
  const selectionArg = command === 'ls' && args.models ? args.models : args.select;
  let spec: Spec;
  const selectors = () => parseSelectors(project.selectors, args.indirectSelection);
  const defaultSelector = defaultSelectorName(project, target);
  if (args.selector) {
    if (!(args.selector in project.selectors)) {
      throw runtimeError(`Could not find selector named ${args.selector}, expected one of ${pyListRepr(project.selectorNames)}`);
    }
    spec = selectors()[args.selector];
    res.selectorUsed = args.selector;
    if (args.select || args.exclude) {
      res.notes.push('dbt 1.11 ignores --select and --exclude when --selector is given, without any message (1.12 adds a warning and the selector: method).');
    }
  } else if (!((selectionArg && selectionArg.length) || (args.exclude && args.exclude.length)) && defaultSelector) {
    log('info', `Using default selector ${defaultSelector}`);
    spec = selectors()[defaultSelector];
    res.selectorUsed = defaultSelector;
  } else {
    spec = parseDifference(selectionArg && selectionArg.length ? selectionArg : null, args.exclude, args.indirectSelection);
  }
  res.spec = spec;
  collectNotes(project, spec, res, args);

  const withTestEdges = command === 'build';
  const types = commandResourceTypes(command, args);
  res.resourceTypes = [...types];
  if (command === 'build') {
    const full = new NodeSelector(project, ctx, { resourceTypes: types, includeEmptyNodes: false, withTestEdges }).getSelected(spec, false);
    const woTypes = commandResourceTypes(command, args, false);
    const sel = new NodeSelector(project, ctx, { resourceTypes: woTypes, includeEmptyNodes: false, withTestEdges });
    sel.onWarn = warnOrError;
    const wo = sel.getSelected(spec, true);
    res.traces = sel.traces;
    res.selectedUnitTests = pySort([...full].filter((u) => !wo.has(u)));
    res.selected = pySort([...wo]);
  } else {
    const sel = new NodeSelector(project, ctx, {
      resourceTypes: types, includeEmptyNodes: command === 'ls', withTestEdges, freshnessOnly: command === 'source freshness',
    });
    sel.onWarn = warnOrError;
    const s = sel.getSelected(spec, true);
    res.traces = sel.traces;
    res.selected = pySort([...s]);
  }

  if (command === 'ls') {
    if (!res.selected.length) warnOrError('NoNodesSelected', 'No nodes selected!');
    res.output = res.selected.map((u) => lsLine(project, u, args, target));
    return;
  }
  if (!res.selected.length) {
    warnOrError('NothingToDo', 'Nothing to do. Try checking your model configs and model specification args');
    return;
  }
  // execution plan (one thread)
  const order = executionOrder(project, new Set(res.selected), withTestEdges);
  const unitByModel = new Map<string, string[]>();
  for (const u of res.selectedUnitTests) {
    const m = project.get(u).depends_on?.nodes?.[0];
    if (m) unitByModel.set(m, [...(unitByModel.get(m) ?? []), u]);
  }
  const total = res.selected.filter((u) => !project.isEphemeralModel(u)).length
    + (command === 'build' ? res.selectedUnitTests.filter((u) => res.selected.includes(project.get(u).depends_on?.nodes?.[0] ?? '')).length : 0);
  let i = 0;
  for (const uid of order) {
    if (command === 'build') {
      for (const ut of unitByModel.get(uid) ?? []) {
        i++;
        res.execution.push({ uid: ut, index: i, total, kind: 'unit_test', desc: describeNode(project, ut, target) });
      }
    }
    if (project.isEphemeralModel(uid)) {
      res.execution.push({ uid, index: null, total, kind: 'ephemeral', desc: describeNode(project, uid, target) });
      continue;
    }
    i++;
    res.execution.push({ uid, index: i, total, kind: 'node', desc: describeNode(project, uid, target) });
  }
}

/**
 * RuntimeConfig.get_default_selector_name(): the selector with `default: true`. The value is rendered with Jinja
 * for the current target: the manifest stores the value rendered for dev, so the raw text of selectors.yml is read
 * for the common form "{{ target.name == 'dev' }}" (or !=).
 */
export function defaultSelectorName(project: Project, target: Target): string | null {
  const yml = project.dag.selectors_yml ?? '';
  for (const [name, s] of Object.entries(project.selectors)) {
    const block = new RegExp(`-\\s+name:\\s*['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*\\n([\\s\\S]*?)(?=\\n\\s*-\\s+name:|$)`).exec(yml);
    const raw = block ? /\n\s*default:\s*(.+)/.exec('\n' + block[1])?.[1]?.trim() : undefined;
    let isDefault: boolean;
    if (raw !== undefined) {
      const unq = raw.replace(/^["']|["']$/g, '');
      const m = /^\{\{\s*target\.name\s*(==|!=)\s*['"]([^'"]+)['"]\s*\}\}$/.exec(unq);
      if (m) isDefault = m[1] === '==' ? target === m[2] : target !== m[2];
      else isDefault = ['true', 'True', 'yes'].includes(unq);
    } else {
      isDefault = s.default === true || s.default === 'true' || s.default === 'True';
    }
    if (isDefault) return name;
  }
  return null;
}

/** Facts where the real 1.11.16 behaviour surprises (shown next to the result). */
function collectNotes(project: Project, spec: Spec, res: CommandResult, args: DbtArgs): void {
  const walk = (s: Spec, f: (c: Extract<Spec, { kind: 'criteria' }>, parentRaw: unknown) => void, parentRaw: unknown = null) => {
    if (s.kind === 'criteria') f(s, parentRaw);
    else s.components.forEach((c) => walk(c, f, s.raw));
  };
  const sourceNames = new Set<string>();
  for (const n of project.nodes.values()) if (n.resource_type === 'source') { sourceNames.add(n.name); sourceNames.add(n.source_name ?? ''); sourceNames.add(`${n.source_name}.${n.name}`); }
  walk(spec, (c, parentRaw) => {
    const v = String(c.value);
    if (c.method === 'fqn' && sourceNames.has(v) && !project.ids().some((id) => project.get(id).name === v && project.get(id).resource_type !== 'source')) {
      res.notes.push(`"${v}" is the name of a source, but a bare word (fqn:) never matches sources. Use source:${v}.`);
    }
    if (typeof parentRaw === 'string' && parentRaw.endsWith(',') && v === '') {
      res.notes.push(`"${parentRaw}" ends with a comma: a comma followed by a space splits the selection, so this item asks for "${parentRaw.slice(0, -1)}" AND nothing. It matches nothing; only the next item counts.`);
    }
    if (c.method === 'result' && v === 'fail' && c.parents && c.children) {
      res.notes.push('1+result:fail+ : the docs describe "the models of the failed tests and everything downstream". dbt 1.11.16 really selects the failed tests and their models only: a test has no children. For the exam, accept the docs\' description.');
    }
    if (typeof c.raw === 'object' && c.raw === null) return;
    if (res.selectorUsed && typeof c.value === 'string' && /[ ,]/.test(c.value)) {
      res.notes.push(`The YAML selector has a value with a space or a comma ("${c.value}"). A CLI-style string in selectors.yml holds ONE criterion in dbt 1.11: the space or comma is not a set operator, so it selects nothing. Use union: or intersection: keys.`);
    }
    if (c.method === 'state' && (v === 'modified' || v === 'new')) {
      res.notes.push('dbt 1.11.16: a new source or a new exposure is NOT state:modified (and not state:new). The docs disagree on meta (1.11.16 compares it) and group (1.11.16 ignores it): for the exam, answer the docs\' way.');
    }
  });
  if (args.models) res.notes.push('--models / -m is the old name of --select (deprecated). With dbt ls, --models also keeps models only.');
  res.notes = [...new Set(res.notes)];
}

function renderTerminal(res: CommandResult, clock: string, project: Project): string[] {
  const out: string[] = [];
  const quiet = res.parsed?.args.quiet ?? false;
  const ts = (t: string) => `${clock}  ${t}`;
  if (res.error && (res.error.kind === 'Usage' || res.error.kind === 'Shell')) return res.error.lines(res.command ?? 'ls');
  if (!quiet) {
    out.push(ts('Running with dbt=1.11.16'), ts('Registered adapter: duckdb=1.11.0'));
    if (project.dag.found_line) out.push(ts(project.dag.found_line));
  }
  for (const l of res.logs) {
    if (quiet && l.level !== 'error') continue;
    out.push(ts(l.text));
  }
  if (res.error) {
    out.push(ts('Encountered an error:'), ...res.error.lines(res.command ?? 'ls'));
    return out;
  }
  if (res.command === 'ls') out.push(...res.output);
  else if (res.execution.length && !quiet) {
    out.push(ts(''), ts(`Concurrency: 1 threads (target='${res.target}')`), ts(''));
    for (const s of res.execution) if (s.index !== null) out.push(ts(`${s.index} of ${s.total} START ${s.desc} ... [RUN]`));
  }
  return out;
}

/** Simple API: the selected unique ids for structured arguments (no command line). */
export function select(project: Project, args: Partial<DbtArgs> & { command?: CommandName }, previous: PreviousState | null = null): string[] {
  const full: DbtArgs = {
    select: null, models: null, exclude: null, selector: null, resourceTypes: [], excludeResourceTypes: [], indirectSelection: 'eager',
    output: 'selector', outputKeys: [], state: previous ? 'state' : null, deferState: null, defer: false, target: null, quiet: true, other: {}, ...args,
  };
  const command = args.command ?? 'ls';
  const parsed: ParsedCommand = { raw: '', env: {}, argv: [], command, args: full, pipe: null, notices: [] };
  const res: CommandResult = {
    parsed, command, exitCode: 0, error: null, logs: [], output: [], selected: [], selectedUnitTests: [], execution: [], spec: null,
    traces: [], resourceTypes: [], target: targetOf(full), terminal: [], notes: [], selectorUsed: null,
  };
  execute(project, parsed, { previous }, res, () => {});
  return res.selected;
}
