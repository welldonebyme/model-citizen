# INDEX - reference practice project `jaffle_dbt` (Chapters 6-25)

Reference repo: `/Users/mac/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt`
(git, branch `main`, annotated tags `ch06` ... `ch25`; `main` = `ch25` + README.md + profiles.example.yml).
Builder copy (with target/, logs/, dbt_packages/, prod-artifacts/): `<scratch>/a1/home/dbt-course/jaffle_dbt`
(`<scratch>/a1/dbt-course` and `<scratch>/a1/dot-dbt` are symlinks to `<scratch>/a1/home/dbt-course` and `<scratch>/a1/home/.dbt`).
Versions: dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb 1.5.6 (Python), Python 3.12, macOS. Packages: dbt_utils 1.4.1, audit_helper 0.14.0.
Run date: 2026-10-21 (matters for freshness, microbatch batches, --sample relative windows).

Logs: `chNN.md` (commands + full outputs; paths mapped to `/Users/adnane/...`, see the header of each log), raw unmapped
outputs in `raw/chNN.log`; `duckdb_support.md` (support matrix); `matrix_tests.md` (extra experiments for the matrix).
Bug patches for Chapter 22: `/Users/mac/Documents/Adnane/dbt-bible/labs/practice-project/bugs/` (9 patches + README.md).
Data scripts: `/Users/mac/Documents/Adnane/dbt-bible/labs/updates/` (`day2.sql`, `fresh_load.sql`, `README.md`).

## Raw-data state through the chapters (dev database `~/dbt-course/practice/practice.duckdb`)

| When | Raw data | How |
|---|---|---|
| ch06 - ch13 (first half) | day 1 (setup.sql): 100 customers, 300 orders, 606 items, 341 payments | `duckdb practice.duckdb < setup.sql` |
| ch13 section 2 | day 2 | `duckdb practice.duckdb < updates/day2.sql` |
| ch14 start | RESET to day 1 (snapshots NOT run during the reset) | `duckdb practice.duckdb < setup.sql` |
| ch14 section 5 onward | day 2 | `updates/day2.sql` again |
| ch21 | day 2 + 2 x fresh_load (orders 324, items 642, payments 375) | `updates/fresh_load.sql` (twice: section 2 and the source_status:fresher demo) |

Production (`--target prod`: schemas `prod`, `marts`, `snapshots`): partially built in ch19 (one demo), fully built in ch23,
rebuilt in ch23 (after the fixes) and in ch24 ("deploy"). `prod-artifacts/` (manifest.json + run_results.json) = state of tag ch24's code.

## Per chapter: files added (A) / modified (M) in the tag, and what the log contains

### ch06 - first project
A: `.gitignore`, `README.md` (from dbt init), `dbt_project.yml`, `analyses/.gitkeep`, `macros/.gitkeep`, `seeds/.gitkeep`, `snapshots/.gitkeep`, `tests/.gitkeep`
(`models/` is empty after deleting `models/example`, so git does not track it). Profile `~/.dbt/profiles.yml` with dev + prod (outside the repo).
Log: dbt --version, dbt init --skip-profile-setup, generated files, dbt debug, dbt run of the 2 examples, target/compiled vs target/run,
dbt.log excerpt, dbt test (not_null fails on the example), dbt show, DuckDB file-lock errors (read-write AND read-only holder), unused
config path warning, git init/commit/tag. Models: none at the tag.

### ch07 - models, sources, DAG
A: `models/staging/jaffle_shop/{_jaffle_shop__sources.yml,_jaffle_shop__models.yml,stg_jaffle_shop__customers.sql,stg_jaffle_shop__orders.sql,stg_jaffle_shop__order_items.sql,stg_jaffle_shop__products.sql}`,
`models/staging/stripe/{_stripe__sources.yml,_stripe__models.yml,stg_stripe__payments.sql}`, `models/marts/{fct_orders.sql,dim_customers.sql}`.
Log: run, build, compile (source -> "practice"."jaffle_shop"."orders"), ls, ls with +, show, docs generate, source schema/identifier override demo.
Counts (day 1, all views): dim_customers 100 rows, 299 orders, lifetime value 4988.4, 11 customers without orders; fct_orders 300 rows, 5004.4.

### ch08 - materializations
M: `dbt_project.yml` (staging view, intermediate view, marts table), `models/marts/fct_orders.sql`; A: `models/intermediate/int_payments__successful.sql` (ephemeral via config()).
Log: __dbt__cte__ in compiled SQL, DDL in dbt.log (view->table switch, view rebuild), ephemeral edge cases, materialized_view error.

