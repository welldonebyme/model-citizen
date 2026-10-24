/**
 * dbt's NodeSelector (dbt/graph/selector.py + graph.py), ported 1:1:
 *  - each criterion: method search -> graph operators (+, n+, +n, @) -> indirect selection of tests
 *  - groups combine the "direct" and "direct + indirect" sets with union / intersection / difference,
 *    then cautious/buildable tests whose parents all arrived are added back
 *  - a final filter keeps the command's resource types (and drops empty nodes, except for ls)
 */
import { search, type MethodContext } from './methods';
import type { Project } from './project';
import type { Criteria, Group, Indirect, Spec } from './spec';

export interface SelectorOptions {
  /** resource types kept by the final filter (ResourceTypeSelector) */
  resourceTypes: Set<string>;
  includeEmptyNodes: boolean;
  /** dbt build selects on the graph with the extra parent_test edges (only successors see them) */
  withTestEdges: boolean;
  /** FreshnessSelector: only sources with a freshness block */
  freshnessOnly?: boolean;
}

/** One step of the evaluation, kept for explanations and for the UI (which node came from where). */
export interface CriteriaTrace {
  spec: Criteria;
  collected: Set<string>;
  neighbors: Set<string>;
  direct: Set<string>;
  indirect: Set<string>;
}

export class NodeSelector {
  readonly traces: CriteriaTrace[] = [];
  readonly warnings: string[] = [];
  /** called for each warn_or_error event; may throw (--warn-error) */
  onWarn: (event: string, message: string) => void = () => {};

  constructor(readonly project: Project, readonly ctx: MethodContext, readonly opts: SelectorOptions) {}

  // ----------------------------------------------------------------------------------------- graph
  private parentsOf(id: string): Iterable<string> {
    return this.project.parents.get(id) ?? [];
  }
  private childrenOf(id: string): Iterable<string> {
    return this.project.children.get(id) ?? [];
  }

  selectParents(selected: Set<string>, maxDepth: number | null = null): Set<string> {
    const parents = new Set<string>();
    let frontier = new Set(selected);
    let i = 0;
    while (frontier.size > 0 && (maxDepth === null || i < maxDepth)) {
      const next = new Set<string>();
      for (const node of frontier) for (const p of this.parentsOf(node)) if (!parents.has(p)) next.add(p);
      for (const x of next) parents.add(x);
      frontier = next;
      i++;
    }
    return parents;
  }

  selectChildren(selected: Set<string>, maxDepth: number | null = null): Set<string> {
    const children = new Set<string>();
    let frontier = new Set(selected);
    let i = 0;
    while (frontier.size > 0 && (maxDepth === null || i < maxDepth)) {
      const next = new Set<string>();
      for (const node of frontier) for (const c of this.childrenOf(node)) if (!children.has(c)) next.add(c);
      for (const x of next) children.add(x);
      frontier = next;
      i++;
    }
    return children;
  }

  selectChildrensParents(selected: Set<string>): Set<string> {
    const ancestorsFor = union(this.selectChildren(selected), selected);
    return union(this.selectParents(ancestorsFor), ancestorsFor);
  }

