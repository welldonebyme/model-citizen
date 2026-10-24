/**
 * Main-thread client for py.worker.ts (from spikes/pyodide/site/js/pyodide-client.mjs).
 *
 *   const py = new PyClient({ onQuery: (sql) => engine.queryJson(sql) });
 *   await py.ready;
 *   const r = await py.render({ mode: 'dbt', template, project: 'ch11' });
 *   const v = await py.validate({ text, engine: 'dbt', path: 'models/staging/_stg_models.yml' });
 *
 * Queue: requests wait on the MAIN thread and at most one is in flight. A busy worker cannot read messages
 * (Python runs synchronously), so a worker-side queue could not drop a cancelled request.
 * Timeouts, without SharedArrayBuffer (GitHub Pages cannot send COOP/COEP):
 *   soft = deadlineMs passed to Python: a sys.monitoring watchdog stops pure-Python loops cleanly
 *          -> result { status: 'timeout', soft: true }; the worker stays alive and warm;
 *   hard = timeoutMs on the main thread: when the worker does not answer (a long C call such as 9 ** (9 ** 8),
 *          a hang, a fatal error) it is terminated and a new one is started (from the cache: ~1.5 s).
 * Cancellation (AbortSignal): a queued request is dropped; a running one finishes (renders take milliseconds,
 * the soft deadline bounds them) unless cancelRunning = 'terminate'.
 */

export interface PyInfo {
  pyodide: string; python: string; pyyaml: string; jinja2: string; libyaml: string | null;
  stages: Record<string, number>; crossOriginIsolated: boolean; sharedArrayBuffer: boolean; mainThreadReadyMs?: number;
}

export interface PyClientOptions {
  /** Pyodide folder (default <base>engines/pyodide/<version>/) */
  indexURL?: string;
  hardTimeoutMs?: number;
  softTimeoutMs?: number;
  initTimeoutMs?: number;
  cancelRunning?: 'wait' | 'terminate';
  maxInitFailures?: number;
  /** answers run_query / adapter.* during a render (DuckDB-WASM in the playgrounds) */
  onQuery?: ((sql: string) => Promise<{ columns: string[]; rows: unknown[][] }>) | null;
  onProgress?: ((m: { stage: string; ms: number }) => void) | null;
  onRestart?: ((reason: string) => void) | null;
}

export type PyErrorCode = 'TIMEOUT' | 'CANCELLED' | 'RESTARTED' | 'FATAL' | 'WORKER_ERROR' | 'UNAVAILABLE';
export class PyError extends Error {
  constructor(message: string, public code: PyErrorCode) { super(message); }
}

interface Pending {
  msg: Record<string, unknown> & { id: number; deadlineMs: number };
  hard: number;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export const PYODIDE_VERSION = '314.0.7';

export function defaultIndexURL(): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
  return new URL(`${base}engines/pyodide/${PYODIDE_VERSION}/`, self.location.href).href;
}

export class PyClient {
  ready!: Promise<PyInfo>;
  info: PyInfo | null = null;
  isReady = false;
  stats = { restarts: 0, spawns: 0 };
  private opts: Required<Omit<PyClientOptions, 'indexURL'>> & { indexURL: string };
  private seq = 0;
  private queue: Pending[] = [];
  private inflight: Pending | null = null;
  private worker!: Worker;
  private generation = 0;
  private initFailures = 0;
  private g!: { gen: number; resolve: (i: PyInfo) => void; reject: (e: Error) => void; initTimer: ReturnType<typeof setTimeout> };

  constructor(opts: PyClientOptions = {}) {
    this.opts = {
      indexURL: opts.indexURL ?? defaultIndexURL(),
      hardTimeoutMs: 10_000, softTimeoutMs: 3_000, initTimeoutMs: 120_000, cancelRunning: 'wait', maxInitFailures: 2,
      onQuery: null, onProgress: null, onRestart: null,
      ...opts,
    } as PyClient['opts'];
    this.spawn();
  }

