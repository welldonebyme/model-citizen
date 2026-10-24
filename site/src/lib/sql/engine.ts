/**
 * Browser SQL engine: DuckDB-WASM in its own Web Worker (the package's duckdb-browser-eh.worker.js),
 * self-hosted next to the site (no CDN), single-threaded (no COOP/COEP needed).
 *
 * Reproduces labs/setup.sql exactly: an in-memory database ATTACHed as `practice` (so that
 * `practice.jaffle_shop.orders` works like with practice.duckdb), the 5 CSVs registered under the
 * same relative names that setup.sql reads (`data/*.csv`), then setup.sql runs verbatim.
 * Loaded lazily by shared-engine.ts (dynamic import): reading pages never download any of this.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import { ehBundle } from './bundles.ts';
import { splitSqlStatements, type Actual } from './compare.ts';
import { arrowToJson, arrowToResultSet, type JsonCell } from './format.ts';
import manifest from './data-manifest.json';

export const CSV_FILES = ['customers', 'orders', 'order_items', 'products', 'payments'] as const;
export type ScriptName = 'setup.sql' | 'updates/day2.sql' | 'updates/fresh_load.sql';

export type Phase = 'code' | 'worker' | 'download' | 'open' | 'data' | 'setup' | 'ready' | 'error';
export interface Progress {
  phase: Phase;
  /** 0..1 during the download (decompressed bytes / real size) */
  fraction?: number;
  message?: string;
}

export interface EngineInfo {
  duckdbVersion: string;
  sourceId: string;
  bundle: 'eh';
  libraryVersion: string;
  dataVersion: string;
  timingsMs: Record<string, number>;
}

export type TableResult = Extract<Actual, { kind: 'table' }> & {
  types: string[];
  numeric: boolean[];
  elapsedMs: number;
  statements: number;
  /** rows of the real result (rows[] may hold fewer: see maxRows) */
  totalRows: number;
  /** the last statement returned no result set (create, insert, ...) */
  noResultSet: boolean;
};
export type ErrorResult = Extract<Actual, { kind: 'error' }> & { elapsedMs: number; statements: number; failedStatement: number; failedSql: string };
export type RunResult = TableResult | ErrorResult;

export class EngineUnsupportedError extends Error {}

/** Join a path to the site base (import.meta.env.BASE_URL is "/model-citizen/" on GitHub Pages). */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
  return base + path.replace(/^\//, '');
}

/** URL of a practice file, versioned by the data content hash (the service worker caches it per version). */
export function dataUrl(rel: string): string {
  return withBase(`data/${rel}`) + `?v=${manifest.version}`;
}

/** Statements DuckDB returns as a one-row "Count" table (insert/update/delete) or an empty table (DDL). */
const NO_RESULT = /^\s*(create|drop|alter|insert|update|delete|attach|detach|use|set|reset|begin|commit|rollback|copy|install|load|pragma|checkpoint|vacuum|truncate)\b/i;

export class SqlEngine {
  private chain: Promise<unknown> = Promise.resolve();
  /** what was done to the data since the last reset (shown in the UI) */
  state = { day2: false, freshLoads: 0 };

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

    const features = await duckdb.getPlatformFeatures();
    if (!features.wasmExceptions) {
      throw new EngineUnsupportedError('This browser is too old for the SQL engine. Please update it (Edge, Chrome, Firefox or Safari from 2022 or newer).');
    }
    const bundle = ehBundle();
    onProgress({ phase: 'worker' });
    const worker = new Worker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    lap('workerStarted');

    // the CSVs and scripts are fetched in parallel with the wasm download
    const dataPromise = Promise.all([
      ...CSV_FILES.map(async (f) => {
        const r = await fetch(dataUrl(`practice/data/${f}.csv`));
        if (!r.ok) throw new Error(`data/${f}.csv: HTTP ${r.status}`);
        return [`data/${f}.csv`, new Uint8Array(await r.arrayBuffer())] as const;
      }),
      ...(['setup.sql', 'updates/day2.sql', 'updates/fresh_load.sql'] as const).map(async (f) => {
        const r = await fetch(dataUrl(`practice/${f}`));
        if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
        return [f, new Uint8Array(await r.arrayBuffer())] as const;
      }),
    ]);
    dataPromise.catch(() => {}); // awaited below; avoid an unhandled rejection while the wasm downloads

    onProgress({ phase: 'download', fraction: 0 });
    const rawSize = manifest.wasm.eh.wasm.size;
    await db.instantiate(bundle.mainModule, undefined, (p) => {
      // bytesLoaded counts DEcompressed bytes, bytesTotal is the Content-Length (gzip-compressed on GitHub Pages)
      onProgress({ phase: 'download', fraction: Math.min(1, p.bytesLoaded / Math.max(rawSize, p.bytesTotal || 0, 1)) });
    });
    lap('instantiated');
    onProgress({ phase: 'open' });
    await db.open({ query: { castBigIntToDouble: false, castDecimalToDouble: false } });
    const conn = await db.connect();
    const v = await conn.query('select version() as v, (select source_id from pragma_version()) as s');
    const vrow = arrowToResultSet(v).rows[0];
    // time zone functions need the ICU extension: load it from this site (self-hosted), never from extensions.duckdb.org
    const repo = new URL(withBase(`data/${manifest.extensionRepository}`), self.location.href).href;
    await conn.query(`set custom_extension_repository = '${repo}'`);
    await conn.query(`set autoinstall_extension_repository = '${repo}'`);
    lap('opened');