### ch09 - modularity and refactoring
A: `models/intermediate/int_orders__enriched.sql`, `models/marts/fct_monthly_revenue.sql`; M: `models/marts/fct_orders.sql` (now reads int_orders__enriched - DRY).
History: commit 1 adds `models/legacy/legacy_monthly_revenue.sql`, commit 2 removes it (tag = commit 2).
Log: legacy model (no DAG parents), row counts + EXCEPT both ways (0 rows), fct_orders old-vs-new EXCEPT, delete legacy.
Counts: fct_monthly_revenue 65 rows, 270 orders, revenue 4496.9 (one row with country NULL = orphan order 159).

### ch10 - configuration
A: `macros/generate_schema_name.sql`, `models/marts/_marts__models.yml`; M: `dbt_project.yml`, `models/staging/jaffle_shop/stg_jaffle_shop__orders.sql` (dev-only filter with var dev_start_date).
Profile: path becomes `"{{ env_var('DBT_DUCKDB_PATH', '../practice/practice.duckdb') }}"`.
Log: +schema with default macro (dbt_adnane_marts, prod_marts) then override (dev: dbt_adnane, prod: marts/prod), tags additive, meta merged,
vars/--vars, target-based filter, env_var errors, alias demo (reverted), post-hook analyze, on-run-start/end demo (removed; compile/ls do not run them),
grants (warning; final = prod-only Jinja), config precedence demo (reverted).

### ch11 - Jinja, macros, packages
A: `macros/cents_to_dollars.sql`, `macros/print_row_counts.sql`, `packages.yml`, `package-lock.yml`, `models/intermediate/int_orders__payment_methods_pivoted.sql`,
`models/marts/fct_order_items.sql`, `analyses/audit_fct_monthly_revenue.sql`; M: the 2 staging models using the macro, `fct_orders.sql` (4 payment-method columns), `_marts__models.yml`.
Log: compiled before/after macro (identical), dbt deps, for loop compiled, get_column_values, generate_surrogate_key SQL, run-operation (+ --args),
audit_helper compare_queries via dbt show (65 rows in a and b), Jinja experiments (log() printed twice).
Counts: dim_customers 100, fct_monthly_revenue 65, fct_order_items 606, fct_orders 300.

### ch12 - seeds and analyses
A: `seeds/country_regions.csv`, `seeds/_seeds.yml`, `analyses/revenue_by_region.sql`; M: `dim_customers.sql` (+ region).
Log: dbt seed (INSERT 6 / CREATE 6 with --full-refresh), column types, CSV column change error, compile/show of the analysis.

### ch13 - snapshots
A: `snapshots/snapshots.yml` (customers_snapshot check on email+country; orders_snapshot timestamp on _loaded_at; schema snapshots).
Log: first snapshot, meta columns, day2.sql, second snapshot, history queries, point-in-time queries; THROWAWAY demos: hard_deletes ignore / invalidate /
new_record (+ error when switching), legacy {% snapshot %} SQL, dbt_valid_to_current + snapshot_meta_column_names.
Counts: snapshots BEFORE day2: customers_snapshot 100 rows (100 current), orders_snapshot 300 (300 current);
AFTER day2: customers_snapshot 105 (100 current, 5 closed), orders_snapshot 333 (320 current, 13 closed).
Tables after day2 (dbt build): dim_customers 100, fct_monthly_revenue 71, fct_order_items 638, fct_orders 320.

### ch14 - incremental and microbatch
A: `models/marts/fct_order_items_daily.sql`, `models/intermediate/_intermediate__models.yml`; M: `fct_orders.sql` (incremental merge, unique_key order_id,
on_schema_change append_new_columns, loaded_at column, filter `coalesce(max(loaded_at), '1900-01-01')`), `event_time` in 2 sources files,
2 staging properties files and `_marts__models.yml`.
NOTE: the ch14 COMMIT was amended after the chapter (coordinator request) to use `coalesce(max(loaded_at), '1900-01-01')`; later commits were
replayed and all tags moved. Sections 1-7 of ch14.md show the first filter text; section 8 shows the trap and the fix.
Log: reset, first run without --full-refresh (Binder Error), full refresh, MERGE statement, microbatch first run (22 monthly batches),
per-batch compiled SQL; THROWAWAY: every strategy, on_schema_change modes, microbatch errors; REAL: day2, incremental run, normal microbatch run
(January missing), --event-time-start/end backfill, --full-refresh; addendum: --empty trap before/after.
Counts: incremental fct_orders BEFORE day2 300 rows (max loaded_at 2025-12-31 16:22, 5004.4); 33 rows to process; AFTER 320 rows, 320 distinct,
max loaded_at 2026-01-04 16:13, 5443.2. fct_order_items_daily BEFORE 564 rows (qty 1021, 5255.6), after the normal run 0 rows for 2026-01,
AFTER backfill 596 rows (qty 1064, 5443.2 = fct_order_items).