  private spawn() {
    const gen = ++this.generation;
    this.worker = new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module', name: 'model-citizen-python' });
    this.stats.spawns++;
    this.isReady = false;
    const t0 = performance.now();
    this.ready = new Promise<PyInfo>((resolve, reject) => {
      this.g = { gen, resolve, reject, initTimer: setTimeout(() => gen === this.generation && this.onFatal('the Python engine did not start in time'), this.opts.initTimeoutMs) };
    });
    this.ready.catch(() => {});
    // messages from a terminated generation are ignored
    this.worker.onmessage = (ev) => { if (gen === this.generation) this.onMessage(ev.data, t0); };
    this.worker.onerror = (ev) => { if (gen === this.generation) { ev.preventDefault?.(); this.onFatal(ev.message || 'worker error'); } };
    this.worker.postMessage({ type: 'init', indexURL: this.opts.indexURL });
  }

  private onMessage(m: Record<string, unknown>, t0: number) {
    switch (m.type) {
      case 'progress':
        this.opts.onProgress?.(m as { stage: string; ms: number });
        return;
      case 'ready': {
        clearTimeout(this.g.initTimer);
        const info = m.info as PyInfo;
        info.mainThreadReadyMs = Math.round(performance.now() - t0);
        this.info = info;
        this.isReady = true;
        this.initFailures = 0;
        this.g.resolve(info);
        this.drain();
        return;
      }
      case 'fatal':
        this.onFatal(String(m.message));
        return;
      case 'query': {
        const sql = String(m.sql);
        const answer = this.opts.onQuery ? Promise.resolve().then(() => this.opts.onQuery!(sql)) : Promise.reject(new Error('no database in this page'));
        answer.then(
          (a) => this.worker.postMessage({ type: 'query-result', id: m.id, sql, columns: a.columns, rows: a.rows }),
          (e: unknown) => this.worker.postMessage({ type: 'query-error', id: m.id, sql, message: String((e as Error)?.message ?? e) }),
        );
        return;
      }
      case 'result':
      case 'error': {
        const p = this.inflight;
        if (!p || p.msg.id !== m.id) return;
        this.finish(p);
        if (m.type === 'result') p.resolve(m.result);
        else p.reject(new PyError(String(m.message), m.fatal ? 'FATAL' : 'WORKER_ERROR'));
        if (m.type === 'error' && m.fatal) this.restart('fatal');
        else this.drain();
      }
    }
  }

  private finish(p: Pending) {
    if (p.timer) clearTimeout(p.timer);
    if (p.onAbort) p.signal?.removeEventListener('abort', p.onAbort);
    if (this.inflight === p) this.inflight = null;
  }

  private drain() {
    if (this.inflight || !this.isReady || !this.queue.length) return;
    const p = this.queue.shift()!;
    this.inflight = p;
    p.timer = setTimeout(() => this.hardTimeout(p), p.hard);
    this.worker.postMessage(p.msg);
  }

  private onFatal(message: string) {
    clearTimeout(this.g.initTimer);
    const duringInit = !this.isReady;
    this.g.reject(new Error(message));
    // do not loop forever when the engine cannot load at all (offline, blocked...)
    if (duringInit && ++this.initFailures > this.opts.maxInitFailures) {
      for (const p of this.queue) p.reject(new PyError(message, 'UNAVAILABLE'));
      this.queue = [];
      this.worker.terminate();
      return;
    }
    this.restart(`fatal: ${message}`);
  }

  private send<T>(type: string, payload: Record<string, unknown>, o: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const id = ++this.seq;
    const hard = o.timeoutMs ?? this.opts.hardTimeoutMs;
    const msg = { ...payload, type, id, deadlineMs: (payload.deadlineMs as number | undefined) ?? Math.min(this.opts.softTimeoutMs, hard * 0.8) };
    return new Promise<T>((resolve, reject) => {
      if (o.signal?.aborted) { reject(new PyError('aborted', 'CANCELLED')); return; }
      const p: Pending = { msg, hard, resolve: resolve as (v: unknown) => void, reject, timer: null, signal: o.signal };
      if (o.signal) {
        p.onAbort = () => this.cancel(p);
        o.signal.addEventListener('abort', p.onAbort, { once: true });
      }
      if (this.initFailures > this.opts.maxInitFailures) { reject(new PyError('the Python engine is not available', 'UNAVAILABLE')); return; }
      this.queue.push(p);
      this.drain();
    });
  }

