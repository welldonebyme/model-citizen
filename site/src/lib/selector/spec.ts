/**
 * Selection specs, parsed exactly like dbt-core 1.11.16 (dbt/graph/selector_spec.py and dbt/graph/cli.py).
 *
 *   --select "a b,c"  -> union( intersection(a), intersection(b, c) )     (space = union, comma = intersection)
 *   --select/--exclude -> difference( union(select or the default), union(exclude) )
 *   one item          -> RAW_SELECTOR_PATTERN: [@][n+][method[.args]:]value[+n]
 *   YAML selectors    -> parse_from_definition (union/intersection/exclude/method+value/one-key dict/CLI string)
 */
import { DbtError, runtimeError } from './errors';

export type Indirect = 'eager' | 'cautious' | 'buildable' | 'empty';
export const INDIRECT_MODES: Indirect[] = ['eager', 'cautious', 'buildable', 'empty'];

export const METHOD_NAMES = [
  'fqn', 'tag', 'group', 'access', 'source', 'path', 'file', 'package', 'config', 'test_name', 'test_type',
  'resource_type', 'state', 'exposure', 'metric', 'result', 'source_status', 'version', 'semantic_model',
  'saved_query', 'unit_test',
] as const;
export type MethodName = (typeof METHOD_NAMES)[number];

export interface Criteria {
  kind: 'criteria';
  raw: unknown;
  method: MethodName;
  args: string[];
  /** true when the method was not written (dbt chose fqn / path / file) */
  implicitMethod: boolean;
  value: unknown;
  childrensParents: boolean;
  parents: boolean;
  parentsDepth: number | null;
  children: boolean;
  childrenDepth: number | null;
  indirect: Indirect;
}

export interface Group {
  kind: 'union' | 'intersection' | 'difference';
  components: Spec[];
  indirect: Indirect;
  expectExists: boolean;
  raw: unknown;
  /** where the group comes from (for explanations) */
  role?: 'select' | 'exclude' | 'default' | 'item' | 'root' | 'yaml';
}

export type Spec = Criteria | Group;

export const DEFAULT_INCLUDES = ['fqn:*', 'source:*', 'exposure:*', 'metric:*', 'semantic_model:*'];

// RAW_SELECTOR_PATTERN, with Python's `\w` (Unicode letters, numbers, underscore) and `.` (no newline).
const RAW_SELECTOR_PATTERN =
  /^(?<childrens_parents>@)?(?<parents>(?<parents_depth>\d*)\+)?(?:(?<method>[\p{L}\p{N}_.]+):)?(?<value>[^\n]*?)(?<children>\+(?<children_depth>\d*))?$/u;

function probablyPath(value: string): boolean {
  return value.includes('/');
}

export function defaultMethod(value: string): MethodName {
  if (probablyPath(value)) return 'path';
  const v = value.toLowerCase();
  if (v.endsWith('.sql') || v.endsWith('.py') || v.endsWith('.csv')) return 'file';
  return 'fqn';
}

function parseMethod(rawMethod: string | undefined | null, value: unknown): { method: MethodName; args: string[]; implicit: boolean } {
  if (rawMethod === undefined || rawMethod === null) {
    return { method: defaultMethod(String(value)), args: [], implicit: true };
  }
  const parts = String(rawMethod).split('.');
  if (!(METHOD_NAMES as readonly string[]).includes(parts[0])) {
    throw new DbtError('Runtime Error', `'${parts[0]}' is not a valid method name`,
      parts[0] === 'selector'
        ? 'The selector: method arrived in dbt 1.12. In dbt 1.11 use --selector <name> instead.'
        : undefined);
  }
  return { method: parts[0] as MethodName, args: parts.slice(1), implicit: false };
}

/** selector_spec._match_to_int: a falsy value (None, '', 0, false) means "no limit"; true is 1 (int(True)). */
function matchToInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '' || v === false || v === 0) return null;
  if (v === true) return 1;
  if (typeof v === 'number') return Math.trunc(v);
  const s = String(v).trim();
  if (!/^[+-]?\d+$/.test(s.replace(/_/g, ''))) throw runtimeError(`Invalid node spec - could not handle parent depth ${s}`);
  return parseInt(s.replace(/_/g, ''), 10);
}

