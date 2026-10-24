// "What is different here?": the honest list of the differences with dbt on your own computer.
import type { EngineManifest } from '../../lib/dbt/types';

export function engineLabel(m: EngineManifest | null): string {
  const v = m?.versions;
  return `Real dbt-core ${v?.dbtCore ?? '1.11.16'} in your browser (WebAssembly, DuckDB ${v?.duckdb ?? '1.5.1'}, one thread)`;
}

export function HelpPanel({ manifest, packages }: { manifest: EngineManifest | null; packages?: { name: string; version: string }[] }) {
  const v = manifest?.versions;
  const mb = manifest ? ((manifest.groups.boot.gzip + manifest.groups.core.gzip) / 1e6).toFixed(0) : '24';
  const pk = (packages ?? []).map((p) => `${p.name} ${p.version}`).join(' and ') || 'dbt_utils 1.4.1 and audit_helper 0.14.0';
  return (
    <div className="dbt-help" tabIndex={0} role="region" aria-label="What is different here">
      <h3>What runs here</h3>
      <p>{engineLabel(manifest)}. It is the real dbt-core {v?.dbtCore ?? '1.11.16'} with dbt-duckdb {v?.dbtDuckdb ?? '1.11.0'}, not a copy: the same parser, the same SQL, the same messages. It runs in Python {v?.python ?? '3.14'} compiled to WebAssembly (Pyodide), inside this page.</p>
      <h3>What is different from your computer</h3>
      <ul>
        <li><strong>One thread.</strong> dbt still prints "Concurrency: 4 threads", but it builds one node at a time. So <code>--fail-fast</code> can stop at another node, and the "write-write conflict" of Chapter 23 cannot happen here.</li>
        <li><strong>No git.</strong> A web page cannot start programs. Do the git steps in your own terminal. <code>dbt debug</code> shows <code>git [ERROR]</code> for the same reason; the other checks are real.</li>
        <li><strong>No dbt deps download.</strong> hub.getdbt.com does not allow web pages to download packages. <code>dbt deps</code> installs a saved copy of the same files: {pk}.</li>
        <li><strong>No dbt docs serve.</strong> Run <code>dbt docs generate --static</code>, then <code>open target/static_index.html</code>.</li>
        <li><strong>Other versions under dbt.</strong> Python {v?.python ?? '3.14'} and DuckDB {v?.duckdb ?? '1.5.1'} (the book used Python 3.12 and DuckDB 1.5.6). The dbt output is the same, except times and the thread order.</li>
        <li><strong>Paths.</strong> Your home folder here is <code>/home/pyodide</code>. On your computer it is <code>/Users/you</code> (macOS) or <code>C:\Users\you</code> (Windows).</li>
        <li><strong>Python models</strong> (Chapter 15 and later) load pandas the first time (about {manifest ? (manifest.groups.pandas.gzip / 1e6).toFixed(0) : '7'} MB more).</li>
      </ul>
      <h3>Your work</h3>
      <ul>
        <li>Each chapter has its own workspace: the project files, <code>~/.dbt/profiles.yml</code> and the practice database. They are saved in this browser after every command, so a reload keeps them. Nothing is sent to a server.</li>
        <li><strong>Reset to the start of this chapter</strong> brings back the files and the database of the chapter's start.</li>
        <li>The first start downloads about {mb} MB. Later starts use your browser's cache.</li>
      </ul>
      <h3>Commands</h3>
      <p>Type <code>help</code> in the terminal. Besides <code>dbt</code>: <code>duckdb practice.duckdb -c "&lt;sql&gt;"</code>, <code>duckdb practice.duckdb &lt; file.sql</code>, <code>apply day2</code>, <code>ls</code>, <code>cat</code>, <code>cd</code>, <code>pwd</code>, <code>grep</code>, <code>head</code>, <code>tail</code>, <code>cp</code>, <code>mkdir</code>, <code>rm</code>, <code>export</code> (or <code>$env:NAME = "value"</code>), <code>clear</code>. Up and Down show earlier commands; Ctrl+L clears; Ctrl+C or Stop stops a long command.</p>
    </div>
  );
}
