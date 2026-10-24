// Step 1: the naive attempt. Load Pyodide and micropip-install dbt-core + dbt-duckdb exactly as pinned.
import { loadPyodide } from "pyodide";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
const py = await loadPyodide({ packageCacheDir: path.join(here, "..", ".pyodide-cache") });
console.log(`pyodide ${py.version} loaded in ${Date.now() - t0} ms`);
await py.loadPackage("micropip");
py.globals.set("reqs", py.toPy(process.argv.slice(2).length ? process.argv.slice(2) : ["dbt-core==1.11.16", "dbt-duckdb==1.11.0"]));
try {
  await py.runPythonAsync(`
import micropip, sys
print(sys.version)
await micropip.install(list(reqs), keep_going=True)
`);
  console.log("INSTALL OK");
} catch (e) {
  console.log("INSTALL FAILED:\n" + e.message);
}
