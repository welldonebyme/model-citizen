# Practice project `jaffle_dbt` — reference implementation spec (Chapters 6–25)

The student builds this project step by step in Part II–VII. The builder implements it EXACTLY as the student will
(same commands, same files), runs everything, and captures outputs so that chapter writers can print real results.

## Layout
- Student: `~/dbt-course/practice/practice.duckdb` (raw data, built in Ch2 from labs/setup.sql) and `~/dbt-course/jaffle_dbt` (dbt project, git repo).
- Builder: mimic in `<scratch>/a1/dbt-course/{practice,jaffle_dbt}`; profiles in `<scratch>/a1/dot-dbt/profiles.yml` with `DBT_PROFILES_DIR`.
- Final reference repo: `/Users/mac/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt` (git repo, commit + annotated tag per chapter
  `ch06`..`ch25`; commit author "Adnane <adnane@example.com>" via local config only). Include `profiles.example.yml` and a README.md
  (how to use the tags to compare with your own work).
- Logs: `<scratch>/a1/logs/chNN.md` = every command run for that chapter + full real output (no ANSI colours; `--no-use-colors`).
- Support matrix: `<scratch>/a1/logs/duckdb_support.md` = for each feature below, what ACTUALLY happens on dbt-duckdb 1.11 + DuckDB 1.5.6
  (works / no-op / error + exact message): grants, materialized_view, dbt clone (zero-copy or view fallback?), incremental strategies
  (append, delete+insert, merge, insert_overwrite, microbatch), on_schema_change modes, contracts, each constraint type (not_null, unique,
  primary_key, foreign_key, check) enforced or not, python models, --empty, --sample, persist_docs, store_failures, snapshots hard_deletes,
  unit tests, source freshness, --defer, retry, run-operation, hooks.

## Profile (student writes it in ~/.dbt/profiles.yml in Ch6)
```yaml
jaffle_dbt:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: ../practice/practice.duckdb   # relative: ALWAYS run dbt from the jaffle_dbt folder
      schema: dbt_adnane
      threads: 4
    prod:
      type: duckdb
      path: ../practice/practice.duckdb
      schema: prod
      threads: 4
```
(Ch10 may switch `path` to `"{{ env_var('DBT_DUCKDB_PATH', '../practice/practice.duckdb') }}"` to teach env_var — builder decides & documents.)
Note for writers: the DuckDB database name is `practice` (file stem). The DuckDB CLI must be closed while dbt runs (file lock) —
or opened with `duckdb -readonly`. Verify and document the exact lock error message.

## Data update scripts (builder creates them; deterministic; put in /Users/mac/Documents/Adnane/dbt-bible/labs/updates/)
- `day2.sql` — "the next loading day", applied in Ch13 and Ch14 (and reused later):
  * customers: 3 customers change `country`, 1 customer with NULL email gets an email, 1 customer fixes the case of their email.
  * orders: the 10 `placed` orders become `shipped`, 3 `shipped` orders become `completed`; every changed row gets a new `_loaded_at`
    in 2026-01-02; plus 20 NEW orders (ids 301–320) dated 2026-01-01..2026-01-04 with items and payments (successful, amounts consistent
    with items) and `_loaded_at` on 2026-01-0X.
  * payments: successful payments for the 10 formerly placed orders (created 2026-01-02).
  Document exact before/after counts in labs/updates/README.md.
- `fresh_load.sql` — inserts a couple of rows with `_loaded_at = current_timestamp` (Ch21 freshness turns green).
- Reset = re-run `setup.sql` (`duckdb practice.duckdb < setup.sql`), which recreates the raw tables (it does NOT drop dbt schemas).

## Chapter states (implement in this order; tag after each)
- **ch06** `dbt init jaffle_dbt --skip-profile-setup`; write profile; `dbt debug`; `dbt run` the two example models; look at
  target/compiled and target/run; then delete models/example + its block in dbt_project.yml; git init (+ .gitignore from init), commit.