/** Python truthiness of a YAML value. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

function makeCriteria(raw: unknown, d: Record<string, unknown>, flagIndirect: Indirect): Criteria {
  if (!('value' in d)) throw runtimeError(`Invalid node spec "${typeof raw === 'string' ? raw : JSON.stringify(raw)}" - no search value!`);
  const { method, args, implicit } = parseMethod(d.method as string | undefined, d.value);
  const parentsDepth = matchToInt(d.parents_depth);
  const childrenDepth = matchToInt(d.children_depth);
  let indirect: Indirect = flagIndirect;
  if ('indirect_selection' in d && d.indirect_selection !== undefined) {
    const v = String(d.indirect_selection);
    if (!(INDIRECT_MODES as string[]).includes(v)) throw new DbtError('Runtime Error', `'${v}' is not a valid IndirectSelection`);
    indirect = v as Indirect;
  }
  const c: Criteria = {
    kind: 'criteria', raw, method, args, implicitMethod: implicit, value: d.value,
    childrensParents: pyTruthy(d.childrens_parents), parents: pyTruthy(d.parents), parentsDepth,
    children: pyTruthy(d.children), childrenDepth, indirect,
  };
  if (c.children && c.childrensParents) {
    throw runtimeError(`Invalid node spec ${typeof raw === 'string' ? raw : JSON.stringify(raw)} - "@" prefix and "+" suffix are incompatible`);
  }
  return c;
}

/** SelectionCriteria.from_single_spec(raw) */
export function fromSingleSpec(raw: string, flagIndirect: Indirect): Criteria {
  const m = RAW_SELECTOR_PATTERN.exec(raw);
  if (!m || !m.groups) throw runtimeError(`Invalid selector spec "${raw}"`);
  const g = m.groups;
  const d: Record<string, unknown> = {
    childrens_parents: g.childrens_parents ?? null,
    parents: g.parents ?? null,
    parents_depth: g.parents_depth ?? null,
    method: g.method ?? null,
    value: g.value ?? '',
    children: g.children ?? null,
    children_depth: g.children_depth ?? null,
  };
  if (g.method === undefined) d.method = undefined;
  return makeCriteria(raw, d, flagIndirect);
}

/** parse_union: ['a b', 'c'] -> union(intersection(a), intersection(b), intersection(c)) */
export function parseUnion(components: string[], expectExists: boolean, flagIndirect: Indirect, role: Group['role']): Group {
  const rawSpecs = components.flatMap((r) => r.split(' '));
  const union: Spec[] = rawSpecs.map((rawSpec) => ({
    kind: 'intersection',
    components: rawSpec.split(',').map((part) => fromSingleSpec(part, flagIndirect)),
    expectExists,
    raw: rawSpec,
    indirect: flagIndirect,
    role: 'item',
  }));
  return { kind: 'union', components: union, expectExists: false, raw: components, indirect: flagIndirect, role };
}

/** parse_difference(include, exclude); include = null means "no --select given" (the default includes). */
export function parseDifference(include: string[] | null, exclude: string[] | null, flagIndirect: Indirect): Group {
  const inc = include === null || include.length === 0
    ? parseUnion(DEFAULT_INCLUDES, false, flagIndirect, 'default')
    : parseUnion(include, true, flagIndirect, 'select');
  const exc = exclude === null ? parseUnion([], false, flagIndirect, 'exclude') : parseUnion(exclude, true, flagIndirect, 'exclude');
  // SelectionDifference is created without indirect_selection: it keeps the class default (eager)
  return { kind: 'difference', components: [inc, exc], indirect: 'eager', expectExists: false, raw: null, role: 'root' };
}

// ------------------------------------------------------------------------------------------- YAML selectors
type Raw = unknown;

function getListDicts(dct: Record<string, unknown>, key: string): Raw[] {
  if (!(key in dct)) throw new DbtError('Internal Error', `Expected to find key ${key} in dict, only found ${JSON.stringify(Object.keys(dct))}`);
  const values = dct[key];
  if (!Array.isArray(values)) throw new DbtError('Runtime Error', `Invalid value for key "${key}". Expected a list.`);
  for (const v of values) {
    if (!(typeof v === 'string' || (v && typeof v === 'object' && !Array.isArray(v)))) {
      throw new DbtError('Runtime Error', `Invalid value type ${typeof v} in key "${key}", expected dict or str (value: ${JSON.stringify(v)}).`);
    }
  }
  return values;
}

interface YamlCtx {
  flagIndirect: Indirect;
  previous: Record<string, Spec>;
}

