/**
 * Selection methods, ported from dbt/graph/selector_methods.py (dbt-core 1.11.16).
 * Each method returns the unique ids it matches among `included` (the enabled graph members).
 */
import { DbtError, internalError, runtimeError } from './errors';
import { fnmatch } from './fnmatch';
import type { Bucket, PNode, Project, Target } from './project';
import type { MethodName } from './spec';
import { GlobError, normPath, parentsOf } from './vfs';

/** Previous-run facts for state:, result: and source_status: (simulated or precomputed with real dbt). */
export interface PreviousState {
  /** label shown in the UI, e.g. "manifest of tag ch15" */
  label: string;
  /** state:<value> -> matching unique ids (as dbt's StateSelectorMethod.search returns them); null = no manifest */
  stateMatches: Record<string, string[]> | null;
  /** state:<value> -> error dbt raises for that comparison (e.g. a breaking contract change) */
  stateErrors?: Record<string, string>;
  /** run_results.json statuses by unique id; null = no run_results.json */
  results: Record<string, string> | null;
  /** source_status: unique ids of sources with fresher data; null = no sources.json */
  fresher: string[] | null;
}

export interface MethodContext {
  project: Project;
  target: Target;
  previous: PreviousState | null;
}

const PARSED: Bucket[] = ['nodes'];
const ALL: Bucket[] = ['nodes', 'sources', 'exposures', 'metrics', 'unit_tests', 'semantic_models', 'saved_queries', 'functions'];
const NON_SOURCE: Bucket[] = ['nodes', 'exposures', 'metrics', 'unit_tests', 'semantic_models', 'saved_queries', 'functions'];
const CONFIGURABLE: Bucket[] = ['nodes', 'sources'];
const GROUPABLE: Bucket[] = ['nodes', 'metrics'];
const PARSED_AND_UNIT: Bucket[] = ['nodes', 'unit_tests'];

function* iter(ctx: MethodContext, included: Set<string>, buckets: Bucket[]): Generator<PNode> {
  for (const b of buckets) {
    for (const n of ctx.project.nodes.values()) {
      if (n.bucket === b && included.has(n.unique_id)) yield n;
    }
  }
}

function isVersioned(n: PNode): boolean {
  return n.resource_type === 'model' && n.version !== null && n.version !== undefined;
}

// ------------------------------------------------------------------------------------------------- fqn
export function isSelectedNode(fqn: string[], nodeSelector: string, versioned: boolean): boolean {
  if (versioned) {
    const flat = nodeSelector.split('.');
    if (fqn[fqn.length - 2] === nodeSelector) return true;
    if (fqn.slice(-2).join('_') === flat.slice(-2).join('_')) return true;
  } else if (fqn[fqn.length - 1] === nodeSelector) {
    return true;
  }
  const flatFqn = fqn.flatMap((seg) => seg.split('.'));
  const selParts = nodeSelector.split('.');
  if (flatFqn.length < selParts.length) return false;
  let slurp: number | null = null;
  for (let i = 0; i < selParts.length; i++) {
    const part = selParts[i];
    if (['*', '?', '[', ']'].some((w) => part.includes(w))) {
      slurp = i;
      break;
    } else if (flatFqn[i] === part) {
      continue;
    } else {
      return false;
    }
  }
  if (slurp !== null) {
    if (fnmatch(flatFqn.slice(slurp).join('.'), selParts.slice(slurp).join('.'))) return true;
    if (!nodeSelector.includes('.')) {
      const leaf = versioned ? fqn[fqn.length - 2] : fqn[fqn.length - 1];
      return fnmatch(leaf, nodeSelector);
    }
    return false;
  }
  return true;
}

function fqnSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  const out: string[] = [];
  for (const n of iter(ctx, included, NON_SOURCE)) {
    const v = isVersioned(n);
    if (isSelectedNode(n.fqn, selector, v) || isSelectedNode(n.fqn.slice(1), selector, v)) out.push(n.unique_id);
  }
  return out;
}

// ------------------------------------------------------------------------------------- dotted name methods
function packageAndName(selector: string, kind: string, plural: string, twoOnly: boolean): { pkg: string; src?: string; name: string } {
  const parts = selector.split('.');
  if (kind === 'source') {
    if (parts.length === 1) return { pkg: '*', src: parts[0], name: '*' };
    if (parts.length === 2) return { pkg: '*', src: parts[0], name: parts[1] };
    if (parts.length === 3) return { pkg: parts[0], src: parts[1], name: parts[2] };
    throw runtimeError(`Invalid source selector value "${selector}". Sources must be of the form \`\${source_name}\`, \`\${source_name}.\${target_name}\`, or \`\${package_name}.\${source_name}.\${target_name}`);
  }
  if (parts.length === 1) return { pkg: '*', name: parts[0] };
  if (parts.length === 2 && twoOnly) return { pkg: parts[0], name: parts[1] };
  throw runtimeError(plural);
}

