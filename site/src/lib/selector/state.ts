/**
 * The "--state folder" of the playground: what state:, result: and source_status: compare with.
 *
 * Three sources, always labelled in the UI:
 *  1. REAL  - the manifest of the previous chapter tag: the matches of every state:<value> were computed with
 *             real dbt 1.11.16 (`dbt ls -s state:<value> --state <previous manifest> --indirect-selection empty`)
 *  2. SIMULATED changes - "edit one node" on top of the current tag (body, config, description, alias, macro...),
 *             following the rules of dbt 1.11.16's StateSelectorMethod (checked against the book's real outputs)
 *  3. SIMULATED run results - the statuses a `dbt build`/`run`/`test` would write in run_results.json when some
 *             nodes break (error = model, fail = test), with dbt's skip rule for the nodes below them
 */
import type { PreviousState } from './methods';
import type { Project } from './project';
import { runCommand } from './tasks';

export type ChangeKind = 'body' | 'configs' | 'relation' | 'persisted_descriptions' | 'contract' | 'fqn' | 'none';

export interface StateChange {
  uid: string;
  kinds: ChangeKind[];
}

export interface StateSimulation {
  /** start from these matches (e.g. the real previous-tag comparison); default = nothing changed */
  base?: PreviousState | null;
  changes?: StateChange[];
  /** project macros whose code changed (unique ids) */
  macros?: string[];
  /** state values that raise an error (e.g. a breaking contract change) */
  errors?: Record<string, string>;
  label: string;
}

/** Real comparison with the previous tag (precomputed with dbt 1.11.16). */
export function previousTagState(project: Project): PreviousState | null {
  const sp = project.extras?.state_prev;
  if (!sp) return null;
  return {
    label: `manifest of the previous tag (${sp.prev_tag}), compared by real dbt 1.11.16`,
    stateMatches: sp.results,
    stateErrors: sp.errors,
    results: null,
    fresher: null,
  };
}

/** Nodes that use a changed macro, directly or through other project macros (StateSelectorMethod rules). */
export function nodesUsingMacros(project: Project, changed: string[]): Set<string> {
  const macroDeps = new Map<string, string[]>();
  for (const m of project.dag.macros ?? []) macroDeps.set(m.unique_id, (m as { depends_on?: { macros?: string[] } }).depends_on?.macros ?? []);
  const changedSet = new Set(changed);
  const uses = (macro: string, seen: Set<string>): boolean => {
    if (changedSet.has(macro)) return true;
    if (seen.has(macro)) return false;
    seen.add(macro);
    return (macroDeps.get(macro) ?? []).some((m) => uses(m, seen));
  };
  const out = new Set<string>();
  for (const n of project.nodes.values()) {
    const ms = n.depends_on?.macros ?? [];
    if (ms.some((m) => uses(m, new Set()))) out.add(n.unique_id);
  }
  return out;
}

/** Simulated comparison: existing nodes edited in place (no node added or removed). */
export function simulateState(project: Project, sim: StateSimulation): PreviousState {
  const all = [...project.nodes.keys()];
  const base = sim.base?.stateMatches ?? null;
  const set = (k: string) => new Set(base?.[k] ?? []);
  const res: Record<string, Set<string>> = {
    new: set('new'),
    modified: set('modified'),
    'modified.body': set('modified.body'),
    'modified.configs': set('modified.configs'),
    'modified.persisted_descriptions': set('modified.persisted_descriptions'),
    'modified.relation': set('modified.relation'),
    'modified.macros': set('modified.macros'),
    'modified.contract': set('modified.contract'),
  };
  for (const c of sim.changes ?? []) {
    const real = c.kinds.filter((k) => k !== 'none');
    if (!real.length) continue; // tags, group, column meta, vars, env vars: not detected by 1.11.16
    res.modified.add(c.uid);
    for (const k of real) if (k !== 'fqn') res[`modified.${k}`].add(c.uid);
  }
  if (sim.macros?.length) {
    for (const u of nodesUsingMacros(project, sim.macros)) { res.modified.add(u); res['modified.macros'].add(u); }
  }
  const old = base ? set('old') : new Set(all);
  const unmodified = base
    ? new Set([...set('unmodified')].filter((u) => !res.modified.has(u)))
    : new Set(all.filter((u) => !res.modified.has(u)));
  const out: Record<string, string[]> = { old: [...old], unmodified: [...unmodified] };
  for (const [k, v] of Object.entries(res)) out[k] = [...v];
  return {
    label: sim.label,
    stateMatches: out,
    stateErrors: { ...(sim.base?.stateErrors ?? {}), ...(sim.errors ?? {}) },
    results: sim.base?.results ?? null,
    fresher: sim.base?.fresher ?? null,
  };
}

