/** Shapes of the generated data (site/src/generated/dag/*.json and site/src/lib/selector/data/extras-*.json). */

export type ResourceType =
  | 'model' | 'seed' | 'snapshot' | 'analysis' | 'test' | 'unit_test' | 'source' | 'exposure'
  | 'metric' | 'semantic_model' | 'saved_query' | 'function' | 'operation' | 'sql_operation';

export interface DagNode {
  unique_id: string;
  name: string;
  resource_type: ResourceType;
  package_name: string;
  path: string | null;
  original_file_path: string | null;
  fqn: string[];
  tags: string[];
  config: Record<string, unknown>;
  depends_on?: { nodes: string[]; macros?: string[] };
  ls: string;
  search_name: string;
  language?: string | null;
  database?: string | null;
  schema?: string | null;
  alias?: string | null;
  relation_name?: string | null;
  checksum?: string | null;
  access?: string | null;
  group?: string | null;
  version?: number | string | null;
  latest_version?: number | string | null;
  deprecation_date?: string | null;
  contract_enforced?: boolean;
  description?: string;
  test_type?: 'generic' | 'singular';
  test_metadata?: { name: string; namespace: string | null } | null;
  attached_node?: string | null;
  column_name?: string | null;
  file_key_name?: string | null;
  model?: string;
  versions?: unknown;
  source_name?: string;
  identifier?: string;
  loaded_at_field?: string | null;
  freshness?: unknown;
  type?: string;
  maturity?: string | null;
  owner?: { email?: string | null; name?: string | null } | null;
  label?: string | null;
  url?: string | null;
  prod?: { database?: string; schema?: string; alias?: string; relation_name?: string; config?: Record<string, unknown> };
}

export interface SelectorDef {
  name: string;
  description?: string;
  definition: unknown;
  default?: unknown;
}

export interface Dag {
  schema: number;
  project: string;
  key: string;
  tag: string;
  dbt_version?: string;
  found_line?: string | null;
  counts?: Record<string, number>;
  packages?: string[];
  nodes: DagNode[];
  sources: DagNode[];
  exposures: DagNode[];
  groups?: { unique_id: string; name: string; owner?: unknown }[];
  macros?: { unique_id: string; name: string; original_file_path: string }[];
  edges: [string, string][];
  test_edges: [string, string][];
  selectors: Record<string, SelectorDef>;
  selectors_yml: string | null;
  ls_all?: string[];
}

export interface Extras {
  schema: number;
  key: string;
  tag: string;
  project: string;
  files: string[];
  patch_path: Record<string, string>;
  empty: string[];
  hooks: { unique_id: string; package_name: string; name: string; index: number | null; tags: string[] }[];
  ci: Record<string, { database?: string; schema?: string; alias?: string }>;
  state_prev: null | { prev_tag: string; results: Record<string, string[]>; errors: Record<string, string> };
  /** node.to_dict(omit_none=False) without heavy keys; floats are {"__f": "<repr>"} */
  dicts: Record<string, Record<string, unknown>>;
  selfcheck?: unknown;
}