function namedSearch(ctx: MethodContext, included: Set<string>, selector: string, bucket: Bucket, err: string): string[] {
  const { pkg, name } = packageAndName(selector, bucket, err, true);
  const out: string[] = [];
  for (const n of iter(ctx, included, [bucket])) {
    if (!fnmatch(n.package_name, pkg)) continue;
    if (!fnmatch(n.name, name)) continue;
    out.push(n.unique_id);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- config
class AttributeMissing extends Error {}

/** Attribute names that dbt's config objects expose under another key in to_dict() */
const CONFIG_ALIASES: Record<string, string> = { pre_hook: 'pre-hook', post_hook: 'post-hook' };

function getattrDescend(obj: unknown, attrs: string[]): unknown {
  let value = obj;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      const key = i === 0 && CONFIG_ALIASES[attr] && !(attr in rec) ? CONFIG_ALIASES[attr] : attr;
      if (key in rec) {
        value = rec[key];
        continue;
      }
    }
    throw new AttributeMissing(attr);
  }
  return value;
}

function ciEq(sel: unknown, v: unknown): boolean {
  if (typeof sel === 'string' && typeof v === 'string') return sel.toUpperCase() === v.toUpperCase();
  return false;
}

function pyEq(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    // True == 1 in Python
    const na = typeof a === 'boolean' ? (a ? 1 : 0) : a;
    const nb = typeof b === 'boolean' ? (b ? 1 : 0) : b;
    return na === nb;
  }
  if (a && typeof a === 'object' && '__f' in (a as object)) a = parseFloat((a as { __f: string }).__f);
  if (b && typeof b === 'object' && '__f' in (b as object)) b = parseFloat((b as { __f: string }).__f);
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (a === null && b === null) return true;
  return false;
}

function configSearch(ctx: MethodContext, included: Set<string>, args: string[], selector: unknown): string[] {
  const severity = args.length === 1 && args[0] === 'severity';
  const isTrue = typeof selector === 'string' && selector.toUpperCase() === 'TRUE';
  const isFalse = typeof selector === 'string' && selector.toUpperCase() === 'FALSE';
  const out: string[] = [];
  for (const n of iter(ctx, included, CONFIGURABLE)) {
    let value: unknown;
    try {
      value = args.length === 0 ? ctx.project.config(n.unique_id, ctx.target) : getattrDescend(ctx.project.config(n.unique_id, ctx.target), args);
    } catch (e) {
      if (e instanceof AttributeMissing) continue;
      throw e;
    }
    if (Array.isArray(value)) {
      const inList = value.some((x) => (severity ? ciEq(selector, x) || pyEq(selector, x) : pyEq(selector, x)));
      // Python: `True in value` compares with ==, so 1 (and 1.0) count as True, 0 as False
      if (inList || (isTrue && value.some((x) => pyEq(true, x))) || (isFalse && value.some((x) => pyEq(false, x)))) out.push(n.unique_id);
    } else if ((severity ? ciEq(selector, value) || pyEq(selector, value) : pyEq(selector, value)) || (isTrue && value === true) || (isFalse && value === false)) {
      out.push(n.unique_id);
    }
  }
  return out;
}

