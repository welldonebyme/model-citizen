// Usage: node node/04_dbt.mjs <tag> "<dbt cmd 1>" "<dbt cmd 2>" ...
//   special commands: "sql:<file under labs/>" runs a SQL file against the practice DB, "q:<sql>" prints a query result
import fs from "node:fs";
import path from "node:path";
import { boot, copyTree, ROOT } from "./boot.mjs";

let [tag, ...cmds] = process.argv.slice(2);
// "@scenarios/x.txt" = one command per line ("#" comments allowed)
cmds = cmds.flatMap((c) => c.startsWith("@") ? fs.readFileSync(path.join(ROOT, c.slice(1)), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [c]);
const T0 = Date.now();
const { py, timings } = await boot();
const LABS = "/Users/mac/Documents/Adnane/dbt-bible/labs";
const course = "/home/pyodide/dbt-course";
// checkout: replace the project's tracked files by the tag's files (target/, logs/ are kept, like a git checkout)
function checkout(t) {
  const proj = course + "/jaffle_dbt";
  py.globals.set("proj", proj);
  py.runPython(`import os, shutil\nif os.path.isdir(proj):\n    for n in os.listdir(proj):\n        if n not in ("target", "logs"):\n            p = os.path.join(proj, n)\n            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)`);
  copyTree(py, path.join(ROOT, "projects", t), proj);
  if (fs.existsSync(path.join(ROOT, "projects", t, "packages.yml"))) copyTree(py, path.join(ROOT, "packages", "dbt_packages"), proj + "/dbt_packages");
  const n = parseInt(t.slice(2), 10);
  py.FS.mkdirTree("/home/pyodide/.dbt");
  py.FS.writeFile("/home/pyodide/.dbt/profiles.yml", fs.readFileSync(path.join(ROOT, "profiles", n >= 10 ? "ch10.yml" : "default.yml")));
  console.log(`[spike] checkout ${t}`);
}
checkout(tag);
py.FS.mkdirTree(course + "/labs/data");
py.FS.mkdirTree(course + "/labs/updates");
for (const f of ["setup.sql"]) py.FS.writeFile(`${course}/labs/${f}`, fs.readFileSync(path.join(LABS, f)));
for (const f of fs.readdirSync(path.join(LABS, "data"))) py.FS.writeFile(`${course}/labs/data/${f}`, fs.readFileSync(path.join(LABS, "data", f)));
for (const f of fs.readdirSync(path.join(LABS, "updates"))) py.FS.writeFile(`${course}/labs/updates/${f}`, fs.readFileSync(path.join(LABS, "updates", f)));
py.FS.writeFile("/home/pyodide/shim/dbt_session.py", fs.readFileSync(path.join(ROOT, "py/dbt_session.py")));
let t = Date.now();
const importMs = await py.runPythonAsync(`
import time; _t=time.time()
import dbt_session
from dbt.cli.main import dbtRunner
import dbt.adapters.duckdb
print("[spike] load setup.sql: %.2fs" % dbt_session.run_sql_file(dbt_session.COURSE + "/labs/setup.sql"))
time.time()-_t`);
timings.importAndData = Date.now() - t;
console.log("[spike] boot timings (ms)", timings);
const results = [];
for (const c of cmds) {
  t = Date.now();
  if (c.startsWith("copy:")) {
    // copy:<tag>:<relative path>  = take one file from another tag (to replay a chapter's intermediate states)
    const [, t, rel] = c.split(":");
    py.FS.writeFile(course + "/jaffle_dbt/" + rel, fs.readFileSync(path.join(ROOT, "projects", t, rel)));
    console.log(`[spike] copied ${rel} from ${t}`);
  } else if (c.startsWith("checkout:")) {
    checkout(c.slice(9));
  } else if (c.startsWith("sql:")) {
    await py.runPythonAsync(`print("[spike] ran ${c.slice(4)}: %.2fs" % dbt_session.run_sql_file(dbt_session.COURSE + "/labs/${c.slice(4)}"))`);
  } else if (c.startsWith("q:")) {
    py.globals.set("q", c.slice(2));
    await py.runPythonAsync(`print("[spike] query:", q); [print("   ", r) for r in dbt_session.query(q)]`);
  } else if (c.startsWith("!")) {
    // "!<dbt cmd>": setup step (state preparation), printed with a [prelude] tag so compare.py ignores it
    py.globals.set("cmd", c.slice(1));
    await py.runPythonAsync(`print("[prelude] next command is setup only")`);
    const ok = await py.runPythonAsync(`dbt_session.dbt(cmd, prelude=True)[0]`);
    results.push({ cmd: c, ok, ms: Date.now() - t });
  } else {
    py.globals.set("cmd", c);
    const ok = await py.runPythonAsync(`dbt_session.dbt(cmd)[0]`);
    results.push({ cmd: c, ok, ms: Date.now() - t });
  }
}
console.log("[spike] results", JSON.stringify(results));
console.log(`[spike] total wall ${Date.now() - T0} ms`);