### ch15 - Python models
A: `models/marts/customer_segments.py`; M: `_marts__models.yml`.
Log: build, compiled Python (dbt wrapper), segments (no orders 9, new 11, regular 36, loyal 44), tiers, types (DECIMAL -> DOUBLE), view error.

### ch16 - commands and selection
A: `selectors.yml` (staging_only, nightly, finance_marts, no_python); M: `customer_segments.py` (handles empty input - bug found by --empty).
Log: graph operators, methods, selectors (--selector ignores --select), ls outputs, --empty on a fresh DB, --sample (copy-name trap, then OK),
show, --fail-fast, --threads, parse, clean/deps, state/result previews, indirect selection; addendum about the --empty incremental trap.

### ch17 - governance
A: `models/_groups.yml`, `models/marts/dim_customers.yml`, `models/marts/dim_customers_v2.sql`; M: `dbt_project.yml` (intermediate: group finance, private), `_marts__models.yml`.
Log: group/access listing, private-ref errors, contract build DDL, constraints in DuckDB, contract and constraint failures, versions (latest 1 then 2,
deprecation_date 2027-06-30), unpinned-ref message, deprecation warnings (future and past date), drop old dim_customers table, cross-project ref error.

### ch18 - data tests
A: `tests/generic/test_is_positive.sql`, `tests/assert_payments_match_order_totals.sql`, `tests/assert_paid_orders_match_items.sql`;
M: 2 sources files, 2 staging properties files, `_marts__models.yml`, `dim_customers.yml`.
Log: MissingArgumentsPropertyInGenericTestDeprecation, 45 tests, build with failing relationships (16 SKIP; multi-parent skip rule), store failures,
severity warn / where / warn_if+error_if (kept), test selection methods, indirect selection eager/cautious/buildable.

### ch19 - unit tests
A: `models/staging/stripe/_stripe__unit_tests.yml`, `models/marts/_marts__unit_tests.yml`.
Log: 5 unit tests pass, compiled fixture SQL, failing unit test diff, missing input, parents not built (2 ways), build order, prod exclusion (flag + env var);
addendum: first build on a brand-new schema with `input: this` (real error, workarounds A and B; eager indirect selection trap).

### ch20 - documentation
A: `models/docs.md`; M: `dbt_project.yml` (persist_docs on marts), `_marts__models.yml`, `_jaffle_shop__models.yml` (doc('order_status')),
`models/marts/fct_order_items_daily.sql` (`concurrent_batches=False` + SQL comment - MOVED here from ch23 after the build, see below).
Log: COMMENTs in DuckDB, catalog.json vs manifest.json, --static, docs serve check; addendum: the moved fix and a fresh build at tag ch20
(22 batches one after the other, persist_docs comment present, 596 rows).

### ch21 - freshness and exposures
A: `models/exposures.yml`; M: both sources files (freshness under config, null for 3 tables, filter on payments).
Log: ERROR STALE, sources.json, freshness SQL, fresh_load.sql, PASS, source_status:fresher+ (gotcha with a partial freshness run, then correct),
exposures selection, NO-OP exposures in build.

### ch22 - debugging
M: `dbt_project.yml` (`flags:` send_anonymous_usage_stats false + 2 behavior change flags).
Log: 9 bug patches with real errors (which ones dbt parse catches), JSON-schema validation finding (silent on DuckDB), --warn-error,
--warn-error-options (error / warn / silence), DBT_WARN_ERROR, --log-level, -q, --debug, --log-format json, --log-level-file.

