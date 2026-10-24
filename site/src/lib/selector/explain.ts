/** Plain-English explanation of a selection, step by step (simple words for non-native readers). */
import type { Project } from './project';
import type { Criteria, Group, Spec } from './spec';
import type { CommandResult } from './tasks';

export interface ExplainLine {
  /** the piece of the command, e.g. "+fct_orders" or "--exclude" */
  part: string;
  /** what it means */
  text: string;
  /** numbers from the real evaluation */
  count?: string;
  level: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function rawOf(c: Criteria): string {
  if (typeof c.raw === 'string') return c.raw;
  const d = c.raw as Record<string, unknown> | null;
  if (!d) return String(c.value);
  const m = c.implicitMethod ? '' : `${c.method}${c.args.length ? '.' + c.args.join('.') : ''}:`;
  let s = `${m}${String(c.value)}`;
  if (c.childrensParents) s = '@' + s;
  if (c.parents) s = `${c.parentsDepth ?? ''}+${s}`;
  if (c.children) s = `${s}+${c.childrenDepth ?? ''}`;
  return s;
}

const hasWild = (v: string) => /[*?[\]]/.test(v);

export function describeMethod(c: Criteria): string {
  const v = String(c.value);
  const q = `"${v}"`;
  switch (c.method) {
    case 'fqn':
      if (v === '*') return 'every node except the sources';
      if (hasWild(v)) return `every node whose name matches ${q} (* = any characters, ? = one character)`;
      if (v.includes('.')) return `the nodes under the path ${q} of the project (folder names separated by dots), or the node with this full name`;
      return `the node named ${q}, or every node in a folder (or package) called ${q}`;
    case 'tag': return `every node with the tag ${q}`;
    case 'path': return `every node whose file is in ${q}: models, tests, sources, seeds... every type`;
    case 'file': return `the nodes defined in a file named ${q} (with or without its extension)`;
    case 'package': return v === 'this' ? 'every node of this project (this = the project name)' : `every node of the package ${q}`;
    case 'source': {
      const parts = v.split('.');
      if (parts.length === 1) return v === '*' ? 'every source table' : `every table of the source ${q}`;
      if (parts.length === 2) return `the source table ${parts[1]} of the source ${parts[0]}`;
      return `the source table ${parts[2]} of the source ${parts[1]} in the package ${parts[0]}`;
    }
    case 'resource_type': return `every node of the type ${v} (a method: indirect selection then adds their tests)`;
    case 'config': return `every node whose config ${c.args.join('.') || '(nothing)'} equals ${q}${c.args[0] === 'severity' ? ' (upper or lower case)' : ''}`;
    case 'test_type': return v === 'unit' ? 'every unit test' : v === 'singular' ? 'every singular data test (a .sql file in tests/)' : v === 'generic' || v === 'schema' ? 'every generic data test (unique, not_null, ...)' : `test type ${q}: dbt reads it as a part of the word "data", "singular" or "unit"`;
    case 'test_name': return `every generic test called ${q} (and every unit test with this name)`;
    case 'unit_test': return `the unit tests named ${q}`;
    case 'exposure': return `the exposure ${q}`;
    case 'group': return `every model in the group ${q}`;
    case 'access': return `every model with access ${q}`;
    case 'version': return v === 'latest' ? 'the latest version of each versioned model' : v === 'old' ? 'the older versions of versioned models' : v === 'prerelease' ? 'versions newer than the latest one' : v === 'none' ? 'the models without versions' : `version ${q}`;
    case 'state': return ({
      new: 'nodes that do not exist in the state manifest',
      old: 'nodes that already exist in the state manifest',
      modified: 'new nodes and existing nodes that changed (compared with the state manifest)',
      unmodified: 'existing nodes with no change',
    } as Record<string, string>)[v] ?? `nodes where the ${v.replace('modified.', '')} part changed`;
    case 'result': return `nodes that ended with status ${q} in the previous run_results.json`;
    case 'source_status': return 'sources with newer data than in the previous freshness run';
    default: return `${c.method} ${q}`;
  }
}

export function describeOperators(c: Criteria): string[] {
  const out: string[] = [];
  if (c.parents) out.push(c.parentsDepth === null ? 'and all its parents (every node above it)' : `and its parents up to ${plural(c.parentsDepth, 'level')} up`);
  if (c.children) out.push(c.childrenDepth === null ? 'and all its children (every node below it)' : `and its children up to ${plural(c.childrenDepth, 'level')} down`);
  if (c.childrensParents) out.push('and all its children, and every parent of those children (what you need to build the children in an empty schema)');
  return out;
}

const INDIRECT: Record<string, string> = {
  eager: 'eager (default): a test is added when at least one of its parents is selected',
  cautious: 'cautious: a test is added only when all its parents are selected',
  buildable: 'buildable: a test is added when all its parents are selected or are parents of the selection',
  empty: 'empty: no test is added; only the nodes you selected',
};

export function explain(project: Project, r: CommandResult): ExplainLine[] {
  const lines: ExplainLine[] = [];
  if (!r.spec || !r.parsed) return lines;
  const args = r.parsed.args;
  const traceOf = (c: Criteria) => r.traces.find((t) => t.spec === c);
  const walk = (s: Spec, level: number) => {
    if (s.kind === 'criteria') {
      const t = traceOf(s);
      const ops = describeOperators(s);
      const counts: string[] = [];
      if (t) {
        counts.push(`${t.collected.size} node${t.collected.size === 1 ? ' matches' : 's match'}`);
        if (ops.length) counts.push(`${t.collected.size + [...t.neighbors].filter((x) => !t.collected.has(x)).length} nodes with the graph operator`);
        const added = [...t.direct].filter((x) => !t.collected.has(x) && !t.neighbors.has(x)).length;
        if (added) counts.push(`+${plural(added, 'test')} added by indirect selection`);
      }
      lines.push({ part: rawOf(s), text: [describeMethod(s), ...ops].join(', '), count: counts.join(', '), level });
      return;
    }
    const g = s as Group;
    if (g.role === 'root') {
      const [inc, exc] = g.components as Group[];
      walk(inc, level);
      if (exc.components.length) {
        lines.push({ part: '--exclude', text: 'everything below is removed at the end, after the selection. A test that touches a removed node is removed too.', level });
        walk(exc, level + 1);
      }
      return;
    }
    if (g.role === 'default') {
      lines.push({ part: '(no --select)', text: 'dbt starts from every node: fqn:* source:* exposure:* metric:* semantic_model:* (unit tests come with fqn:*).', level });
      return;
    }
    if (g.kind === 'union' && g.components.length > 1) {
      lines.push({ part: 'space', text: 'union: a node is kept if it matches at least one of these items', level });
      g.components.forEach((c) => walk(c, level + 1));
      return;
    }
    if (g.kind === 'intersection' && g.components.length > 1) {
      lines.push({ part: typeof g.raw === 'string' ? g.raw : 'intersection', text: 'comma = intersection: only the nodes that match every part', level });
      g.components.forEach((c) => walk(c, level + 1));
      return;
    }
    if (g.kind === 'difference') {
      walk(g.components[0], level);
      lines.push({ part: 'exclude', text: 'minus the nodes below', level });
      g.components.slice(1).forEach((c) => walk(c, level + 1));
      return;
    }
    g.components.forEach((c) => walk(c, level));
  };
  if (r.selectorUsed) {
    lines.push({ part: `--selector ${r.selectorUsed}`, text: 'the definition comes from selectors.yml. In dbt 1.11, --select and --exclude are then ignored.', level: 0 });
    walk(r.spec, 1);
  } else {
    walk(r.spec, 0);
  }
  if (args.indirectSelection !== 'eager' || r.traces.some((t) => t.spec.indirect !== 'eager')) {
    lines.push({ part: `--indirect-selection ${args.indirectSelection}`, text: INDIRECT[args.indirectSelection], level: 0 });
  } else {
    lines.push({ part: 'indirect selection', text: INDIRECT.eager, level: 0 });
  }
  const cmd = r.command ?? 'ls';
  const types = r.resourceTypes.slice().sort();
  const typeText: Record<string, string> = {
    ls: 'dbt ls lists every type except analyses (add --resource-type analysis or all to see them)',
    build: 'dbt build runs models, seeds, snapshots, tests, unit tests (and shows exposures as NO-OP)',
    run: 'dbt run runs models only', test: 'dbt test runs data tests and unit tests', seed: 'dbt seed loads seeds only',
    snapshot: 'dbt snapshot runs snapshots only', compile: 'dbt compile works on models, tests, snapshots, analyses, seeds',
  };
  if (args.resourceTypes.length || args.excludeResourceTypes.length || args.models) {
    const parts = [...args.resourceTypes.map((t) => `--resource-type ${t}`), ...args.excludeResourceTypes.map((t) => `--exclude-resource-type ${t}`)];
    lines.push({ part: args.models ? '--models' : parts.join(' '), text: `final filter on the result: only ${types.join(', ')} ${types.length === 1 ? 'is' : 'are'} kept. It is not a selection: tests are not added for it.`, level: 0 });
  } else if (typeText[cmd]) {
    lines.push({ part: `dbt ${cmd}`, text: typeText[cmd], level: 0 });
  }
  lines.push({ part: 'result', text: r.error ? 'dbt stops with an error' : r.command === 'ls' ? `${plural(r.selected.length, 'line')} printed` : `${plural(r.execution.filter((s) => s.index !== null).length, 'node')} would run`, level: 0 });
  void project;
  return lines;
}