function parseExclusions(def: Record<string, unknown>, ctx: YamlCtx): Spec | null {
  const exclusions = getListDicts(def, 'exclude');
  const parsed = exclusions.map((e) => parseFromDefinition(e, false, ctx));
  if (parsed.length === 1) return parsed[0];
  if (parsed.length > 1) return { kind: 'union', components: parsed, indirect: 'eager', expectExists: false, raw: exclusions, role: 'yaml' };
  return null;
}

function parseIncludeExclude(defs: Raw[], ctx: YamlCtx): [Spec[], Spec | null] {
  const include: Spec[] = [];
  let diff: Spec | null = null;
  for (const d of defs) {
    if (d && typeof d === 'object' && 'exclude' in (d as object)) {
      // dbt refuses a second exclude only when the first one produced something (diff_arg is not None)
      if (diff !== null) throw new DbtError('Runtime Error', 'You cannot provide multiple exclude arguments to the same selector set operator');
      diff = parseExclusions(d as Record<string, unknown>, ctx);
    } else {
      include.push(parseFromDefinition(d, false, ctx));
    }
  }
  return [include, diff];
}

function parseSetDefinition(def: Record<string, unknown>, key: 'union' | 'intersection', ctx: YamlCtx): Spec {
  const parts = getListDicts(def, key);
  const [include, exclude] = parseIncludeExclude(parts, ctx);
  const group: Group = { kind: key, components: include, indirect: 'eager', expectExists: false, raw: def, role: 'yaml' };
  if (exclude === null) return group;
  return { kind: 'difference', components: [group, exclude], indirect: 'eager', expectExists: false, raw: def, role: 'yaml' };
}

function parseDictDefinition(def: Record<string, unknown>, ctx: YamlCtx): Spec {
  let diff: Spec | null = null;
  let dct: Record<string, unknown>;
  const keys = Object.keys(def);
  if (keys.length === 1) {
    dct = { method: keys[0], value: def[keys[0]] };
  } else if (def.method === 'selector') {
    const name = String(def.value);
    if (!(name in ctx.previous)) throw new DbtError('Runtime Error', `Existing selector definition for ${name} not found.`);
    return ctx.previous[name];
  } else if ('method' in def && 'value' in def) {
    dct = def;
    if ('exclude' in def) {
      diff = parseExclusions(def, ctx);
      dct = Object.fromEntries(Object.entries(def).filter(([k]) => k !== 'exclude'));
    }
  } else {
    throw new DbtError('Runtime Error', `Expected either 1 key or else "method" and "value" keys, but got ${JSON.stringify(keys)}`);
  }
  const base = makeCriteria(def, dct, ctx.flagIndirect);
  if (diff === null) return base;
  return { kind: 'difference', components: [base, diff], indirect: 'eager', expectExists: false, raw: def, role: 'yaml' };
}

export function parseFromDefinition(def: Raw, rootLevel: boolean, ctx: YamlCtx): Spec {
  if (def && typeof def === 'object' && !Array.isArray(def)) {
    const d = def as Record<string, unknown>;
    if (('union' in d || 'intersection' in d) && rootLevel && Object.keys(d).length > 1) {
      throw new DbtError('Runtime Error', `Only a single 'union' or 'intersection' key is allowed in a root level selector definition; found ${Object.keys(d).join(',')}.`);
    }
  }
  if (typeof def === 'string') return fromSingleSpec(def, ctx.flagIndirect);
  if (def && typeof def === 'object' && !Array.isArray(def)) {
    const d = def as Record<string, unknown>;
    if ('union' in d) return parseSetDefinition(d, 'union', ctx);
    if ('intersection' in d) return parseSetDefinition(d, 'intersection', ctx);
    return parseDictDefinition(d, ctx);
  }
  throw new DbtError('Runtime Error', `Expected to find union, intersection, str or dict, instead found ${typeof def}: ${JSON.stringify(def)}`);
}

/** parse_from_selectors_definition: every selector of selectors.yml, in file order. */
export function parseSelectors(selectors: Record<string, { definition: unknown }>, flagIndirect: Indirect): Record<string, Spec> {
  const result: Record<string, Spec> = {};
  for (const [name, s] of Object.entries(selectors)) {
    result[name] = parseFromDefinition(s.definition, true, { flagIndirect, previous: { ...result } });
  }
  return result;
}
