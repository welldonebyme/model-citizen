/**
 * Browser SQL engine: DuckDB-WASM running in its own Web Worker (the package's
 * duckdb-browser-{eh,mvp}.worker.js), self-hosted next to the site (no CDN), no threads (no COOP/COEP).
 *
 * Reproduces labs/setup.sql exactly: an in-memory database ATTACHed as `practice` (so that
 * `practice.jaffle_shop.orders` works like with practice.duckdb), the 5 CSVs registered under the
 * same relative paths that setup.sql reads (`data/*.csv`), then setup.sql runs verbatim.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import { bundles, bundleName, CHANNEL } from './bundles';
import { splitSqlStatements, type Actual } from './compare';
import { arrowToResultSet, type ResultSet } from './format';

export const CSV_FILES = ['customers', 'orders', 'order_items', 'products', 'payments'] as const;

export type Phase = 'worker' | 'download' | 'open' | 'data' | 'setup' | 'ready' | 'error';
export interface Progress { phase: Phase; loaded?: number; total?: number; message?: string }

export interface EngineInfo {
  duckdbVersion: string;
  sourceId: string;
  bundle: string;
  channel: string;
  libraryVersion: string;
  timingsMs: Record<string, number>;
}

export type RunResult =
  | (Extract<Actual, { kind: 'table' }> & { types: string[]; elapsedMs: number; statements: number; truncatedAt?: number; totalRows: number })
  | (Extract<Actual, { kind: 'error' }> & { elapsedMs: number; statements: number; failedStatement: number });

/** Join a path to the site base (import.meta.env.BASE_URL is "/dbt-academy/" on GitHub Pages). */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
  return base + path.replace(/^\//, '');
}

export class SqlEngine {
  private constructor(
    private readonly db: duckdb.AsyncDuckDB,
    private conn: duckdb.AsyncDuckDBConnection,
    private readonly worker: Worker,
    public readonly info: EngineInfo,
    private readonly files: Map<string, Uint8Array>,
  ) {}

  static async create(onProgress: (p: Progress) => void = () => {}): Promise<SqlEngine> {
    const t0 = performance.now();
    const mark: Record<string, number> = {};
    const lap = (k: string) => { mark[k] = Math.round(performance.now() - t0); };

    // absolute URLs: the DuckDB worker resolves them against its own location
    const bundle = await duckdb.selectBundle(bundles() as unknown as duckdb.DuckDBBundles);
    const kind = bundleName(bundle.mainModule);
    onProgress({ phase: 'worker', message: `starting worker (${kind})` });
    const worker = new Worker(bundle.mainWorker!);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    lap('workerStarted');

    // the CSVs + setup.sql are fetched in parallel with the wasm download
    const dataPromise = Promise.all([
      ...CSV_FILES.map(async (f) => {
        const r = await fetch(withBase(`data/${f}.csv`));
        if (!r.ok) throw new Error(`data/${f}.csv: HTTP ${r.status}`);
        return [`data/${f}.csv`, new Uint8Array(await r.arrayBuffer())] as const;
      }),
      ...['setup.sql', 'updates/day2.sql', 'updates/fresh_load.sql'].map(async (f) => {
        const r = await fetch(withBase(`data/${f}`));
        if (!r.ok) throw new Error(`data/${f}: HTTP ${r.status}`);
        return [f, new TextEncoder().encode(await r.text())] as const;
      }),
    ]);

    onProgress({ phase: 'download', loaded: 0 });
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker, (p) => {
      onProgress({ phase: 'download', loaded: p.bytesLoaded, total: p.bytesTotal });
    });
    lap('instantiated');
    onProgress({ phase: 'open' });
    await db.open({ query: { castBigIntToDouble: false, castDecimalToDouble: false } });
    const conn = await db.connect();
    const vrow = arrowToResultSet(await conn.query('select version() as v, (select source_id from pragma_version()) as s')).rows[0];
    lap('opened');

    onProgress({ phase: 'data' });
    const files = new Map(await dataPromise);
    lap('dataFetched');

    const info: EngineInfo = {
      duckdbVersion: String(vrow[0]),
      sourceId: String(vrow[1]),
      bundle: kind,
      channel: CHANNEL,
      libraryVersion: duckdb.PACKAGE_VERSION,
      timingsMs: mark,
    };
    const engine = new SqlEngine(db, conn, worker, info, files);
    onProgress({ phase: 'setup' });
    await engine.loadPracticeDatabase();
    lap('setupDone');
    onProgress({ phase: 'ready' });
    return engine;
  }

  /** (Re)create the `practice` database exactly like `duckdb practice.duckdb < setup.sql`. */
  async loadPracticeDatabase(): Promise<RunResult> {
    for (const f of CSV_FILES) {
      await this.db.registerFileBuffer(`data/${f}.csv`, this.files.get(`data/${f}.csv`)!.slice());
    }
    await this.conn.query("attach if not exists ':memory:' as practice");
    await this.conn.query('use practice');
    const res = await this.run(this.text('setup.sql'));
    if (res.kind === 'error') throw new Error(`setup.sql failed: ${res.message}`);
    return res;
  }

  /** Reset button: drop everything (sandbox schemas, day-2 changes) and reload day 1. */
  async reset(): Promise<RunResult> {
    await this.conn.close();
    this.conn = await this.db.connect();
    await this.conn.query('use memory');
    await this.conn.query('detach database if exists practice');
    return this.loadPracticeDatabase();
  }

  text(name: 'setup.sql' | 'updates/day2.sql' | 'updates/fresh_load.sql'): string {
    return new TextDecoder().decode(this.files.get(name)!);
  }

  /**
   * Run a script like the DuckDB CLI / the book's run_sql.py: every statement in order, the result
   * of the LAST statement is returned. (Passing a multi-statement string straight to conn.query()
   * returns the FIRST select's result in DuckDB-WASM, which does not match the book.)
   */
  async run(sql: string, maxRows = 10_000): Promise<RunResult> {
    const t0 = performance.now();
    const statements = splitSqlStatements(sql);
    let last: ResultSet & { totalRows: number } = { columns: [], types: [], rows: [], totalRows: 0 };
    for (let i = 0; i < statements.length; i++) {
      try {
        const table = await this.conn.query(statements[i]);
        last = { ...arrowToResultSet(table, maxRows), totalRows: table.numRows };
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e), elapsedMs: performance.now() - t0, statements: statements.length, failedStatement: i + 1 };
      }
    }
    return {
      kind: 'table', columns: last.columns, types: last.types, rows: last.rows, totalRows: last.totalRows,
      truncatedAt: last.totalRows > maxRows ? maxRows : undefined,
      elapsedMs: performance.now() - t0, statements: statements.length,
    };
  }

  async terminate(): Promise<void> {
    await this.db.terminate();
    this.worker.terminate();
  }
}