### ch23 - pipelines and clone
M: `.gitignore` (+ prod-artifacts/), `dbt_project.yml` (post-hook skipped during clone). (`concurrent_batches=False` is now in ch20; ch23.md
section 4 still shows the original failure and diagnosis, captured before the move, and a note explains how to reproduce it.)
Log: model failure mid-DAG (run, --fail-fast), test failure mid-DAG (run vs build; singular test needs the group to ref a private model),
prod build (PARTIAL SUCCESS, write-write conflict) -> diagnosis -> fix (one Jinja mistake kept), prod artifacts, dbt clone (views; ANALYZE error; fix).

### ch24 - state, defer, retry
M: `models/marts/fct_monthly_revenue.sql` (+ average_order_value). Profile: + `ci` output (schema dbt_ci).
Log: state:modified / + / .body / .configs / new; sub-selector demos (configs, tag NOT detected, group NOT detected, persisted_descriptions, macros,
relation, new model, contract breaking / non-breaking); --defer to prod from an empty ci schema; slim CI command; --favor-state; result:error /
error+ / skipped / fail; dbt retry (does not reuse --warn-error); prod "deploy".

### ch25 - environments, CI
A: `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `ci/profiles.yml`, `ci/load_raw.py`, `ci/raw/setup.sql`, `ci/raw/data/*.csv`; M: `.gitignore` (+ ci_db/).
(The ch25 commit was amended once to make a workflow comment precise.)
Log: files, YAML validation (PyYAML reads `on` as True), full local simulation of the workflow in a clone (prod build from main via git worktree,
state:modified+, --empty step, build), proof that --defer covers `this` for existing models and that a NEW incremental model needs the --empty step.

## Row counts of key models (dev, dbt_adnane)

| Moment | fct_orders | dim_customers | fct_monthly_revenue | fct_order_items | fct_order_items_daily | customers_snapshot | orders_snapshot |
|---|---:|---:|---:|---:|---:|---:|---:|
| end ch07 (day 1, views) | 300 | 100 | - | - | - | - | - |
| end ch09 / ch11 (day 1) | 300 | 100 | 65 | 606 (ch11) | - | - | - |
| ch13 before day2 | 300 | 100 | 65 | 606 | - | 100 | 300 |
| ch13 after day2 | 320 | 100 | 71 | 638 | - | 105 | 333 |
| ch14 after reset + full refresh (day 1) | 300 | 100 (*) | 65 | 606 | 564 | 105 | 333 |
| ch14 after day2 (incremental) | 320 | 100 | 71 | 638 | 596 (after backfill) | 105 | 333 |
| end ch25 (day2 + 2 fresh loads) | 324 | 100 (v1 and v2) | 73 | 642 | 598 | 105 | 337 |

(*) dim_customers was rebuilt on day-1 data after the full refresh of fct_orders.
Production at the end (marts): fct_orders 324, dim_customers_v1/v2 100, fct_monthly_revenue 73, fct_order_items 642, fct_order_items_daily 598,
customer_segments 100; snapshots schema: customers_snapshot 100, orders_snapshot 324 (first prod snapshot was taken on the final data).

## Final model list (tag ch25 / main)
- `customer_segments` - Python table (marketing, protected)
- `dim_customers.v1` - table, contract (marketing, public; relation dim_customers_v1; deprecation_date 2027-06-30)
- `dim_customers.v2` - table, contract (marketing, public; relation dim_customers_v2; LATEST)
- `fct_monthly_revenue` - table (finance, public)
- `fct_order_items` - table (finance, protected; event_time order_date)
- `fct_order_items_daily` - incremental microbatch, month batches (finance, protected)
- `fct_orders` - incremental merge, unique_key order_id (finance, public)
- `int_orders__enriched` - view (finance, private; event_time order_date)
- `int_orders__payment_methods_pivoted` - view (finance, private)
- `int_payments__successful` - ephemeral (finance, private)
- `stg_jaffle_shop__customers` - view (staging)
- `stg_jaffle_shop__order_items` - view (staging)
- `stg_jaffle_shop__orders` - view (staging; event_time order_date; dev-only filter)
- `stg_jaffle_shop__products` - view (staging)
- `stg_stripe__payments` - view (staging; event_time created_at)
- `country_regions` - seed
- `customers_snapshot` - snapshot (check)
- `orders_snapshot` - snapshot (timestamp)

Totals (dbt ls 'Found' line at ch25): 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests. Plus 2 singular tests, 1 custom generic test, macros `cents_to_dollars`, `print_row_counts`, `generate_schema_name`, analyses `audit_fct_monthly_revenue`, `revenue_by_region`, selectors `staging_only`, `nightly`, `finance_marts`, `no_python`, exposures `monthly_revenue_dashboard`, `customer_segmentation_notebook`, groups `finance`, `marketing`.

## Resource counts per tag (dbt ls 'Found' line, and models/seeds/snapshots)

| Tag | Found | Models / seeds / snapshots |
|---|---|---|
| ch07 | 7 models, 10 data tests, 5 sources, 500 macros | dim_customers, fct_orders, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments |
| ch08 | 8 models, 10 data tests, 5 sources, 500 macros | dim_customers, fct_orders, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments |
| ch09 | 10 models, 10 data tests, 5 sources, 500 macros | dim_customers, fct_monthly_revenue, fct_orders, int_orders__enriched, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments |
| ch10 | 10 models, 10 data tests, 5 sources, 501 macros | dim_customers, fct_monthly_revenue, fct_orders, int_orders__enriched, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments |
| ch11 | 12 models, 1 analysis, 10 data tests, 5 sources, 669 macros | dim_customers, fct_monthly_revenue, fct_order_items, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments |
| ch12 | 12 models, 2 analyses, 1 seed, 12 data tests, 5 sources, 669 macros | dim_customers, fct_monthly_revenue, fct_order_items, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions |
| ch13 | 12 models, 2 analyses, 1 seed, 12 data tests, 2 snapshots, 5 sources, 669 macros | dim_customers, fct_monthly_revenue, fct_order_items, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch14 | 13 models, 2 analyses, 1 seed, 2 snapshots, 12 data tests, 5 sources, 669 macros | dim_customers, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch15 | 14 models, 2 analyses, 1 seed, 14 data tests, 2 snapshots, 5 sources, 669 macros | customer_segments, dim_customers, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch16 | 14 models, 2 analyses, 1 seed, 2 snapshots, 14 data tests, 5 sources, 669 macros | customer_segments, dim_customers, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch17 | 15 models, 2 analyses, 1 seed, 14 data tests, 2 snapshots, 5 sources, 669 macros, 2 groups | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch18 | 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 670 macros, 2 groups | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch19 | 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 670 macros, 2 groups, 5 unit tests | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch20 | 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 670 macros, 2 groups, 5 unit tests | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch21 | 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch22 | 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch23 | 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch24 | 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |
| ch25 | 15 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests | customer_segments, dim_customers.v1, dim_customers.v2, fct_monthly_revenue, fct_order_items, fct_order_items_daily, fct_orders, int_orders__enriched, int_orders__payment_methods_pivoted, int_payments__successful, stg_jaffle_shop__customers, stg_jaffle_shop__order_items, stg_jaffle_shop__orders, stg_jaffle_shop__products, stg_stripe__payments, country_regions, customers_snapshot, orders_snapshot |

## Deviations from PROJECT_SPEC.md (and why)

1. `fct_monthly_revenue` column is `order_month` (not `month`, which is a function name in many SQL dialects); it is a DATE.
2. ch09: besides the new models, `fct_orders` was refactored to read `int_orders__enriched` (otherwise the "sum successful payments per order" logic
   would be duplicated - the DRY lesson of the chapter). Consequence: `int_payments__successful` (ephemeral) feeds `int_orders__enriched` and
   `int_orders__payment_methods_pivoted`, and is no longer read by fct_orders directly after ch09 (it is at ch08, where the __dbt__cte__ is shown).
3. ch11: `fct_orders` joins `int_orders__payment_methods_pivoted` (4 amount columns per payment method), so the pivot model is consumed and
   ch18 has a meaningful singular test (amount = sum of the 4 columns = successful payments).
4. ch14: the microbatch model is `fct_order_items_daily` (one row per day and product) with `batch_size='month'` (22 batches instead of ~660 daily
   batches up to "now", which would make unreadable logs). It reads `fct_order_items` (event_time order_date).
5. ch14 history was rewritten once (coordinator request): the ch14 commit was amended to use `coalesce(max(loaded_at), '1900-01-01')`;
   ch15-ch21 commits were replayed and their tags moved. ch14.md sections 1-7 show the first filter text (outputs identical).
6. ch17: the versions are `dim_customers` v1 (defined_in the original `dim_customers.sql`) and v2 (`dim_customers_v2.sql`, full_name instead of
   first_name/last_name); latest_version 2; relations `dim_customers_v1`/`dim_customers_v2` (the old `dim_customers` table was dropped).
   Everything that refs `dim_customers` (customer_segments, exposure) uses v2.
7. ch10: on-run-start/end hooks were demonstrated and then REMOVED (they would add lines to every later output); the model post-hook
   (`analyze`) and prod-only grants stay. Profile `env_var` for the DuckDB path chosen (as allowed by the spec).
8. ch20 persist_docs and the ch10 post-hook caused 2 real problems found in ch23. The microbatch write-write conflict fix
   (`concurrent_batches=False`) was MOVED into the ch20 commit (history rewritten for ch20..main, tags moved), because a student can hit the
   conflict as soon as persist_docs is on. The clone / `flags.WHICH` post-hook fix stays in ch23 (teaching moment there), so tags ch10-ch22
   contain the clone-breaking post-hook.
9. ch24: a third profile output `ci` (schema dbt_ci) is added (outside the repo; see profiles.example.yml).
10. ch25: the raw CSVs + setup.sql are copied into the repo (`ci/raw/`) and loaded by `ci/load_raw.py`, so the CI job needs no DuckDB CLI and no
    external data. The workflow builds prod from `origin/main` in a git worktree to get the state (no artifact storage needed). The ch25 commit
    was amended once (workflow comment wording).
11. ch22: 9 bug patches (the 7 required + `08-semicolon-at-end`, `09-yaml-key-typo`).
12. Builder layout: instead of DBT_PROFILES_DIR, a temporary HOME (`<scratch>/a1/home`) holds `.dbt/profiles.yml` and `dbt-course/` exactly like
    the student's machine; `<scratch>/a1/dot-dbt` and `<scratch>/a1/dbt-course` are symlinks to them. Logs map that HOME to `/Users/adnane`.
13. No DuckDB CLI on the builder machine: every `duckdb practice.duckdb < script.sql` was run with the bible's Python helper
    (`tools/build_practice_db.py`, same statements); the logs show the CLI command AND the command really run.

## Not verified

- The DuckDB CLI itself (not installed): day2.sql / fresh_load.sql / setup.sql were run through the Python duckdb 1.5.6 library only.
  fresh_load.sql uses `current_timestamp at time zone 'UTC'` (needs the ICU extension, built into the standard CLI and Python builds).
- The lock message with a real CLI as the holder (reproduced with a Python process as the holder).
- The GitHub Actions workflow on GitHub itself (actions/checkout, setup-python, pip install were not executed; every dbt/git/python step
  was run locally in a simulated workspace).
- `dbt docs serve` in a browser (checked with curl: HTTP 200 for index.html and catalog.json).

## Note on commit hashes in the logs
Because of the history rewrites (ch14 amend with the coalesce filter; ch20..main rewritten to move `concurrent_batches=False` into ch20;
ch25 amend), the commit hashes printed by `git log` in ch14.md to ch25.md are NOT the hashes of the reference repo for ch14 and later.
Hashes for ch06-ch13 are unchanged. Use the tag names, not the hashes. Current tag commits: see `git log --oneline --decorate` in the repo.

## Verification after moving the microbatch fix to ch20 (fresh clone, fresh database day1 + day2.sql, every tag)
| Tag | dbt parse | dev: build --exclude-resource-type unit_test, then build | prod build (no unit tests) | write-write conflicts | microbatch batches OK |
|---|---|---|---|---|---|
| ch20 | OK, 0 warnings | OK / OK (PASS=66 WARN=1) | OK (PASS=61 WARN=1) | 0 | 22 |
| ch21 | OK, 0 warnings | OK / OK (PASS=66 WARN=1 NO-OP=2) | OK | 0 | 22 |
| ch22 | OK, 0 warnings | OK / OK | OK | 0 | 22 |
| ch23 | OK, 0 warnings | OK / OK | OK | 0 | 22 |
| ch24 | OK, 0 warnings | OK / OK | OK | 0 | 22 |
| ch25 | OK, 0 warnings | OK / OK | OK | 0 | 22 |
| main | OK, 0 warnings | OK / OK | OK | 0 | 22 |
The WARN is the relationships test (orphan order 159, by design). A plain `dbt build` on a brand-new database fails at every tag from ch19 on
(unit test with `input: this` on fct_orders; fct_orders stays skipped, so repeating does not help) - documented in ch19.md and the repo README.
All 9 bug patches still apply at ch21..main.