- **ch07** Sources + staging + first marts (names are FINAL):
  * `models/staging/jaffle_shop/_jaffle_shop__sources.yml` (source `jaffle_shop`, schema jaffle_shop: customers, orders, order_items, products)
  * `models/staging/stripe/_stripe__sources.yml` (source `stripe`: payments)
  * `stg_jaffle_shop__customers` (customer_id, first_name, last_name, email lower-cased, country, signup_date)
  * `stg_jaffle_shop__orders` (order_id, customer_id, order_date, status, loaded_at)
  * `stg_jaffle_shop__order_items` (order_item_id, order_id, product_id, quantity)
  * `stg_jaffle_shop__products` (product_id, product_name, category, price — dollars)
  * `stg_stripe__payments` (payment_id, order_id, payment_method, status, amount — dollars, created_at, loaded_at)
  * `_jaffle_shop__models.yml`, `_stripe__models.yml`: descriptions + unique/not_null on primary keys (preview of tests, Ch18).
  * `models/marts/fct_orders.sql` (one row per order: order_id, customer_id, order_date, status, amount = successful payments)
  * `models/marts/dim_customers.sql` (customer_id, first_name, last_name, email, country, first_order_date, most_recent_order_date,
    number_of_orders, lifetime_value) — logic of the Ch4 final lab, now with ref().
  * run `dbt run`, `dbt build`, `dbt compile`, `dbt ls`, `dbt docs generate` (just to see the lineage), show a source() compiled to
    "practice"."jaffle_shop"."orders"; demonstrate a source schema override (e.g. source name differs from schema) in the log.
- **ch08** Materializations: dbt_project.yml folder configs (staging: view; marts: table); `models/intermediate/int_payments__successful.sql`
  as **ephemeral**, used by fct_orders (show __dbt__cte__ in compiled SQL); show the DDL dbt runs for view/table (logs/dbt.log);
  try materialized_view (record outcome); incremental only previewed.
- **ch09** Modularity & refactoring: add `models/legacy/legacy_monthly_revenue.sql` (ugly legacy SQL with hard-coded table names and
  nested subqueries: monthly revenue & orders by customer country) → refactor into `models/intermediate/int_orders__enriched.sql`
  (orders + paid amount + customer country) and `models/marts/fct_monthly_revenue.sql` (month, country, number_of_orders, revenue);
  prove equality (EXCEPT both ways, as an analysis or ad-hoc dbt show); then delete the legacy model. DAG rules discussion.
- **ch10** Configuration: +schema (marts → custom schema "marts" → dbt_adnane_marts with default generate_schema_name; then override
  macro `macros/generate_schema_name.sql` with the common dev/prod pattern), tags, meta, docs.node_color, vars (+ --vars), env_var, target
  (dev-only filter in a staging model), alias example, hooks (pre/post-hook, on-run-start/end — valid on DuckDB), grants config
  (record DuckDB behaviour), config precedence demo (project vs properties yml vs config() block).
- **ch11** Jinja/macros/packages: `macros/cents_to_dollars.sql` (used in stg_stripe__payments and stg_jaffle_shop__products);
  `packages.yml` with dbt_utils (`[">=1.3.0", "<2.0.0"]`) and audit_helper; `dbt deps`; package-lock.yml;
  `int_orders__payment_methods_pivoted` (for loop over payment methods — and/or dbt_utils.get_column_values);
  `fct_order_items` with `dbt_utils.generate_surrogate_key`; a `run-operation` macro (e.g. `print_row_counts`); audit_helper
  compare_relations demo (legacy vs refactored, can use an analysis).
- **ch12** Seeds & analyses: `seeds/country_regions.csv` (country, region, currency) + `seeds/_seeds.yml` (column_types, descriptions);
  dim_customers gains `region`; `analyses/revenue_by_region.sql`; `dbt seed`, `dbt compile -s revenue_by_region`.
- **ch13** Snapshots in YAML: `snapshots/snapshots.yml` with `customers_snapshot` (check strategy on email, country; unique_key id; source
  customers) and `orders_snapshot` (timestamp strategy, updated_at `_loaded_at`, unique_key id); run, apply day2.sql, run again, query
  history (dbt_valid_from/to, dbt_scd_id, dbt_updated_at); try hard_deletes options; show legacy SQL `{% snapshot %}` syntax for recognition.
