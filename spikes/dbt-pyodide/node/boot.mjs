// Shared boot: Pyodide + dbt-core 1.11.16 + dbt-duckdb 1.11.0 with the shims. Used by every Node step script.
import { loadPyodide } from "pyodide";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const QUIET = /^(Didn't find package|Package .* loaded from|Loading |Loaded |.* already loaded from)/;

export async function boot({ verbose = false, env = {}, extra = (process.env.SPIKE_EXTRA || "").split(",").filter(Boolean) } = {}) {
  const timings = {};
  let t = Date.now();
  const py = await loadPyodide({
    packageCacheDir: path.join(ROOT, ".pyodide-cache"),
    env: { HOME: "/home/pyodide", ...env },
    stdout: (s) => console.log(s),
    stderr: (s) => console.error(s),
  });
  timings.pyodide = Date.now() - t;
  t = Date.now();
  const msg = verbose ? console.log : (m) => { if (!QUIET.test(m)) console.log(m); };
  await py.loadPackage(["micropip", "duckdb", "markupsafe", "pyyaml", "rpds-py"], { messageCallback: msg });
  timings.distPackages = Date.now() - t;
  t = Date.now();
  const pins = fs.readFileSync(path.join(ROOT, "pyodide-requirements.txt"), "utf8").split("\n").filter((l) => l.includes("=="));
  py.globals.set("pins", py.toPy(pins));
  // + the two local stub wheels (dbt-extractor stand-in, threads shim), installed from the host FS through emfs:
  py.FS.mkdirTree("/tmp/wheels");
  const stubs = fs.readdirSync(path.join(ROOT, "wheels")).filter((f) => f.endsWith(".whl"));
  for (const f of stubs) py.FS.writeFile("/tmp/wheels/" + f, fs.readFileSync(path.join(ROOT, "wheels", f)));
  py.globals.set("stubs", py.toPy(stubs.map((f) => "emfs:/tmp/wheels/" + f)));
  await py.runPythonAsync("import micropip\nawait micropip.install(list(pins) + list(stubs), deps=False)");
  timings.micropip = Date.now() - t;
  if (extra.length) {
    // e.g. pandas for Python models; loaded after the pins (its pytz/dateutil from the distribution are then skipped if present)
    t = Date.now();
    await py.loadPackage(extra, { messageCallback: console.log });
    timings.extra = Date.now() - t;
  }
  // shims
  t = Date.now();
  const shimDir = "/home/pyodide/shim";  // helper modules of the spike runner (dbt_session.py)
  py.FS.mkdirTree(shimDir);
  await py.runPythonAsync(`import sys\nsys.path.insert(0, "${shimDir}")\nimport dbt_pyodide_shim`);
  timings.shim = Date.now() - t;
  return { py, timings };
}

// copy a host directory into the Pyodide FS
export function copyTree(py, src, dst) {
  py.FS.mkdirTree(dst);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = dst + "/" + e.name;
    if (e.isDirectory()) copyTree(py, s, d);
    else py.FS.writeFile(d, fs.readFileSync(s));
  }
}
