/// <reference lib="webworker" />
/**
 * Module Web Worker hosting Pyodide + jinja2 + pyyaml for the YAML and Jinja playgrounds.
 * From spikes/pyodide/site/js/pyodide.worker.mjs (same protocol).
 *
 * Pyodide is loaded from the site's shared folder <base>engines/pyodide/<version>/ (also used by the dbt
 * terminal) with the playgrounds' own 3-package lock. Our Python code and the project fixtures are bundled
 * into this worker (Vite ?raw imports): no extra request.
 *
 * Protocol (plain objects; ids chosen by the main thread, which keeps the queue: one request at a time):
 *   main -> worker  {type:'init', indexURL}
 *                   {type:'render'|'validate'|'models'|'ping', id, ...payload}
 *                   {type:'query-result', id, sql, columns, rows} | {type:'query-error', id, sql, message}
 *   worker -> main  {type:'progress', stage, ms}  {type:'ready', info}  {type:'fatal', message}
 *                   {type:'query', id, sql}       (run_query / adapter.* during a render: the page answers)
 *                   {type:'result', id, result}   {type:'error', id, message, fatal}
 */
import dbtYaml from './python/dbt_yaml.py?raw';
import dbtJinja from './python/dbt_jinja.py?raw';
import glueSource from './python/academy_worker.py?raw';
import ch11 from './fixtures/project_ch11.json?raw';
import ch05 from './fixtures/project_ch05.json?raw';
import labsLock from './pyodide-lock.labs.json';

declare const self: DedicatedWorkerGlobalScope;

interface PyProxyLike { [k: string]: (...a: (string | number)[]) => string }
interface PyodideLike {
  version: string;
  FS: { mkdirTree(p: string): void; writeFile(p: string, d: string): void };
  runPython(code: string): unknown;
  pyimport(name: string): PyProxyLike;
  loadPackage(names: string[], opts?: Record<string, unknown>): Promise<unknown>;
}

const T0 = performance.now();
const ms = () => Math.round((performance.now() - T0) * 10) / 10;
let glue: PyProxyLike | null = null;
let initPromise: Promise<void> | null = null;
const waiting = new Map<string, { resolve: (v: { columns: string[]; rows: unknown[][] }) => void; reject: (e: Error) => void }>();
const queue: Record<string, unknown>[] = [];
let running = false;

const post = (m: Record<string, unknown>) => self.postMessage(m);

async function init(indexURL: string) {
  const stages: Record<string, number> = {};
  const mark = (stage: string) => { stages[stage] = ms(); post({ type: 'progress', stage, ms: stages[stage] }); };
  const { loadPyodide } = (await import(/* @vite-ignore */ indexURL + 'pyodide.mjs')) as { loadPyodide: (o: Record<string, unknown>) => Promise<PyodideLike> };
  mark('imported');
  const { info, packages } = labsLock as unknown as { info: unknown; packages: unknown };
  const py = await loadPyodide({
    indexURL,
    packageBaseUrl: indexURL, // with lockFileContents Pyodide would otherwise use its CDN
    lockFileContents: { info, packages },
    env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', HOME: '/home/pyodide' },
    stdout: () => {},
    stderr: () => {},
  });
  mark('core');
  await py.loadPackage(['jinja2', 'pyyaml'], { messageCallback: () => {}, errorCallback: (e: string) => console.warn(e) });
  mark('packages');
  py.FS.mkdirTree('/home/pyodide/academy');
  py.FS.writeFile('/home/pyodide/academy/dbt_yaml.py', dbtYaml);
  py.FS.writeFile('/home/pyodide/academy/dbt_jinja.py', dbtJinja);
  py.FS.writeFile('/home/pyodide/academy/academy_worker.py', glueSource);
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide/academy'); import academy_worker");
  glue = py.pyimport('academy_worker');
  mark('modules');
  glue.load_fixture('ch11', ch11);
  glue.load_fixture('ch05', ch05);
  mark('fixtures');
  const versions = JSON.parse(String(py.runPython(
    "import json, sys, yaml, jinja2, dbt_yaml; json.dumps({'python': sys.version.split()[0], 'pyyaml': yaml.__version__, 'jinja2': jinja2.__version__, 'libyaml': dbt_yaml.LIBYAML_VERSION and '.'.join(map(str, dbt_yaml.LIBYAML_VERSION))})",
  )));
  post({
    type: 'ready',
    info: {
      pyodide: py.version, ...versions, stages,
      crossOriginIsolated: self.crossOriginIsolated === true,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    },
  });
}

function askMain(id: unknown, sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  return new Promise((resolve, reject) => {
    waiting.set(`${id}\n${sql}`, { resolve, reject });
    post({ type: 'query', id, sql });
  });
}

async function handle(msg: Record<string, unknown>): Promise<unknown> {
  const g = glue!;
  if (msg.type === 'ping') return { pong: true, ms: ms() };
  if (msg.type === 'validate') return JSON.parse(g.validate(JSON.stringify(msg)));
  if (msg.type === 'models') return JSON.parse(g.models(JSON.stringify(msg)));
  if (msg.type === 'render') {
    const max = (msg.maxQueries as number | undefined) ?? 25;
    let res = JSON.parse(g.render(JSON.stringify(msg)));
    let rounds = 0;
    try {
      // record & replay: the engine never blocks on the database; it asks, the page answers, it renders again
      while (res.status === 'need_query') {
        if (++rounds > max) return { status: 'error', error: { message: `more than ${max} queries in one render` } };
        let answer: { columns: string[]; rows: unknown[][] };
        try {
          answer = await askMain(msg.id, res.pending_sql);
        } catch (e) {
          return { status: 'error', error: { kind: 'database', phase: 'execute', message: `Database Error\n  ${String((e as Error).message ?? e)}`, dbt_message: `Database Error\n  ${String((e as Error).message ?? e)}` }, pending_sql: res.pending_sql };
        }
        g.add_query_result(msg.id as number, res.pending_sql, JSON.stringify(answer)); // same key type as the request id (int)
        res = JSON.parse(g.render(JSON.stringify(msg)));
      }
    } finally {
      if (res.status === 'need_query' || rounds > max) g.drop(msg.id as number);
    }
    res.query_rounds = rounds;
    return res;
  }
  throw new Error(`unknown request type ${String(msg.type)}`);
}

async function pump() {
  if (running || !glue) return;
  const msg = queue.shift();
  if (!msg) return;
  running = true;
  try {
    post({ type: 'result', id: msg.id, result: await handle(msg) });
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    // after a fatal error (e.g. a stack overflow inside wasm) Pyodide cannot be used any more
    post({ type: 'error', id: msg.id, message, fatal: /fatal error|stack size|call stack|memory access out of bounds/i.test(message) });
  } finally {
    running = false;
    queueMicrotask(pump);
  }
}

self.onmessage = (ev: MessageEvent<Record<string, unknown>>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      initPromise ??= init(String(msg.indexURL)).then(
        () => { void pump(); },
        (e) => post({ type: 'fatal', message: String((e as Error)?.stack ?? e) }),
      );
      return;
    case 'query-result':
    case 'query-error': {
      const key = `${msg.id}\n${msg.sql}`;
      const w = waiting.get(key);
      waiting.delete(key);
      if (!w) return;
      if (msg.type === 'query-result') w.resolve({ columns: msg.columns as string[], rows: msg.rows as unknown[][] });
      else w.reject(new Error(String(msg.message)));
      return;
    }
    default:
      queue.push(msg);
      void pump();
  }
};