    onProgress({ phase: 'data' });
    const files = new Map<string, Uint8Array>(await dataPromise);
    lap('dataFetched');

    const info: EngineInfo = {
      duckdbVersion: String(vrow[0]),
      sourceId: String(vrow[1]),
      bundle: 'eh',
      libraryVersion: duckdb.PACKAGE_VERSION,
      dataVersion: manifest.version,
      timingsMs: mark,
    };
    const engine = new SqlEngine(db, conn, worker, info, files);
    onProgress({ phase: 'setup' });
    await engine.loadPracticeDatabase();
    lap('setupDone');
    onProgress({ phase: 'ready' });
    return engine;
  }

  /** One script at a time on the shared connection (several islands may ask at once). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  /** (Re)create the `practice` database exactly like `duckdb practice.duckdb < setup.sql`. */
  private async loadPracticeDatabase(): Promise<void> {
    for (const f of CSV_FILES) {
      await this.db.registerFileBuffer(`data/${f}.csv`, this.files.get(`data/${f}.csv`)!.slice());
    }
    await this.conn.query("attach if not exists ':memory:' as practice");
    await this.conn.query('use practice');
    const res = await this.runNow(this.text('setup.sql'));
    if (res.kind === 'error') throw new Error(`setup.sql failed: ${res.message}`);
    this.state = { day2: false, freshLoads: 0 };
  }

  /** Reset button: drop everything (your own tables, day-2 changes, fresh loads) and load day 1 again. */
  reset(): Promise<void> {
    return this.serial(async () => {
      await this.conn.close();
      this.conn = await this.db.connect();
      await this.conn.query('use memory');
      await this.conn.query('detach database if exists practice');
      await this.loadPracticeDatabase();
    });
  }

  /** labs/updates/day2.sql (safe to run twice). Returns the script's check query (row counts). */
  async applyDay2(): Promise<RunResult> {
    const r = await this.run(this.text('updates/day2.sql'));
    if (r.kind === 'table') this.state.day2 = true;
    return r;
  }

  /** labs/updates/fresh_load.sql: 2 more orders loaded "now" (needs ICU for `at time zone 'UTC'`). */
  async freshLoad(): Promise<RunResult> {
    const r = await this.run(this.text('updates/fresh_load.sql'));
    if (r.kind === 'table') this.state.freshLoads++;
    else await this.run('rollback').catch(() => {}); // the script opened a transaction
    return r;
  }

  text(name: ScriptName): string {
    return new TextDecoder().decode(this.files.get(name)!);
  }

  /**
   * Run a script like the DuckDB CLI / the book's run_sql.py: every statement in order, the result of the
   * LAST statement is returned. (Passing a multi-statement string straight to conn.query() returns the
   * FIRST result in DuckDB-WASM, which does not match the book.)
   */
  run(sql: string, maxRows = 10_000): Promise<RunResult> {
    return this.serial(() => this.runNow(sql, maxRows));
  }

  private async runNow(sql: string, maxRows = 10_000): Promise<RunResult> {
    const t0 = performance.now();
    const statements = splitSqlStatements(sql);
    let last: TableResult | null = null;
    for (let i = 0; i < statements.length; i++) {
      try {
        const table = await this.conn.query(statements[i]);
        const rs = arrowToResultSet(table, maxRows);
        last = {
          kind: 'table', columns: rs.columns, types: rs.types, numeric: rs.numeric, rows: rs.rows, totalRows: table.numRows,
          noResultSet: NO_RESULT.test(statements[i]) && (rs.columns.length === 0 || (rs.columns.length === 1 && rs.columns[0] === 'Count')),
          elapsedMs: 0, statements: statements.length,
        };
      } catch (e) {
        return {
          kind: 'error', message: e instanceof Error ? e.message : String(e), elapsedMs: performance.now() - t0,
          statements: statements.length, failedStatement: i + 1, failedSql: statements[i],
        };
      }
    }
    const res: TableResult = last ?? { kind: 'table', columns: [], types: [], numeric: [], rows: [], totalRows: 0, noResultSet: true, elapsedMs: 0, statements: 0 };
    res.elapsedMs = performance.now() - t0;
    return res;
  }

  /** For the Jinja playground (run_query, adapter.*): JSON-friendly values, numbers stay numbers. */
  queryJson(sql: string): Promise<{ columns: string[]; rows: JsonCell[][] }> {
    return this.serial(async () => {
      const statements = splitSqlStatements(sql);
      let out: { columns: string[]; rows: JsonCell[][] } = { columns: [], rows: [] };
      for (const s of statements) out = arrowToJson(await this.conn.query(s));
      return out;
    });
  }

  async terminate(): Promise<void> {
    try { await this.db.terminate(); } catch { /* already gone */ }
    this.worker.terminate();
  }
}
