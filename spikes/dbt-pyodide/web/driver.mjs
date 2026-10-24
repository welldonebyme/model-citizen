// Shared by the browser worker and the Node check: given a booted Pyodide with the frozen lock, install the bundle
// into the virtual FS and run a scenario (one command per line). Returns timings + per-command results.
export async function installEnvironment(py, lock, log) {
  const t = performance.now();
  const names = Object.keys(lock.packages);
  await py.loadPackage(names, { messageCallback: () => {}, errorCallback: log });
  const ms = performance.now() - t;
  return { loadPackagesMs: Math.round(ms), packages: names.length };
}

export async function runScenario(py, bundle, scenarioName, tag, log) {
  const timings = {};
  let t = performance.now();
  for (const [p, text] of Object.entries(bundle)) {
    const full = "/bundle/" + p;
    py.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
    py.FS.writeFile(full, text);
  }
  py.FS.mkdirTree("/home/pyodide/shim");
  py.FS.writeFile("/home/pyodide/shim/dbt_session.py", bundle["py/dbt_session.py"]);
  timings.writeBundleMs = Math.round(performance.now() - t);
  t = performance.now();
  await py.runPythonAsync(`
import sys
sys.path.insert(0, "/home/pyodide/shim")
import dbt_pyodide_shim          # must come before dbt
from dbt.cli.main import dbtRunner
import dbt.adapters.duckdb
import dbt_session
dbt_session.setup_course()
dbt_session.checkout("${tag}")
print("[spike] load setup.sql: %.2fs" % dbt_session.run_sql_file(dbt_session.COURSE + "/labs/setup.sql"))
`);
  timings.importDbtAndDataMs = Math.round(performance.now() - t);
  const lines = bundle["scenarios/" + scenarioName].split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const results = [];
  t = performance.now();
  const step = py.globals.get("dbt_session").step;
  for (const line of lines) {
    const r = step(line);
    if (r) { results.push(r.toJs({ dict_converter: Object.fromEntries })); r.destroy(); }
  }
  timings.scenarioMs = Math.round(performance.now() - t);
  return { timings, results };
}