// --------------------------------------------------------------------------------------------- versions
/** Python float(): decimal literals with optional _ between digits, inf/infinity/nan; null = ValueError */
function pyFloat(v: unknown): number | null {
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const m = /^([+-]?)(inf|infinity|nan)$/i.exec(s);
  if (m) return m[2].toLowerCase() === 'nan' ? NaN : (m[1] === '-' ? -Infinity : Infinity);
  if (!/^[+-]?((\d(_?\d)*)(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/.test(s)) return null;
  return Number(s.replace(/_/g, ''));
}

function versionLt(a: unknown, b: unknown): boolean {
  const fa = pyFloat(a);
  const fb = pyFloat(b);
  if (fa !== null && fb !== null) return fa < fb;
  return String(a) < String(b);
}

function versionSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  const out: string[] = [];
  for (const n of iter(ctx, included, PARSED)) {
    if (n.resource_type !== 'model') continue;
    const v = n.version;
    const lv = n.latest_version;
    const has = (x: unknown) => x !== null && x !== undefined && x !== '' && x !== 0;
    if (selector === 'latest') {
      if (v !== null && v !== undefined && String(v) === String(lv) && typeof v === typeof lv) out.push(n.unique_id);
    } else if (selector === 'prerelease') {
      if (has(v) && has(lv) && versionLt(lv, v)) out.push(n.unique_id);
    } else if (selector === 'old') {
      if (has(v) && has(lv) && versionLt(v, lv)) out.push(n.unique_id);
    } else if (selector === 'none') {
      if (v === null || v === undefined) out.push(n.unique_id);
    } else {
      throw runtimeError(`Invalid version type selector ${selector}: expected one of: "latest", "prerelease", "old", or "none"`);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- path
function pathSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  let paths: Set<string>;
  try {
    paths = ctx.project.fs.glob(selector);
  } catch (e) {
    if (e instanceof GlobError) throw new DbtError('Unhandled', e.message);
    throw e;
  }
  const out: string[] = [];
  for (const n of iter(ctx, included, ALL)) {
    if (!n.original_file_path) continue;
    const ofp = normPath(n.original_file_path);
    if (paths.has(ofp)) out.push(n.unique_id);
    if (n.patch_path && paths.has(normPath(n.patch_path))) out.push(n.unique_id);
    if (parentsOf(ofp).some((p) => paths.has(p))) out.push(n.unique_id);
  }
  return out;
}

function fileSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  const out: string[] = [];
  for (const n of iter(ctx, included, ALL)) {
    const ofp = n.original_file_path ?? '';
    const name = ofp.split('/').pop() ?? '';
    // PurePath.stem: the name without its last suffix ('.gitkeep' and 'a.' keep their dot rules)
    const i = name.lastIndexOf('.');
    const stem = i > 0 && i < name.length - 1 ? name.slice(0, i) : name;
    if (fnmatch(name, selector) || fnmatch(stem, selector)) out.push(n.unique_id);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- tests
function testTypeSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  let want: ('generic' | 'singular' | 'unit')[];
  // dbt writes `selector in ("data")`: ("data") is a string, so this is a SUBSTRING test (same for singular, unit)
  if (selector === 'generic' || selector === 'schema') want = ['generic'];
  else if ('data'.includes(selector)) want = ['generic', 'singular'];
  else if ('singular'.includes(selector)) want = ['singular'];
  else if ('unit'.includes(selector)) want = ['unit'];
  else throw runtimeError(`Invalid test type selector ${selector}: expected "generic", "singular", "unit", or "data"`);
  const out: string[] = [];
  for (const n of iter(ctx, included, PARSED_AND_UNIT)) {
    if (n.resource_type === 'unit_test') {
      if (want.includes('unit')) out.push(n.unique_id);
    } else if (n.resource_type === 'test') {
      const t = n.test_type ?? (n.test_metadata ? 'generic' : 'singular');
      if (want.includes(t)) out.push(n.unique_id);
    }
  }
  return out;
}

function testNameSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  const out: string[] = [];
  for (const n of iter(ctx, included, PARSED_AND_UNIT)) {
    if (n.resource_type === 'test' && n.test_metadata) {
      if (fnmatch(n.test_metadata.name, selector)) out.push(n.unique_id);
    } else if (n.resource_type === 'unit_test') {
      if (fnmatch(n.name, selector)) out.push(n.unique_id);
    }
  }
  return out;
}

const NODE_TYPES = ['model', 'analysis', 'test', 'snapshot', 'operation', 'seed', 'rpc', 'sql_operation', 'doc', 'source',
  'macro', 'exposure', 'metric', 'group', 'saved_query', 'semantic_model', 'unit_test', 'fixture', 'function'];

// ------------------------------------------------------------------------------------------- state & co
export const STATE_VALUES = ['new', 'old', 'modified', 'unmodified', 'modified.body', 'modified.configs',
  'modified.persisted_descriptions', 'modified.relation', 'modified.macros', 'modified.contract'];

function stateSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  const prev = ctx.previous;
  if (!prev || !prev.stateMatches) throw runtimeError('Got a state selector method, but no comparison manifest');
  if (!STATE_VALUES.includes(selector)) {
    throw runtimeError(`Got an invalid selector "${selector}", expected one of "${pyList(STATE_VALUES)}"`);
  }
  if (prev.stateErrors?.[selector]) throw new DbtError('Unhandled', prev.stateErrors[selector]);
  const hits = new Set(prev.stateMatches[selector] ?? []);
  return [...iter(ctx, included, ALL)].filter((n) => hits.has(n.unique_id)).map((n) => n.unique_id);
}

function pyList(a: string[]): string {
  return `[${a.map((s) => `'${s}'`).join(', ')}]`;
}

function resultSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  const prev = ctx.previous;
  if (!prev || !prev.results) throw internalError('No comparison run_results');
  const matches = new Set(Object.entries(prev.results).filter(([, s]) => s === selector).map(([u]) => u));
  return [...iter(ctx, included, ALL)].filter((n) => matches.has(n.unique_id)).map((n) => n.unique_id);
}

