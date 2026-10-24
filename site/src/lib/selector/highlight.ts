/** Per-node status of a command result, for the graph colours, the list view and the node details. */
import type { Criteria, Group } from './spec';
import type { CommandResult } from './tasks';

export type NodeState = 'matched' | 'neighbor' | 'indirect' | 'excluded' | 'filtered' | 'none';

export interface NodeInfoState {
  state: NodeState;
  /** the criteria that brought the node, written as in the command (e.g. "+fct_orders") */
  why: string[];
  /** how each criterion reached it */
  how: ('method' | 'graph' | 'test')[];
}

function rawOf(c: Criteria): string {
  if (typeof c.raw === 'string') return c.raw;
  const m = c.implicitMethod ? '' : `${c.method}${c.args.length ? '.' + c.args.join('.') : ''}:`;
  let s = `${m}${String(c.value)}`;
  if (c.childrensParents) s = '@' + s;
  if (c.parents) s = `${c.parentsDepth ?? ''}+${s}`;
  if (c.children) s = `${s}+${c.childrenDepth ?? ''}`;
  return s;
}

export function nodeStates(r: CommandResult): Map<string, NodeInfoState> {
  const out = new Map<string, NodeInfoState>();
  const final = new Set([...r.selected, ...r.selectedUnitTests]);
  const spec = r.spec;
  let excluded = new Set<string>();
  let pre = new Set<string>();
  if (spec && spec.kind !== 'criteria') {
    pre = r.groupResults.get(spec) ?? new Set();
    const g = spec as Group;
    if (g.kind === 'difference' && g.components.length === 2) {
      const inc = r.groupResults.get(g.components[0]) ?? new Set<string>();
      const exc = g.components[1].kind === 'criteria'
        ? (r.traces.find((t) => t.spec === g.components[1])?.direct ?? new Set<string>())
        : (r.groupResults.get(g.components[1]) ?? new Set<string>());
      excluded = new Set([...inc].filter((x) => exc.has(x)));
    }
  } else if (spec) {
    pre = r.traces.find((t) => t.spec === spec)?.direct ?? new Set();
  }
  const excludeSide = new Set<Criteria>();
  if (spec && spec.kind === 'difference' && (spec as Group).components.length === 2) {
    const walk = (s: Group['components'][number]) => { if (s.kind === 'criteria') excludeSide.add(s); else s.components.forEach(walk); };
    walk((spec as Group).components[1]);
  }
  const get = (id: string) => {
    let x = out.get(id);
    if (!x) { x = { state: 'none', why: [], how: [] }; out.set(id, x); }
    return x;
  };
  for (const t of r.traces) {
    if (excludeSide.has(t.spec)) continue;
    const raw = rawOf(t.spec);
    for (const id of t.direct) {
      const how = t.collected.has(id) ? 'method' : t.neighbors.has(id) ? 'graph' : 'test';
      const x = get(id);
      if (!x.why.includes(raw)) { x.why.push(raw); x.how.push(how); }
    }
  }
  for (const [id, x] of out) {
    if (final.has(id)) x.state = x.how.includes('method') ? 'matched' : x.how.includes('graph') ? 'neighbor' : 'indirect';
    else if (excluded.has(id)) x.state = 'excluded';
    else if (pre.has(id)) x.state = 'filtered';
  }
  for (const id of final) if (!out.has(id)) out.set(id, { state: 'neighbor', why: [], how: [] });
  for (const id of excluded) { const x = get(id); if (!final.has(id)) x.state = 'excluded'; }
  return out;
}