  private hardTimeout(p: Pending) {
    if (this.inflight !== p) return;
    this.finish(p);
    p.reject(new PyError(`no answer within ${p.hard} ms`, 'TIMEOUT'));
    this.restart('timeout');
  }

  private cancel(p: Pending) {
    const i = this.queue.indexOf(p);
    if (i >= 0) {
      this.queue.splice(i, 1);
      p.reject(new PyError('cancelled before it started', 'CANCELLED'));
      return;
    }
    if (this.inflight !== p) return;
    if (this.opts.cancelRunning === 'terminate') {
      this.finish(p);
      p.reject(new PyError('cancelled (worker restarted)', 'CANCELLED'));
      this.restart('cancel');
    }
  }

  restart(reason = 'manual') {
    this.stats.restarts++;
    this.worker.terminate();
    const p = this.inflight;
    if (p) {
      this.finish(p);
      p.reject(new PyError(`worker restarted (${reason})`, 'RESTARTED'));
    }
    this.opts.onRestart?.(reason);
    this.spawn(); // queued requests go to the new worker when it is ready
  }

  render<T = RenderResult>(payload: RenderRequest, o?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
    return this.send<T>('render', payload as unknown as Record<string, unknown>, o);
  }

  validate<T = ValidateResult>(payload: ValidateRequest, o?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
    return this.send<T>('validate', payload as unknown as Record<string, unknown>, o);
  }

  models(payload: { project?: string; target?: string } = {}): Promise<{ status: string; models: ModelInfo[] }> {
    return this.send('models', payload);
  }

  ping(o?: { timeoutMs?: number }): Promise<{ pong: true; ms: number }> {
    return this.send('ping', {}, o);
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.queue) p.reject(new PyError('disposed', 'CANCELLED'));
    this.queue = [];
  }
}

// ------------------------------------------------------------------------------------------- payload types
export interface RenderRequest {
  mode: 'plain' | 'dbt';
  template: string;
  project?: 'ch11' | 'ch05';
  target?: string;
  node?: { name: string; resource_type: string; path?: string };
  passes?: ('parse' | 'execute')[];
  extra_models?: Record<string, Record<string, unknown>>;
  extra_macro_files?: Record<string, string>;
  deadlineMs?: number;
  maxQueries?: number;
}
export interface DbtError { phase?: string; kind?: string; type?: string; message: string; lineno?: number | null; dbt_message?: string }
export interface RenderResult {
  status: 'ok' | 'error' | 'timeout' | 'need_query' | 'cancelled';
  compiled: string | null;
  error: DbtError | null;
  logs?: { phase: string; info: boolean; msg: string; print?: boolean }[];
  refs?: { name: string }[];
  parse_refs?: { package: string | null; name: string; version: unknown }[];
  parse_sources?: [string, string][];
  sources?: [string, string][];
  config?: Record<string, unknown>;
  ephemeral_ctes?: string[];
  python_ms?: number;
  query_rounds?: number;
  soft?: boolean;
  pending_sql?: string;
}
export interface ValidateRequest {
  text: string;
  engine: 'dbt' | 'pyyaml';
  path?: string;
  filename?: string;
  project?: string;
  project_name?: string;
  deadlineMs?: number;
}
export interface YamlMark { line: number; column: number; index: number }
export interface YamlError {
  type: string; message: string; context: string | null; problem: string | null;
  context_mark: YamlMark | null; problem_mark: YamlMark | null; traceback_tail?: string;
  line_offset?: number; wording_patched?: boolean; dbt_message?: string;
}
export interface ValidateResult {
  ok: boolean; engine: 'dbt' | 'pyyaml'; data?: unknown; repr?: string; error?: YamlError;
  warnings?: { kind: string; key: string; line: number; column: number; message: string; dbt_message: string }[];
  libyaml: boolean; libyaml_version: string | null; pyyaml_version: string; python_ms?: number;
}
export interface ModelInfo { name: string; path: string; materialized: string; relation: string; database: string | null; schema: string | null; identifier: string; raw_code: string }
