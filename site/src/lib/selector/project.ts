/**
 * The project as dbt's selector sees it: every graph member (nodes, sources, exposures, unit tests...),
 * the selection graph (parent -> child edges) and the extra "parent_test" edges `dbt build` adds.
 */
import type { Dag, DagNode, Extras, ResourceType, SelectorDef } from './types';
import { VirtualFs } from './vfs';

/** Which manifest dictionary a node lives in (dbt iterates them separately in many methods). */
export type Bucket = 'nodes' | 'sources' | 'exposures' | 'unit_tests' | 'metrics' | 'semantic_models' | 'saved_queries' | 'functions';

export interface PNode extends DagNode {
  bucket: Bucket;
  patch_path?: string | null;
  empty?: boolean;
}

export type Target = 'dev' | 'prod' | 'ci';

const BUCKET: Partial<Record<ResourceType, Bucket>> = {
  source: 'sources', exposure: 'exposures', unit_test: 'unit_tests', metric: 'metrics',
  semantic_model: 'semantic_models', saved_query: 'saved_queries', function: 'functions',
};

export function bucketOf(rt: ResourceType): Bucket {
  return BUCKET[rt] ?? 'nodes';
}

export class Project {
  readonly name: string;
  readonly key: string;
  readonly tag: string;
  readonly nodes = new Map<string, PNode>();
  /** selection graph */
  readonly parents = new Map<string, Set<string>>();
  readonly children = new Map<string, Set<string>>();
  /** build graph = selection graph + parent_test edges (test -> node) */
  readonly testEdgeChildren = new Map<string, Set<string>>();
  readonly testEdgeParents = new Map<string, Set<string>>();
  readonly selectors: Record<string, SelectorDef>;
  readonly selectorNames: string[];
  readonly fs: VirtualFs;
  readonly hasFiles: boolean;
  readonly sourceIds: Set<string>;

  constructor(readonly dag: Dag, readonly extras: Extras | null = null) {
    this.name = dag.project;
    this.key = dag.key;
    this.tag = dag.tag;
    const all: DagNode[] = [...dag.nodes, ...dag.sources, ...dag.exposures];
    for (const n of all) {
      if (n.resource_type === 'operation' || n.resource_type === 'sql_operation') continue;
      // search_name = what `dbt ls --output name` prints (node.search_name in dbt-core 1.11.16). Computed here because
      // the generated DAG adds a _v<version> suffix to versioned unit tests, which dbt does not print.
      const p: PNode = { ...n, bucket: bucketOf(n.resource_type), search_name: searchName(n) };
      if (extras) {
        p.patch_path = extras.patch_path[n.unique_id] ?? null;
        p.empty = extras.empty.includes(n.unique_id);
      }
      this.nodes.set(n.unique_id, p);
      this.parents.set(n.unique_id, new Set());
      this.children.set(n.unique_id, new Set());
      this.testEdgeChildren.set(n.unique_id, new Set());
      this.testEdgeParents.set(n.unique_id, new Set());
    }
    for (const [a, b] of dag.edges) {
      if (!this.nodes.has(a) || !this.nodes.has(b)) continue;
      this.children.get(a)!.add(b);
      this.parents.get(b)!.add(a);
    }
    for (const [a, b] of dag.test_edges) {
      if (!this.nodes.has(a) || !this.nodes.has(b)) continue;
      // networkx DiGraph.add_edge on an existing edge only updates its data: an existing plain edge
      // becomes a parent_test edge. That never happens here (tests have no plain children).
      this.testEdgeChildren.get(a)!.add(b);
      this.testEdgeParents.get(b)!.add(a);
    }
    this.selectors = dag.selectors ?? {};
    this.selectorNames = Object.keys(this.selectors);
    this.sourceIds = new Set([...this.nodes.values()].filter((n) => n.bucket === 'sources').map((n) => n.unique_id));
    const files = extras?.files ?? derivedFiles(all);
    this.hasFiles = !!extras;
    this.fs = new VirtualFs(files);
  }

  get(uid: string): PNode {
    const n = this.nodes.get(uid);
    if (!n) throw new Error(`Node ${uid} not found in the manifest!`);
    return n;
  }

  ids(): string[] {
    return [...this.nodes.keys()];
  }

  /** node.config for a target (prod differences come from `dbt parse --target prod`). */
  config(uid: string, target: Target = 'dev'): Record<string, unknown> {
    const n = this.get(uid);
    const dict = this.extras?.dicts[uid];
    const base = (dict && typeof dict.config === 'object' && dict.config) ? dict.config as Record<string, unknown> : n.config;
    if (target === 'prod' && n.prod?.config) return { ...base, ...n.prod.config };
    return base;
  }

  /** schema / alias / database for a target. */
  relation(uid: string, target: Target = 'dev'): { database: string | null; schema: string | null; alias: string | null } {
    const n = this.get(uid);
    let database = n.database ?? null;
    let schema = n.schema ?? null;
    let alias = n.alias ?? null;
    if (target === 'prod' && n.prod) {
      database = n.prod.database ?? database;
      schema = n.prod.schema ?? schema;
      alias = n.prod.alias ?? alias;
    }
    if (target === 'ci' && this.extras?.ci[uid]) {
      const c = this.extras.ci[uid];
      if (c.database !== undefined) database = c.database;
      if (c.schema !== undefined) schema = c.schema;
      if (c.alias !== undefined) alias = c.alias;
    }
    return { database, schema, alias };
  }

  isEphemeralModel(uid: string): boolean {
    const n = this.get(uid);
    return n.resource_type === 'model' && n.config.materialized === 'ephemeral';
  }
}

function searchName(n: DagNode): string {
  if (n.resource_type === 'source') return `${n.source_name}.${n.name}`;
  if (n.resource_type === 'model' && n.version !== null && n.version !== undefined) return `${n.name}.v${n.version}`;
  return n.name;
}

/** Without the extras file, the folders `path:` can see are those of the nodes' own files. */
function derivedFiles(all: DagNode[]): string[] {
  const out = new Set<string>();
  for (const n of all) if (n.original_file_path) out.add(n.original_file_path);
  return [...out];
}

/** Python's sorted() on strings = code point order. */
export function pySort(a: string[]): string[] {
  return [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}