function sourceStatusSearch(ctx: MethodContext, included: Set<string>, selector: string): string[] {
  const prev = ctx.previous;
  if (!prev || !prev.fresher) throw internalError('No previous state comparison freshness results in sources.json');
  const matches = selector === 'fresher' ? new Set(prev.fresher) : new Set<string>();
  return [...iter(ctx, included, ALL)].filter((n) => matches.has(n.unique_id)).map((n) => n.unique_id);
}

// ------------------------------------------------------------------------------------------------ search
export function search(ctx: MethodContext, method: MethodName, args: string[], value: unknown, included: Set<string>): Set<string> {
  const sel = typeof value === 'string' ? value : value === null || value === undefined ? 'None' : String(value);
  let out: string[];
  switch (method) {
    case 'fqn': out = fqnSearch(ctx, included, sel); break;
    case 'tag':
      out = [...iter(ctx, included, ALL)].filter((n) => (n.tags ?? []).some((t) => fnmatch(t, sel))).map((n) => n.unique_id);
      break;
    case 'group':
      out = [...iter(ctx, included, GROUPABLE)].filter((n) => {
        const g = ctx.project.config(n.unique_id, ctx.target).group;
        return typeof g === 'string' && g !== '' && fnmatch(g, sel);
      }).map((n) => n.unique_id);
      break;
    case 'access':
      out = [...iter(ctx, included, PARSED)].filter((n) => n.resource_type === 'model' && n.access === sel).map((n) => n.unique_id);
      break;
    case 'source': {
      const { pkg, src, name } = packageAndName(sel, 'source', '', false);
      out = [...iter(ctx, included, ['sources'])].filter((n) =>
        fnmatch(n.package_name, pkg) && fnmatch(n.source_name ?? '', src!) && fnmatch(n.name, name)).map((n) => n.unique_id);
      break;
    }
    case 'exposure':
      out = namedSearch(ctx, included, sel, 'exposures', `Invalid exposure selector value "${sel}". Exposures must be of the form \${exposure_name} or \${exposure_package.exposure_name}`);
      break;
    case 'metric':
      out = namedSearch(ctx, included, sel, 'metrics', `Invalid metric selector value "${sel}". Metrics must be of the form \${metric_name} or \${metric_package.metric_name}`);
      break;
    case 'semantic_model':
      out = namedSearch(ctx, included, sel, 'semantic_models', `Invalid semantic model selector value "${sel}". Semantic models must be of the form \${semantic_model_name} or \${semantic_model_package.semantic_model_name}`);
      break;
    case 'saved_query':
      out = namedSearch(ctx, included, sel, 'saved_queries', `Invalid saved query selector value "${sel}". Saved queries must be of the form \${saved_query_name} or \${saved_query_package.saved_query_name}`);
      break;
    case 'unit_test':
      out = namedSearch(ctx, included, sel, 'unit_tests', `Invalid unit test selector value "${sel}". Saved queries must be of the form \${unit_test_name} or \${unit_test_package_name.unit_test_name}`);
      break;
    case 'path': out = pathSearch(ctx, included, sel); break;
    case 'file': out = fileSearch(ctx, included, sel); break;
    case 'package': {
      const pkg = sel === 'this' ? ctx.project.name : sel;
      out = [...iter(ctx, included, ALL)].filter((n) => fnmatch(n.package_name, pkg)).map((n) => n.unique_id);
      break;
    }
    case 'config': out = configSearch(ctx, included, args, value); break;
    case 'test_name': out = testNameSearch(ctx, included, sel); break;
    case 'test_type': out = testTypeSearch(ctx, included, sel); break;
    case 'resource_type': {
      if (!NODE_TYPES.includes(sel)) throw runtimeError(`Invalid resource_type selector "${sel}"`);
      out = [...iter(ctx, included, ALL)].filter((n) => n.resource_type === sel).map((n) => n.unique_id);
      break;
    }
    case 'version': out = versionSearch(ctx, included, sel); break;
    case 'state': out = stateSearch(ctx, included, sel); break;
    case 'result': out = resultSearch(ctx, included, sel); break;
    case 'source_status': out = sourceStatusSearch(ctx, included, sel); break;
    default: {
      const m: never = method;
      throw internalError(`Method name "${String(m)}" is a valid node selection method name, but it is not handled`);
    }
  }
  return new Set(out);
}
