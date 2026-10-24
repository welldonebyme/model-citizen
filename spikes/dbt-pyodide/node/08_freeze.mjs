// Freeze the working environment into a Pyodide lock file + local wheel folder, for a fully static (self-hosted) site.
import fs from "node:fs";
import path from "node:path";
import { boot, ROOT } from "./boot.mjs";
const { py } = await boot({ extra: ["pandas"] });
const lock = JSON.parse(await py.runPythonAsync("import micropip\nmicropip.freeze()"));
const versions = await py.runPythonAsync(`
import importlib.metadata as m, json
json.dumps(sorted((d.metadata["Name"], d.version) for d in m.distributions()))`);
fs.writeFileSync(path.join(ROOT, "web", "installed-versions.json"), versions);
const dist = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/pyodide/pyodide-lock.json"), "utf8"));
const wheelDir = path.join(ROOT, "web", "pyodide");
fs.mkdirSync(wheelDir, { recursive: true });
// keep only what is loaded (all packages present in sys.modules distributions) -> compute the needed set
const loaded = JSON.parse(await py.runPythonAsync(`import json\nfrom pyodide_js import loadedPackages\njson.dumps(list(loadedPackages.object_keys()))`));
const out = { info: lock.info, packages: {} };
for (const name of loaded) {
  const key = Object.keys(lock.packages).find((k) => k === name || lock.packages[k].name === name) || name.toLowerCase();
  const p = lock.packages[key];
  if (!p) { console.log("not in lock:", name); continue; }
  let fname = p.file_name;
  if (/^https?:/.test(fname)) {
    const base = fname.split("/").pop();
    const dst = path.join(wheelDir, base);
    if (!fs.existsSync(dst)) {
      const r = await fetch(fname);
      fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
    }
    fname = base;
  } else {
    const base = decodeURIComponent(fname.split("/").pop());
    const src = [path.join(ROOT, ".pyodide-cache", base), path.join(ROOT, "wheels", base)].find((f) => fs.existsSync(f));
    if (src) fs.copyFileSync(src, path.join(wheelDir, base));
    else console.log("missing wheel locally:", fname);
    fname = base;
  }
  out.packages[key] = { ...p, file_name: fname };
}
fs.writeFileSync(path.join(ROOT, "web", "pyodide", "dbt-lock.json"), JSON.stringify(out, null, 1));
console.log("packages in lock:", Object.keys(out.packages).length);