- **ch14** Incremental & microbatch: `fct_orders` becomes incremental (unique_key order_id; strategy chosen + justified; filter on
  loaded_at with is_incremental()); try every strategy supported by dbt-duckdb and record; on_schema_change demo; --full-refresh;
  microbatch model `fct_order_items_daily` (or similar) with event_time on upstream models (order_date), batch_size, begin, lookback;
  backfill with --event-time-start/--event-time-end; day2.sql then incremental runs. Add `event_time` configs needed for --sample (Ch16).
- **ch15** Python model: `models/marts/customer_segments.py` (segments from dim_customers lifetime_value / number_of_orders with pandas;
  materialized table); show dbt.ref, dbt.config; run it.
- **ch16** Commands & selection: `selectors.yml` (e.g. `nightly`, `staging_only`); capture outputs of dbt ls with many selectors
  (graph operators +, n+, @, *, set union/intersection, methods tag/path/source/resource_type/config/test_type/state/result/exposure/...),
  `dbt build --empty`, `dbt run --sample` (real working syntax), `dbt show`, `--fail-fast`, `--threads`, `dbt clean`, `dbt parse`, `dbt list --output json`.
- **ch17** Governance: `models/_groups.yml` (finance, marketing), access private/protected/public, contract enforced on dim_customers
  (data_type for all columns) + constraints (not_null, primary_key, check lifetime_value >= 0, ...); demonstrate contract failure and
  constraint violation messages; versions on dim_customers (v1 current + v2 changed shape; latest_version; deprecation_date; ref with v=);
  cross-project ref only described (dbt Mesh) — no second project required unless easy.
- **ch18** Data tests: `arguments:` syntax (1.10+); accepted_values (orders.status, payments.payment_method), relationships
  orders.customer_id → customers (FAILS because of orphan order 159 → handle with severity/warn_if/error_if/where + explain); singular tests
  (`tests/assert_payments_match_order_totals.sql`, …); custom generic test (`tests/generic/test_is_positive.sql`); dbt_utils tests;
  source tests; store_failures; dbt build skip behaviour after a failing test.
- **ch19** Unit tests: `unit_tests` for dim_customers (lifetime value logic), stg_stripe__payments (cents → dollars), incremental fct_orders
  (overrides: macros: is_incremental: true, `this` input); formats dict/csv/sql; `dbt test -s test_type:unit`; build order; exclude in prod.
- **ch20** Docs: `models/docs.md` doc blocks (order status), `__overview__`, descriptions, `dbt docs generate` (catalog.json) / serve,
  persist_docs (record DuckDB behaviour).
- **ch21** Freshness & exposures: freshness on sources (loaded_at_field `_loaded_at`, warn_after/error_after, filter) — show stale ERROR,
  then fresh_load.sql → PASS; sources.json; `source_status:fresher+`; `models/exposures.yml` (dashboard depends on fct_monthly_revenue,
  dim_customers; owner; maturity; url) and selection with exposures.
- **ch22** Debugging: `labs/practice-project/bugs/` = small patch files (or instructions) that each create one error type: Jinja
  compilation error, YAML parse error, database error (bad column), dependency cycle, ref to missing model, duplicate model name,
  undefined source; capture the REAL error messages and how to locate them (target/compiled, logs/dbt.log, dbt compile/show/parse);
  flags: `flags:` in dbt_project.yml, --warn-error, --warn-error-options, behavior change flags, --debug/--log-level.
- **ch23** Pipelines & clone: failure in the middle of the DAG (run vs build skip behaviour), --fail-fast, threads; production build
  (`--target prod`), save prod artifacts to `prod-artifacts/` (gitignored); `dbt clone --state prod-artifacts` into dev — record
  what DuckDB creates (views?) and messages.
- **ch24** State/defer/retry: modify a model, `dbt ls -s state:modified+ --state prod-artifacts`, sub-selectors (state:modified.body …),
  state:new; `--defer --state prod-artifacts` building one model whose parents are only in prod; `--favor-state`; result selectors with
  `--state target` (result:error+, result:fail); dbt retry after a fixed failure (show run_results.json usage).
- **ch25** Environments/CI: `.github/workflows/ci.yml` (slim CI for dbt Core + DuckDB: install, deps, build prod artifacts or download
  them, `dbt build --select state:modified+ --defer --state ...`, optionally `--empty` first), `.github/pull_request_template.md`;
  validate the workflow YAML parses; run the CI commands locally to prove they work.
