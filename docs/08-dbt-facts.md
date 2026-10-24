# 08 — Verified dbt 1.11 facts, pitfalls and exam-safe answers

Collected while building and reviewing the book (dbt-core 1.11.16, dbt-duckdb 1.11.0, DuckDB 1.5.6). You need
them for: lab instructions, the selection engine, a dbt simulator, paste-to-verify rules, and any content fix.
The book already teaches all of them; this is the quick index.

## Environment and lab flow
- Exam version = dbt Core **1.11** (pin `dbt-core~=1.11.0`; 1.12 exists but is not tested). Python 3.12 venv.
- DuckDB: the venv's Python `duckdb` must equal the DuckDB CLI version (a file written by a newer DuckDB
  cannot be opened by an older one). The book pins 1.5.6.
- DuckDB file lock: the CLI (even read-only) blocks dbt; close it while dbt runs. The database name is the
  file stem (`practice`); copying the file under another name breaks its views.
- From tag `ch19` on, a fresh database needs `dbt build --exclude-resource-type unit_test` once before a plain
  `dbt build` (unit test with `input: this` on incremental `fct_orders`). Final build: PASS=66, WARN=1
  (the relationships test on orphan order 159 is a warning by design).
- `concurrent_batches=False` on the microbatch model from tag `ch20` (persist_docs + parallel batches =
  DuckDB "Catalog write-write conflict", timing-dependent).
- Incremental filter must use `coalesce(max(loaded_at), '1900-01-01')`: after `dbt run --empty` the plain
  `max()` returns NULL and the next run inserts nothing.
- zsh on macOS does not treat `#` as a comment when typed (Chapter 2); git 2.50 needs `pull.rebase false` (Ch3).

## Behaviour facts (tested)
- Generic test arguments belong under `arguments:` (1.10+); the old form warns
  (`MissingArgumentsPropertyInGenericTestDeprecation`, shown on DuckDB too).
- `accepted_values` returns one row per distinct bad value (thresholds count distinct values).
- A failed test has status `fail` → `result:error+` misses it; `dbt retry` re-runs failed tests and skipped nodes.
- Microbatch **partial success** skips downstream nodes (like an error); `dbt retry` re-runs only failed batches.
- `dbt retry` reuses `--target/--defer/--state`; only `--threads`/`--vars` can be overridden; `--warn-error` is
  not kept; `--defer-state` is not kept. `dbt compile` in between → "Nothing to do"; `dbt show` / `dbt docs
  generate` in between → retry crashes in 1.11.16; `dbt ls` is harmless.
- `--empty`: run, build, compile, snapshot (not seed, test, ls). Limits `ref()`/`source()` only (not
  `{{ this }}`, not hard-coded tables). Unit tests still run. Tests expecting rows can fail. With
  `hard_deletes: invalidate`, `--empty` closes every current snapshot row → exclude snapshots from empty runs.
  In this project `dbt build --empty` on a fresh DB fails on the unit test → CI uses `dbt run --empty`.
- `--sample`: run and build only; needs `event_time` upstream; grains hour/day/month/year (not week); a view
  keeps the fixed sample filter. `--event-time-start` requires `--event-time-end` (end exclusive).
  Microbatch default `lookback` = 1.
- `dbt show -s <model>` runs the model's compiled select; on an existing incremental model it returns 0 rows.
- Python models: `--empty` does not empty `dbt.ref()`; contracts → Parsing Error; unit tests → fail at run
  time; `dbt show -s` fails; ephemeral not supported; DECIMAL becomes DOUBLE through pandas (DuckDB).
- Contracts: checked at run time (not by parse/compile); breaking change unversioned → warning, versioned →
  error; ephemeral contracts silently ignored (docs: not supported); constraints without enforced contract
  are dropped silently; DuckDB compares decimal precision (docs say base type only).
- `dbt parse` does not catch cycles, unknown macros or missing vars (they surface at ls/compile/run).
- on-run-start failure does not stop models by default (`skip_nodes_if_on_run_start_fails` = false; true by
  default from 1.12 per docs). on-run-end runs even after node errors.
- Selection: `fqn` never matches sources; `"tag:a, tag:b"` (comma+space) selects only the second; `selector:`
  method is 1.12+; YAML selector CLI-style strings with set operators select nothing in 1.11.16;
  `--selector` silently ignores `--select/--exclude`.
- Freshness: table-level block overrides key by key; project-level `+freshness` is replaced (not merged) by a
  YAML block; `dbt build` never checks freshness; WARN exits 0, ERROR STALE exits 1.
- Env vars: 1.11 uses `DBT_ENGINE_*` names (old `DBT_*` still work; ENGINE wins).

## Docs vs 1.11.16 behaviour — teach both, answer the exam the docs' way
| Topic | Docs say | 1.11.16 does | Exam-safe answer |
|---|---|---|---|
| `meta` change and `state:modified` | not compared | detected by `.configs` | use `tags` as the "not detected" example; avoid `meta` |
| `group` change and `state:modified` | can flag nodes | excluded | do not rely on `group` either way |
| `1+result:fail+` | includes downstream | test + its model only | accept the docs' description |
| on-run hooks with `dbt compile` / `docs generate` | run | compiled, not executed | follow the docs list (build, compile, docs generate, run, seed, snapshot, test) |
| `dbt retry --target/--full-refresh` overrides | allowed | ignored | retry repeats the original command |
| `dbt deps` and removed packages | stay on disk | `dbt_packages/` is reinstalled | `dbt clean` then `dbt deps` |
| threads default in profiles | "4" | Core uses 1 when missing (4 is the dbt platform default) | platform 4, Core 1 |
| error types | Runtime / Compilation / Dependency / Database | messages use other words | learn the docs' four families |

## Platform facts (from docs.getdbt.com; not run live)
CI jobs run in temporary schemas `dbt_cloud_pr_<job>_<pr>`, defer to production; Catalog (formerly Explorer)
needs Starter/Enterprise; Studio IDE: primary branch protected (cannot commit to it), Defer setting; "Generate
docs on run" checkbox is for Core-engine (v1) jobs; a "Run source freshness" checkbox does not stop the job,
an explicit `dbt source freshness` step does.