  selectSuccessors(selected: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const n of selected) {
      for (const c of this.childrenOf(n)) out.add(c);
      if (this.opts.withTestEdges) for (const c of this.project.testEdgeChildren.get(n) ?? []) out.add(c);
    }
    return out;
  }

  // -------------------------------------------------------------------------------------- selection
  private getNodesFromCriteria(spec: Criteria): [Set<string>, Set<string>] {
    const included = new Set(this.project.nodes.keys());
    const collected = search(this.ctx, spec.method, spec.args, spec.value, included);
    const neighbors = new Set<string>();
    if (spec.childrensParents) for (const x of this.selectChildrensParents(collected)) neighbors.add(x);
    if (spec.parents) for (const x of this.selectParents(collected, spec.parentsDepth)) neighbors.add(x);
    if (spec.children) for (const x of this.selectChildren(collected, spec.childrenDepth)) neighbors.add(x);
    const selected = union(collected, neighbors);
    let direct: Set<string>;
    let indirect: Set<string>;
    if (spec.indirect === 'empty') {
      direct = selected;
      indirect = new Set();
    } else {
      [direct, indirect] = this.expandSelection(selected, spec.indirect);
    }
    this.traces.push({ spec, collected, neighbors, direct, indirect });
    return [direct, indirect];
  }

  private isIndirectCandidate(id: string): boolean {
    const n = this.project.nodes.get(id);
    return !!n && (n.resource_type === 'test' || n.resource_type === 'unit_test') && (n.bucket === 'nodes' || n.bucket === 'unit_tests');
  }

  expandSelection(selected: Set<string>, mode: Indirect): [Set<string>, Set<string>] {
    const direct = new Set(selected);
    const indirect = new Set<string>();
    let selectedAndParents = new Set<string>();
    if (mode === 'buildable') {
      selectedAndParents = union(union(selected, this.selectParents(selected)), this.project.sourceIds);
    }
    for (const id of this.selectSuccessors(selected)) {
      if (!this.isIndirectCandidate(id)) continue;
      const deps = this.project.get(id).depends_on?.nodes ?? [];
      if (mode === 'eager' || deps.every((d) => selected.has(d))) direct.add(id);
      else if (mode === 'buildable' && deps.every((d) => selectedAndParents.has(d))) direct.add(id);
      else if (mode === 'empty') { /* nothing */ } else indirect.add(id);
    }
    return [direct, indirect];
  }

  private incorporateIndirect(direct: Set<string>, indirect: Set<string>, mode: Indirect): Set<string> {
    if (setEq(direct, indirect)) return direct;
    const selected = new Set(direct);
    if (mode === 'cautious') {
      for (const id of indirect) {
        const n = this.project.nodes.get(id);
        if (n && n.bucket === 'nodes' && (n.depends_on?.nodes ?? []).every((d) => selected.has(d))) selected.add(id);
      }
    } else if (mode === 'buildable') {
      const sap = union(selected, this.selectParents(selected));
      for (const id of indirect) {
        const n = this.project.nodes.get(id);
        if (n && n.bucket === 'nodes' && (n.depends_on?.nodes ?? []).every((d) => sap.has(d))) selected.add(id);
      }
    }
    return selected;
  }

  selectRecursively(spec: Spec, warnOnNoNodes = true): [Set<string>, Set<string>] {
    if (spec.kind === 'criteria') return this.getNodesFromCriteria(spec);
    const g = spec as Group;
    const bundles = g.components.map((c) => this.selectRecursively(c, warnOnNoNodes));
    const directSets = bundles.map(([d]) => d);
    const indirectSets = bundles.map(([d, i]) => union(d, i));
    const initialDirect = combine(g.kind, directSets);
    const indirectNodes = combine(g.kind, indirectSets);
    const direct = this.incorporateIndirect(initialDirect, indirectNodes, g.indirect);
    if (g.expectExists && direct.size === 0 && warnOnNoNodes) {
      const msg = `The selection criterion '${String(g.raw)}' does not match any enabled nodes`;
      this.onWarn('NoNodesForSelectionCriteria', msg);
      this.warnings.push(msg);
    }
    return [direct, indirectNodes];
  }

  /** NodeSelector.get_selected: selection + final resource type / empty node filter. */
  getSelected(spec: Spec, warnOnNoNodes = true): Set<string> {
    const [direct] = this.selectRecursively(spec, warnOnNoNodes);
    const out = new Set<string>();
    for (const id of direct) {
      const n = this.project.nodes.get(id);
      if (!n) continue;
      if (!this.opts.resourceTypes.has(n.resource_type)) continue;
      if (this.opts.freshnessOnly && !(n.resource_type === 'source' && sourceHasFreshness(n))) continue;
      if (!this.opts.includeEmptyNodes && n.empty) continue;
      out.add(id);
    }
    return out;
  }
}

function sourceHasFreshness(n: { freshness?: unknown; loaded_at_field?: string | null }): boolean {
  const f = n.freshness as { warn_after?: { count?: number | null }; error_after?: { count?: number | null } } | null | undefined;
  return !!f && (!!f.warn_after?.count || !!f.error_after?.count);
}

export function union<T>(a: Iterable<T>, b: Iterable<T>): Set<T> {
  const s = new Set(a);
  for (const x of b) s.add(x);
  return s;
}

function setEq<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function combine(kind: Group['kind'], sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set();
  if (kind === 'union') return sets.reduce((acc, s) => union(acc, s), new Set<string>());
  if (kind === 'intersection') {
    const [first, ...rest] = sets;
    return new Set([...first].filter((x) => rest.every((s) => s.has(x))));
  }
  const [first, ...rest] = sets;
  return new Set([...first].filter((x) => !rest.some((s) => s.has(x))));
}