export interface RunSimulation {
  /** the command that wrote run_results.json, e.g. "dbt build --exclude-resource-type unit_test" */
  command: string;
  /** models/seeds/snapshots that error, tests that error */
  errors?: string[];
  /** tests that fail (status fail) */
  fails?: string[];
  /** tests that warn */
  warns?: string[];
  label: string;
}

/**
 * Statuses dbt would write in run_results.json. Rule (GraphRunnableTask._mark_dependent_errors): after an
 * error, a fail, or a skip, every node below it in the command's graph is skipped (`dbt build` graph also has
 * the test -> node edges, so a failing test skips the children of the node it tests).
 */
export function simulateRunResults(project: Project, sim: RunSimulation): Record<string, string> {
  const r = runCommand(project, sim.command, { clock: '00:00:00' });
  if (r.error) throw new Error(`simulation command failed: ${r.error.message}`);
  const isBuild = r.command === 'build';
  const errors = new Set(sim.errors ?? []);
  const fails = new Set(sim.fails ?? []);
  const warns = new Set(sim.warns ?? []);
  const skipped = new Set<string>();
  const descendants = (id: string): string[] => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const x = stack.pop()!;
      const next = [...(project.children.get(x) ?? []), ...(isBuild ? project.testEdgeChildren.get(x) ?? [] : [])];
      for (const c of next) if (!out.has(c)) { out.add(c); stack.push(c); }
    }
    return [...out];
  };
  const markDown = (id: string) => { for (const d of descendants(id)) skipped.add(d); };
  const status: Record<string, string> = {};
  for (const step of r.execution) {
    const n = project.get(step.uid);
    const isTest = n.resource_type === 'test' || n.resource_type === 'unit_test';
    let s: string;
    if (skipped.has(step.uid) || (n.resource_type === 'unit_test' && skipped.has(n.depends_on?.nodes?.[0] ?? ''))) s = 'skipped';
    else if (errors.has(step.uid)) s = 'error';
    else if (fails.has(step.uid)) s = 'fail';
    else if (warns.has(step.uid)) s = 'warn';
    else if (n.resource_type === 'exposure' || n.resource_type === 'saved_query') s = 'no-op';
    else s = isTest ? 'pass' : 'success';
    if (s === 'error' || (isBuild && (s === 'fail' || s === 'skipped'))) markDown(step.uid);
    if (n.resource_type === 'unit_test' && (s === 'fail' || s === 'error')) skipped.add(n.depends_on?.nodes?.[0] ?? '');
    if (step.kind !== 'ephemeral') status[step.uid] = s;
    else if (s === 'error' || s === 'skipped') markDown(step.uid);
  }
  return status;
}

export function withResults(prev: PreviousState | null, label: string, results: Record<string, string>): PreviousState {
  return { label: prev ? `${prev.label} + ${label}` : label, stateMatches: prev?.stateMatches ?? null, stateErrors: prev?.stateErrors, results, fresher: prev?.fresher ?? null };
}

export function withFresher(prev: PreviousState | null, label: string, fresher: string[]): PreviousState {
  return { label: prev ? `${prev.label} + ${label}` : label, stateMatches: prev?.stateMatches ?? null, stateErrors: prev?.stateErrors, results: prev?.results ?? null, fresher };
}
