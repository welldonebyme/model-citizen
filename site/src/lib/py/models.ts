/**
 * Create dbt models of the reference project (tag ch11) in the browser database: each model is compiled by the
 * dbt-like Jinja engine (Pyodide) exactly as `dbt compile` would (target dev, schema dbt_adnane), then created in
 * DuckDB-WASM as a view or a table, parents first. Ephemeral models are not created: dbt inlines them as CTEs.
 * Used by the Jinja playground (ref() targets) and by book SQL examples that read a model (e.g. Chapter 18).
 * This is NOT dbt: it is a small, labelled simulation that only does compile + create (no tests, no hooks).
 */
import type { SqlEngine } from '../sql/engine.ts';
import type { ModelInfo } from './client.ts';
import { getPy } from './shared-py.ts';

export interface BuiltModel { name: string; relation: string; materialized: string; ms: number }

/**
 * Compile and create `names` and all their parents. Returns the created models in creation order.
 * `onStep` reports progress ("stg_jaffle_shop__orders").
 */
export async function buildModels(engine: SqlEngine, names: string[] | 'all', onStep?: (name: string, done: number, total: number) => void): Promise<BuiltModel[]> {
  const py = await getPy();
  const { models } = await py.models({ project: 'ch11' });
  const byName = new Map<string, ModelInfo>(models.map((m) => [m.name, m]));
  const compiled = new Map<string, { sql: string; parents: string[] }>();
  const compile = async (name: string) => {
    const m = byName.get(name);
    if (!m) throw new Error(`unknown model ${name}`);
    const r = await py.render({ mode: 'dbt', project: 'ch11', template: m.raw_code, node: { name, resource_type: 'model', path: m.path } }, { timeoutMs: 20_000 });
    if (r.status !== 'ok' || r.compiled === null) throw new Error(`${name} does not compile: ${r.error?.message ?? r.status}`);
    const parents = [...new Set((r.parse_refs ?? []).map((x) => x.name))];
    compiled.set(name, { sql: r.compiled, parents });
  };
  // the set to build: the wanted models and their ancestors (ephemeral parents are inlined, but their own parents count)
  const want = names === 'all' ? models.map((m) => m.name) : names;
  const todo = [...want];
  while (todo.length) {
    const n = todo.shift()!;
    if (compiled.has(n)) continue;
    await compile(n);
    for (const p of compiled.get(n)!.parents) if (!compiled.has(p)) todo.push(p);
  }
  // parents first
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string, stack: string[]) => {
    if (seen.has(n)) return;
    if (stack.includes(n)) throw new Error(`cycle: ${[...stack, n].join(' -> ')}`);
    for (const p of compiled.get(n)!.parents) visit(p, [...stack, n]);
    seen.add(n);
    order.push(n);
  };
  for (const n of compiled.keys()) visit(n, []);
  const toCreate = order.filter((n) => byName.get(n)!.materialized !== 'ephemeral');
  const schemas = [...new Set(toCreate.map((n) => byName.get(n)!).map((m) => `"${m.database}"."${m.schema}"`))];
  for (const s of schemas) {
    const r = await engine.run(`create schema if not exists ${s}`);
    if (r.kind === 'error') throw new Error(r.message);
  }
  const built: BuiltModel[] = [];
  for (const [i, n] of toCreate.entries()) {
    const m = byName.get(n)!;
    onStep?.(n, i, toCreate.length);
    const t0 = performance.now();
    const kind = m.materialized === 'view' ? 'view' : 'table'; // table, incremental (first run) -> table
    const drop = kind === 'view' ? `drop table if exists ${m.relation};\n` : `drop view if exists ${m.relation};\n`;
    const r = await engine.run(`${drop}create or replace ${kind} ${m.relation} as (\n${compiled.get(n)!.sql}\n)`);
    if (r.kind === 'error') throw new Error(`${n}: ${r.message.split('\n')[0]}`);
    built.push({ name: n, relation: m.relation, materialized: m.materialized, ms: Math.round(performance.now() - t0) });
  }
  return built;
}

/** For the SQL workspace and the parity suite: create the given models (and their parents). Returns their names. */
export async function createModels(engine: SqlEngine, names: string[]): Promise<string[]> {
  const built = await buildModels(engine, names);
  return built.map((b) => b.name);
}
