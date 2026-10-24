// Module Web Worker: boots Pyodide from ./pyodide/ with the frozen lock (everything self-hosted), runs a scenario.
import { loadPyodide } from "./pyodide/pyodide.mjs";
import { installEnvironment, runScenario } from "./driver.mjs";

const out = (text) => postMessage({ type: "out", text });
onmessage = async (ev) => {
  const { scenario, tag, extra } = ev.data;
  try {
    const T0 = performance.now();
    const timings = {};
    let t = performance.now();
    const py = await loadPyodide({ indexURL: new URL("./pyodide/", import.meta.url).href,
      lockFileURL: new URL("./pyodide/dbt-lock.json", import.meta.url).href,
      env: { HOME: "/home/pyodide", DBT_USE_COLORS: "false" }, stdout: out, stderr: out });
    timings.pyodideMs = Math.round(performance.now() - t);
    const lock = await (await fetch("./pyodide/dbt-lock.json")).json();
    if (!extra) delete lock.packages["pandas"], delete lock.packages["numpy"];
    t = performance.now();
    Object.assign(timings, await installEnvironment(py, lock, out));
    t = performance.now();
    const bundle = await (await fetch("./bundle.json")).json();
    timings.bundleFetchMs = Math.round(performance.now() - t);
    const r = await runScenario(py, bundle, scenario, tag, out);
    Object.assign(timings, r.timings);
    timings.totalMs = Math.round(performance.now() - T0);
    postMessage({ type: "done", timings, results: r.results });
  } catch (e) {
    postMessage({ type: "error", text: String(e && e.stack || e) });
  }
};
