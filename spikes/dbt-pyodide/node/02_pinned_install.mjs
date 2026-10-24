// Step 2: exact pins from the real verification env, deps=False; native packages come from the Pyodide distribution.
import { loadPyodide } from "pyodide";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const t0 = Date.now();
const py = await loadPyodide({ packageCacheDir: path.join(root, ".pyodide-cache") });
console.log(`pyodide ${py.version} loaded in ${Date.now() - t0} ms`);
const t1 = Date.now();
await py.loadPackage(["micropip", "duckdb", "markupsafe", "pyyaml", "rpds-py"]);
console.log(`pyodide-built packages loaded in ${Date.now() - t1} ms`);
const pins = fs.readFileSync(path.join(root, "pyodide-requirements.txt"), "utf8").split("\n").filter((l) => l.includes("=="));
py.globals.set("pins", py.toPy(pins));
const t2 = Date.now();
try {
  await py.runPythonAsync(`
import micropip
await micropip.install(list(pins), deps=False)
`);
  console.log(`micropip install OK in ${Date.now() - t2} ms`);
} catch (e) {
  console.log("INSTALL FAILED:\n" + e.message);
  process.exit(1);
}
const step = process.argv[2] || "import";
try {
  await py.runPythonAsync(`
import sys, traceback
print(sys.version)
import duckdb; print("duckdb", duckdb.__version__)
try:
    import dbt_extractor
except Exception as e:
    print("dbt_extractor import:", type(e).__name__, e)
try:
    import dbt.cli.main
    print("import dbt.cli.main OK")
except Exception:
    traceback.print_exc()
`);
} catch (e) {
  console.log("PY ERROR:\n" + e.message);
}
