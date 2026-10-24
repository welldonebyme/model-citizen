import { boot } from "./boot.mjs";
const { py, timings } = await boot();
console.log("timings", timings);
const t = Date.now();
await py.runPythonAsync(`
import traceback
try:
    from dbt.cli.main import dbtRunner
    import dbt.adapters.duckdb
    print("import dbt.cli.main + dbt.adapters.duckdb OK")
except Exception:
    traceback.print_exc()
`);
console.log("import ms", Date.now() - t);
