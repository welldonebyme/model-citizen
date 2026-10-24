# Mock Exam 2 (RideNow) - verification log

Setup: dbt-core 1.11.16 + dbt-duckdb 1.11.0 + DuckDB 1.5.6 (venv v156). Project `mock2/ridenow` (profile in project
folder, schemas dbt_sara / prod / dbt_ci_pr42), raw data built by `mock2/build_raw.py`. Error variants were run in the copy
`mock2/err` (reset with `mock2/errsync.sh`; isolated DB `mock2/errdb/ridenow.duckdb`, also schema dbt_sara).
Wrapper: `mock2/d.sh` (DBT_PROFILES_DIR=., no colours). Logs: `mock2/logs/*.txt`, `mock2/final/*.txt`.
Shown logs are real; only trimmed with `...`, the `--state` path shortened (`../prod-artifacts` -> `prod-artifacts`),
and two non-ASCII terminal glyphs replaced (unit-test diff arrow -> `->`, dbt show ellipsis -> `...`).
Quality gate: `python3 mock2/count.py` -> 65 questions, formats and objectives exact, 0 non-ASCII lines in code.

| Q | Obj | Format | Key | How verified |
|---|-----|--------|-----|--------------|
| 1 | 1.4 | MC | B | RUN: `dbt show -s fct_driver_payouts --limit 3` (logs/show_payouts.txt) while relation absent; information_schema still 0 rows after |
| 2 | 1.12 | DOMC | Y N Y N Y N | RUN: `dbt build ... --empty` (logs/empty_build.txt, compiled SQL); hard-coded raw_ridenow.fares not wrapped; count(*) of view = 0 after; `dbt run --empty` works; misspelled column under --empty -> Binder Error |
| 3 | 3.3 | Hotspot | line 11 | RUN: `dbt parse` on the shown file (logs/yaml_indent_error.txt: "Syntax error near line 11") |
| 4 | 7.1 | MC | C | RUN: modified stg_ridenow__fares, `dbt ls -s state:modified --state ../prod-artifacts` (exact 5 lines); state:modified+ adds models |
| 5 | 2.1 | MS | A, D | RUN: err project, final/q05_marts.yml + final/q05_contract.txt (contract mismatch table) |
| 6 | 1.2 | Matching | 1E 2D 3B 4A 5C | DOCS (materializations); ephemeral behaviour also RUN (Q29) |
| 7 | 6.2 | MC | D | RUN: `dbt source freshness` (logs/freshness.txt, logs/sources_warn.json: 28802 s, warn); exit code 0 for warn, 1 for error |
| 8 | 1.1 | FIB | identifier | RUN: source ridenow_eu.trips with identifier trips_v2 -> compiled "ridenow"."raw_ridenow_eu"."trips_v2" |
| 9 | 4.1 | MC | A | RUN: `dbt build` (logs/build_baseline.txt): not_null email FAIL -> dim_riders SKIP; relationships (severity warn) WARN |
| 10 | 1.3 | Build list | B A D E C | DOCS (dbt refactoring legacy SQL guide order); conceptual |
| 11 | 1.11 | MC | C | RUN: append + unique_key -> trip 5 twice (completed, cancelled); merge -> one row; target/run shows MERGE ... ON trip_id |
| 12 | 4.2 | DOMC | Y Y N Y Y N | RUN: `dbt clone --state ../prod-artifacts --target ci` (logs/clone_ci.txt, clone_full_refresh.txt), run SQL = pointer view; no --state -> "--state or --defer-state are required"; DOCS for zero-copy + CI use case |
| 13 | 5.1 | MC | B | RUN: failing unit test (logs/unit_test_fail.txt, diff 120.0->80.0, model SKIP); after fixing expectation PASS + OK created (logs/build_order_payouts.txt) |
| 14 | 1.6 | Hotspot | line 15 | RUN: err project with `ride_now:` (final/q14_dbt_project.yml, final/q14_warning.txt); dim_drivers became view, fct_trips kept incremental |
| 15 | 2.2 | MC | C | RUN: versions log (logs/deprecation_warn.txt); latest_version 2 and no latest_version -> compiled dim_riders_v2; both versions built |
| 16 | 1.14 | FIB | event_time | RUN: err project without event_time (final/q16_warning.txt, unfiltered batch SQL); with it batch SQL filtered by requested_at |
| 17 | 3.1 | MC | B | RUN: `dbt run -s rpt_ops_payout_check --target ci` (logs/ci_no_defer.txt Catalog Error); with --defer --state passed (logs/ci_defer.txt) |
| 18 | 3.5 | Matching | 1C 2E 3B 4D 5A | RUN: --fail-fast (logs/fail_fast.txt), --warn-error (WARN -> FAIL); others DOCS/standard flags |
| 19 | 1.9 | MC | A | DOCS reference/resource-configs/grants ('+' prefix adds, default replaces); DuckDB has no grants, not runnable |
| 20 | 5.2 | DOMC | Y Y Y N Y N | RUN: where config compiled as subquery; severity warn + store_failures -> WARN, no SKIP, table in dbt_sara_dbt_test__audit (final/q20_build.txt); --warn-error RUN; DOCS for limit |
| 21 | 7.2 | MC | A | RUN: `dbt retry` after data fix (logs/retry_after_fix.txt: only failed test + skipped model); second retry "Nothing to do" |
| 22 | 1.7 | MS | B, E | RUN: `dbt deps` (logs/deps.txt, package-lock.yml 1.4.1); macro without namespace -> "'generate_surrogate_key' is undefined" (logs/macro_undefined.txt); DOCS for lock/--upgrade/dependencies.yml Jinja |
| 23 | 1.10 | MC | D | RUN: YAML snapshot with hard_deletes invalidate (driver 8 dbt_valid_to set) and new_record (new row dbt_is_deleted True) |
| 24 | 5.3 | Build list | C D A E B | RUN: `dbt build -s fct_driver_payouts+` (logs/build_order_payouts.txt): unit test, model, data test, child, NO-OP exposure |
| 25 | 1.13 | MC | B | RUN: `dbt run -s rpt_city_trip_counts --sample="2 days"` (logs/sample_run.txt + compiled SQL shown) |
| 26 | 3.2 | Hotspot | line 6 | RUN: err project (final/q26_model.sql, final/q26_error.txt, compiled SQL); quoting '{{ s }}' fixed it |
| 27 | 4.2 | MC | A | DOCS reference/commands/clone (clone vs defer, BI use case); clone behaviour RUN (Q12) |
| 28 | 2.1 | DOMC | Y N Y Y N Y | RUN: missing data_type error, contract error before create, incremental on_schema_change error, view-constraint warning; DOCS: Python not supported |
| 29 | 1.2 | MC | C | RUN: `dbt run -s int_trips__with_fares` (logs/q_ephemeral_run.txt) + compiled __dbt__cte__ in fct_trips |
| 30 | 5.1 | FIB | test | RUN: tests/generic/max_value.sql used with arguments max_allowed 5 -> test max_value_stg_ridenow__ratings_stars__5 PASS (logs/custom_tests.txt) |
| 31 | 6.1 | MC | D | RUN: `dbt ls -s +exposure:weekly_ops_dashboard --resource-type model` (8 models, no dim_riders) |
| 32 | 1.11 | Matching | 1A 2D 3B 4C 5E | DOCS docs/build/incremental-strategy (quoted definitions) |
| 33 | 2.3 | MC | B | RUN: constraints with enforced false -> plain CTAS; enforced true -> `driver_id integer not null primary key` |
| 34 | 5.1 | MS | C, E | RUN: singular + custom generic tests in project (logs/custom_tests.txt) |
| 35 | 7.1 | MC | A | RUN: compile with --defer (prod payouts + ci dim_drivers) and with --favor-state (both prod) |
| 36 | 3.4 | Build list | D E A C B | Conceptual Git/PR workflow (Ch3/Ch25 conventions); not runnable |
| 37 | 1.8 | MC | D | RUN: Python model with view (final/q37_error.txt); table version built OK (logs/python_model.txt) |
| 38 | 6.2 | DOMC | Y Y Y N N Y | RUN: source-level freshness with overrides (variants/sources_inherit.yml, logs/freshness_inherit.txt, logs/sources_inherit.json) |
| 39 | 5.2 | MC | D | RUN: err project accepted_values warn_if >0 / error_if >2 (final/q39_thresholds.txt: WARN, Got 1 result; 3 no_show rows); compiled SQL groups by value; DOCS severity order |
| 40 | 1.10 | Hotspot | line 7 | RUN: `dbt parse` -> "timestamp strategy must specify an updated_at" (logs/snapshot_err_timestamp.txt); check strategy without check_cols error also RUN |
| 41 | 1.14 | MC | B | RUN: forced batch failure (logs/microbatch_partial.txt, run_results partial success + batch_results) then `dbt retry` re-ran only 2026-10-19 (logs/microbatch_retry.txt) |
| 42 | 2.2 | FIB | protected | RUN: private -> Parsing Error (logs/access_private_error.txt); protected parses; no access -> "protected"; DOCS access table |
| 43 | 3.3 | MC | C | RUN: `dbt parse` with columns as mapping (logs/yaml_columns_mapping.txt) |
| 44 | 3.1 | Matching | 1B 2E 3D 4C 5A | RUN: all five messages are real (deps_missing, compilation_error_source_not_found, exposure type parse error, FK Constraint Error, Found a cycle) |
| 45 | 1.6 | MC | A | RUN: err project 3-level config (final/q45_precedence.txt: view in dbt_sara_reporting; dbt ls tags [marts, finance, ops]) |
| 46 | 1.4 | MS | B, D | RUN: dbt show creates nothing (Q1); compile writes only target files; DOCS/standard for the others |
| 47 | 5.3 | MC | D | DOCS unit tests (run in dev/CI only); RUN `--exclude-resource-type unit_test` and DBT_ENGINE_EXCLUDE_RESOURCE_TYPES both exclude it |
| 48 | 4.1 | DOMC | Y N Y N Y | RUN: logs/run_results_baseline.json (success / pass / fail / warn / skipped values) |
| 49 | 1.1 | MC | B | RUN: variants/fct_tips_by_driver.sql; `dbt ls -s source:ridenow.fares+ --resource-type model` (exact 3 lines) |
| 50 | 3.2 | Build list | B A E D C | Conceptual debugging order; compiled/run paths RUN (Q26) |
| 51 | 2.1 | MC | B | RUN: err project (final/q51_osc.txt) and fix with on_schema_change append_new_columns -> unit test PASS + model OK |
| 52 | 1.12 | FIB | --empty | RUN: compiled dim_drivers under --empty (logs/empty_build.txt) |
| 53 | 5.2 | MC | C | RUN: store_failures (final/q53_store_failures.txt) + query of audit table (from_field 99); DOCS "replace previous failures" |
| 54 | 1.5 | Hotspot | line 3 | RUN: rpt_driver_quality with source(); `dbt ls -s 1+rpt_driver_quality` lists source:ridenow.ridenow.ratings |
| 55 | 1.7 | MC | A | RUN: build without deps (logs/deps_missing.txt); `dbt init` .gitignore contains dbt_packages/ |
| 56 | 7.1 | DOMC | N Y N Y Y Y | RUN: description-only change -> no nodes; result:error/result:fail+ with saved run_results (state_r/); defer vs favor-state; state:modified.configs for materialized; source_status:fresher+ (state_f/) |
| 57 | 2.3 | MS | A, C | RUN: FK to: ref adds depends_on dim_drivers (manifest); view constraints warning; FK enforced by DuckDB ("Violates foreign key constraint"); DOCS platform differences |
| 58 | 4.1 | MC | D | RUN: `dbt build --fail-fast` (logs/fail_fast.txt: CANCEL lines, SKIP=16) |
| 59 | 7.1 | Matching | 1C 2D 3E 4B 5A | RUN: state:new, state:modified.body/.configs, state:modified+, result:error via dbt ls; DOCS node-selection methods |
| 60 | 1.3 | MC | A | RUN: macro cents_to_mad compiled -> round(base_fare_cents / 100.0, 0) and round(tip_cents / 100.0, 2) |
| 61 | 6.1 | MS | B, D | RUN: type report -> allowed list error; owner without name/email error; minimal exposure parses; NO-OP exposure in build log |
| 62 | 1.4 | FIB | build | DOCS reference/commands/build + RUN build logs (seed, snapshot, unit tests, models, tests in one run) |
| 63 | 1.5 | DOMC | Y Y N N Y Y | RUN: cycle -> "Found a cycle" at dbt ls/build; ephemeral node listed by dbt ls; rest = DAG best practice (conceptual) |
| 64 | 7.2 | Build list | C B E A D | RUN: build --target ci fails, run_results args {target: ci, select}, `dbt retry` without flags printed target='ci' and ran failed+skipped only |
| 65 | 5.1 | MC | C | RUN: dict input for ephemeral -> "Not able to get columns ... relation doesn't exist"; format: sql version PASS (logs/unit_tests_pass.txt); DOCS ephemeral needs format sql |

Not runnable on DuckDB / docs-only: Q19 (grants), Q32 (strategy definitions incl. insert_overwrite), Q36 and Q50 (process
order), Q10 (refactoring order), part of Q6 (materialized_view), Q12-E and Q27 (zero-copy clone platforms), Q57-B/E
(constraint enforcement on Snowflake/BigQuery).
