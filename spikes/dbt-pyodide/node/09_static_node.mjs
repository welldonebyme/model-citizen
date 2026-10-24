// Same code path as the browser (web/driver.mjs + frozen lock + bundle), but in Node: proves the static bundle is complete.
// Usage: node node/09_static_node.mjs <scenario file> <tag> [pandas]
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./boot.mjs";
const web = path.join(ROOT, "web");
const { loadPyodide } = await import(path.join(web, "pyodide", "pyodide.mjs"));
const { installEnvironment, runScenario } = await import(path.join(web, "driver.mjs"));
const [scenario = "ch07.txt", tag = "ch07", extra] = process.argv.slice(2);
const T0 = performance.now();
const timings = {};
let t = performance.now();
const py = await loadPyodide({ indexURL: path.join(web, "pyodide") + "/", lockFileURL: path.join(web, "pyodide", "dbt-lock.json"),
  env: { HOME: "/home/pyodide", DBT_USE_COLORS: "false" }, stdout: console.log, stderr: console.log });
timings.pyodideMs = Math.round(performance.now() - t);
const lock = JSON.parse(fs.readFileSync(path.join(web, "pyodide", "dbt-lock.json"), "utf8"));
if (!extra) { delete lock.packages["pandas"]; delete lock.packages["numpy"]; }
Object.assign(timings, await installEnvironment(py, lock, console.log));
const bundle = JSON.parse(fs.readFileSync(path.join(web, "bundle.json"), "utf8"));
const r = await runScenario(py, bundle, scenario, tag, console.log);
Object.assign(timings, r.timings);
timings.totalMs = Math.round(performance.now() - T0);
console.log("SPIKE_DONE", JSON.stringify({ timings, results: r.results }));
