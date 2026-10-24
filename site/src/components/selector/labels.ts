import type { PNode, Project } from '../../lib/selector/project';
import type { NodeLabel } from './DagView';

const TYPE_WORD: Record<string, string> = {
  model: 'model', seed: 'seed', snapshot: 'snapshot', test: 'data test', unit_test: 'unit test', source: 'source',
  exposure: 'exposure', analysis: 'analysis', metric: 'metric', semantic_model: 'semantic model', saved_query: 'saved query',
};

export function typeWord(n: PNode): string {
  if (n.resource_type === 'test') return n.test_type === 'singular' ? 'singular data test' : 'generic data test';
  return TYPE_WORD[n.resource_type] ?? n.resource_type;
}

export function displayName(n: PNode): string {
  if (n.resource_type === 'source') return `${n.source_name}.${n.name}`;
  if (n.resource_type === 'model' && n.version !== null && n.version !== undefined) return `${n.name} v${n.version}`;
  return n.name;
}

export function labelOf(project: Project, id: string): NodeLabel {
  const n = project.get(id);
  const cfg = n.config ?? {};
  let kind: string = typeWord(n);
  let title = displayName(n);
  if (n.resource_type === 'source') { kind = `source · ${n.source_name}`; title = n.name; }
  if (n.resource_type === 'model') {
    const folder = n.fqn.length > 2 ? n.fqn[1] : 'model';
    let mat = String(cfg.materialized ?? '');
    if (mat === 'incremental' && cfg.incremental_strategy === 'microbatch') mat = 'microbatch';
    kind = `${folder} · ${mat}${n.language === 'python' ? ' · Python' : ''}`;
  }
  if (n.resource_type === 'exposure') kind = `exposure · ${n.type ?? ''}`;
  if (n.resource_type === 'unit_test') title = `unit: ${n.name}${n.version !== null && n.version !== undefined ? ` (v${n.version})` : ''}`;
  if (n.resource_type === 'test') title = `test: ${n.name}`;
  const long = `${displayName(n)}, ${typeWord(n)}${n.resource_type === 'model' ? ` (${kind})` : ''}`;
  return { title, kind, long };
}
