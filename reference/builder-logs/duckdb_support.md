# Feature support matrix: dbt-core 1.11.16 + dbt-duckdb 1.11.0 + DuckDB 1.5.6

Everything below was RUN by the builder (macOS, Python 3.12). "Log" points to the file in this folder
where the full command and output are. Messages are copied exactly (paths shortened with `...`).
When the exam (warehouse-agnostic dbt) expects something different, it is said in **Exam view**.

## Summary table

| Feature | Result on DuckDB | Log |
|---|---|---|
| grants | NO-OP + one log line; no GRANT is run; not counted as a warning in the summary | ch10, ch23 |
| materialized_view | ERROR (not implemented) | ch08 |
| dbt clone | works, but creates a VIEW `select * from <prod relation>` (no zero-copy); model post-hooks run during clone | ch23 |
| incremental: default (no strategy) | works = delete+insert when unique_key is set | ch14 |
| incremental: append | works (duplicates when rows change) | ch14 |
| incremental: delete+insert | works | ch14 |
| incremental: merge | works (DuckDB >= 1.4: `MERGE INTO ... UPDATE BY NAME / INSERT BY NAME`) | ch14 |
| incremental: insert_overwrite | ERROR (not valid for this adapter) | ch14 |
| incremental: microbatch | works (delete+insert per batch); see concurrency caveat | ch14, ch23 |
| on_schema_change ignore / fail / append_new_columns / sync_all_columns | all four behave as documented, EXCEPT ignore + merge + new column = ERROR | ch14 |
| contracts (table, incremental) | enforced: empty table created with the declared types and constraints, then INSERT | ch17, matrix_tests |
| contracts on views | columns/types checked; constraints IGNORED with a warning | matrix_tests |
| contracts on ephemeral | silently NOT checked (wrong data_type accepted, no warning) | matrix_tests |
| constraint not_null | ENFORCED | ch17 |
| constraint unique | ENFORCED | ch17 |
| constraint primary_key | ENFORCED | ch17 |
| constraint check | ENFORCED | ch17 |
| constraint foreign_key | ENFORCED (parent needs PK/unique; parent can then no longer be rebuilt) | matrix_tests |
| Python models (table, incremental) | work (in-process, pandas) | ch15, matrix_tests |
| Python model materialized view | ERROR | ch15 |
| --empty | works (views/tables with 0 rows) | ch16, ch19, ch14 addendum |
| --sample | works on refs/sources that have `event_time` | ch16 |
| persist_docs (relation + columns) | works for tables AND views (COMMENT ON) | ch20, matrix_tests |
| store_failures / store_failures_as: view | works | ch18, matrix_tests |
| snapshots (YAML + legacy SQL) | work | ch13 |
| snapshots hard_deletes ignore / invalidate / new_record | all work; switching an EXISTING snapshot to new_record = ERROR | ch13 |
| unit tests | work (dict / csv / sql); parents must exist in the database | ch19, ch25 |
| source freshness | works (`max(loaded_at_field)` vs `now()`), filter supported | ch21 |
| --defer / --favor-state | work (same DuckDB file, other schema) | ch24, ch25 |
| dbt retry | works | ch24 |
| run-operation | works | ch11, matrix_tests |
| hooks (pre/post-hook, on-run-start/end) | work | ch10 |
| seeds | work; changing the CSV columns needs --full-refresh | ch12 |
| YAML JSON-schema validation (deprecations about keys) | SKIPPED for duckdb (only bigquery/databricks/redshift/snowflake) | ch22 |
| dbt docs generate / serve / --static | work | ch20 |

## Details and exact messages

### grants
Config `+grants: {select: ['reporter']}` on the marts. dbt-duckdb's `apply_grants` only calls `warn_once`:
```
21:47:54  DuckDB adapter: Grants for relations are not supported by DuckDB
```
No `grant` statement in logs/dbt.log (count 0). The model is built normally; `Done. PASS=3 WARN=0 ...`
(the message is not counted as a dbt warning). The project keeps grants for prod only:
`+grants: "{{ {'select': ['reporter']} if target.name == 'prod' else {} }}"` (renders to a real dict;
dev runs print nothing, prod runs print the line above).
**Exam view:** on Snowflake/BigQuery/Databricks dbt runs GRANT (and REVOKE when `copy_grants`/revokes apply).

### materialized_view
```
Compilation Error in model mv_orders_by_status (models/marts/mv_orders_by_status.sql)
  `get_create_materialized_view_as_sql` has not been implemented for this adapter.
  > in macro default__get_create_materialized_view_as_sql (macros/relations/materialized_view/create.sql)
```

### dbt clone
- Every relation already present in the target: `Relation "practice"."dbt_adnane"."fct_orders" already exists` (one line per node), nothing changes, `PASS=17`.
- Missing relation: created as a VIEW. target/run:
  ```
  create view "practice"."dbt_adnane"."fct_monthly_revenue__dbt_tmp" as (
    select * from "practice"."marts"."fct_monthly_revenue"
  );
  ```
  DuckDB stores it as `CREATE VIEW dbt_adnane.fct_monthly_revenue AS SELECT * FROM practice.marts.fct_monthly_revenue;`
- `--full-refresh` replaces an existing dev table by such a view.
- Model post-hooks run during clone. With the marts post-hook `analyze {{ this }}`:
  `Runtime Error in model fct_monthly_revenue ... Binder Error: Can only vacuum or analyze base tables`
  (the clone is rolled back). Fix used in the project: `"{% if flags.WHICH != 'clone' %}analyze {{ this }}{% endif %}"`.
- The project config is unchanged (`dbt ls` still says incremental/table); only the dev relation is a view.
**Exam view:** on Snowflake/BigQuery/Databricks, clone makes a zero-copy CLONE of tables (views elsewhere).

### Incremental strategies (fct_orders: full refresh on day 1 = 300 rows, then day2.sql, then one incremental run)
| strategy | rows after | order 288 rows | first statement in dbt.log |
|---|---|---|---|
| none (default) | 320 | 1 (shipped) | `delete from ... where (order_id) in (select (order_id) from "fct_orders__dbt_tmp...")` |
| append | 333 | 2 (placed + shipped) | `insert into ... (select ... from "fct_orders__dbt_tmp...")` |
| delete+insert | 320 | 1 | `delete from ... where (order_id) in (...)` |
| merge | 320 | 1 | `MERGE INTO ... AS DBT_INTERNAL_DEST USING ... ON (...) WHEN MATCHED THEN UPDATE BY NAME WHEN NOT MATCHED THEN INSERT BY NAME` |
| insert_overwrite | 300 (run failed) | 1 (placed) | `The incremental strategy 'insert_overwrite' is not valid for this adapter` |

- dbt-duckdb: merge requires DuckDB >= 1.4.0 (`DUCKDB_MERGE_LOWEST_VERSION_POSSIBLE = "1.4.0-dev0"`); valid strategies here: append, delete+insert, merge, microbatch.
- microbatch + unique_key: `microbatch incremental strategy does not support 'unique_key'. Microbatch runs delete+insert per batch based on 'event_time' and does not do key-based upserts. Remove 'unique_key' or use incremental_strategy='merge'.`
- microbatch without begin (parse time): `Microbatch model 'fct_orders' must provide a 'begin' (datetime) config that indicates the earliest timestamp the microbatch model should be built from.`
- microbatch batches run IN PARALLEL by default (adapter declares MicrobatchConcurrency). With persist_docs and a post-hook on the same table, 12 of 22 batches failed: `TransactionContext Error: Catalog write-write conflict on alter with "fct_order_items_daily"` -> `PARTIAL SUCCESS (10/22)`. The failing statement was `comment on table ...` (persist_docs). Fix: `concurrent_batches=False` (in the reference repo from tag ch20, where persist_docs is introduced).
- microbatch per-batch compiled SQL: `target/compiled/.../fct_order_items_daily/fct_order_items_daily_2025-03.sql`, refs wrapped as `(select * from ... where order_date >= '2025-03-01 00:00:00+00:00' and order_date < '2025-04-01 00:00:00+00:00')`.
- A normal microbatch run only processes the current batch + `lookback` (relative to NOW, 2026-10 here): late January data needed `--event-time-start '2026-01-01' --event-time-end '2026-02-01'`.
- Trap (all adapters): after `--empty`, a filter `loaded_at > (select max(loaded_at) from {{ this }})` inserts 0 rows forever (max of empty = NULL). Fixed with `coalesce(max(loaded_at), '1900-01-01')` (ch14 addendum).
- Trap: turning an existing TABLE into incremental without --full-refresh, with a new column in the filter: `Binder Error: WHERE clause cannot contain aggregates!` (DuckDB binds `max(loaded_at)` to the outer query because the old table has no such column).

### on_schema_change (incremental fct_orders; change = add `order_month`, remove `gift_card_amount`)
- `fail`: `The source and target schemas on this incremental model are out of sync! ... Source columns not in target: [DuckDBColumn(column='order_month', dtype='DATE', ...)] Target columns not in source: [DuckDBColumn(column='gift_card_amount', dtype='DECIMAL(38,2)', ...)]`
- `append_new_columns`: order_month added (NULL for the 287 old rows, filled for the 33 new/changed rows); gift_card_amount kept.
- `sync_all_columns`: order_month added, gift_card_amount dropped.
- `ignore` + delete+insert + only a NEW column: run OK, the column is NOT added (documented behaviour).
- `ignore` + a REMOVED column: `Binder Error: Referenced column "gift_card_amount" not found in FROM clause!` (documented: ignore fails when a column disappears).
- `ignore` + **merge** + a NEW column: `Binder Error: Table "fct_orders" does not have a column with name "order_month"` - DuckDB-specific (the merge uses `INSERT BY NAME`). **Exam view:** ignore = new column silently ignored.
- Contracted incremental model with the default `ignore`: whole project fails to parse:
  `Invalid value for on_schema_change: ignore. Models materialized as incremental with contracts enabled must set on_schema_change to 'append_new_columns' or 'fail'`

### Contracts and constraints
- DDL (target/run): `create table ... ( customer_id integer not null primary key, ..., email varchar unique, ..., constraint lifetime_value_not_negative check (lifetime_value >= 0) )` then `insert into ... ( col, ... ) ( select ... )`.
- Type mismatch: `This model has an enforced contract that failed. ... | lifetime_value | DOUBLE | DECIMAL(38,2) | data type mismatch |`
- Renamed column: `| region | | VARCHAR | missing in definition |` and `| sales_region | VARCHAR | | missing in contract |`
- check: `Constraint Error: CHECK constraint failed on table dim_customers__dbt_tmp with expression CHECK((lifetime_value >= 0))`
- not_null: `Constraint Error: NOT NULL constraint failed: dim_customers__dbt_tmp.customer_id`
- unique: `Constraint Error: PRIMARY KEY or UNIQUE constraint violation: duplicate key "same@example.com"`
- The previous good table stays in place when a constraint fails (the error happens on `__dbt_tmp`).
- foreign_key to a parent with a primary key: DDL `parent_id integer references "dbt_adnane"."mx_parent" (id)` (dbt-duckdb drops the database part); violation: `Constraint Error: Violates foreign key constraint because key "id: 3" does not exist in the referenced table`
- foreign_key to a parent without PK/unique: `Binder Error: Failed to create foreign key: there is no primary key or unique constraint for referenced table "mx_parent_nopk"`
- once a child has an FK, rebuilding the PARENT fails: `Dependency Error: Cannot alter entry "mx_parent" because there are entries that depend on it.` -> avoid FK constraints between dbt-managed tables on DuckDB.
- View with constraints: `[WARNING]: Constraint types are not supported for view materializations and will be ignored.  Set 'warn_unsupported: false' on this constraint to ignore this warning.` (0 constraints in duckdb_constraints()).
- Ephemeral with a contract whose data_type is wrong: built without any error or warning (contract not checked).
- State comparison: removing a column from a contracted version = `Breaking change to contract Error in model dim_customers ... - Columns were removed: - email ... Otherwise, create a new model version`; adding a column = only `state:modified.contract`.
**Exam view:** Snowflake enforces only NOT NULL (others informational); Postgres/DuckDB enforce all; BigQuery enforces NOT NULL.

### Python models
- Table: OK (`START python table model ...`). `dbt.ref()` returns a DuckDB relation, `.df()` gives pandas; DECIMAL(38,2) became DOUBLE in the output table.
- Incremental (`dbt.is_incremental`, `dbt.this`, `session.sql(...)`): OK, no duplicates after 2 runs.
- View: `Materialization "materialization_view_default" only supports languages ['sql']; got "python"`
- With --empty the function receives EMPTY DataFrames: `ValueError: Bin edges must be unique: Index([nan, nan, nan, nan, nan], ...)` from `pd.qcut` (fixed in ch16).

### --empty
Tables/views created with 0 rows (refs and sources become `(select * from ... where false limit 0)`); seeds loaded normally (`INSERT 6`); snapshots created empty; tests run and pass; microbatch runs every batch with 0 rows. `dbt run --empty` does not load seeds (a model reading a seed then fails with `Catalog Error: Table with name country_regions does not exist!` on a new database).

### --sample
`--sample="{'start': '2026-01-01', 'end': '2026-01-05'}"` and `--sample='3 days'` work; filter is applied only to refs/sources with `event_time`: `(select * from "practice"."jaffle_shop"."orders" where order_date >= '2026-01-01 00:00:00+00:00' and order_date < '2026-01-05 00:00:00+00:00')`. Invalid value:
`Error: Invalid value for '--sample': Runtime Error  Invalid grain size 'dayz'. Must be one of ['hour', 'day', 'month', 'year', 'hours', 'days', 'months', 'years'].`

### persist_docs
`comment on table "practice"."dbt_adnane"."customer_segments" is $dbt_comment_literal_block$...$dbt_comment_literal_block$;` and `comment on column ...`; visible in `duckdb_tables().comment`, `duckdb_views().comment`, `duckdb_columns().comment`; columns without description get no comment. Works for Python models and views too.

### store_failures
`--store-failures` or `store_failures: true` -> table named like the compiled test file (`relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c`), in `dbt_adnane` in dev (the project's generate_schema_name ignores the custom schema `dbt_test__audit` outside prod; in prod the test's schema is `dbt_test__audit`). `store_failures_as: view` creates a VIEW. Output line: `See test failures: select * from "practice"."dbt_adnane"."relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c"`.

### Snapshots
- YAML snapshots: 4 meta columns `dbt_scd_id, dbt_updated_at, dbt_valid_from, dbt_valid_to`; check strategy -> valid_from = time of the snapshot run; timestamp strategy -> valid_from = updated_at value.
- `schema: snapshots` goes through generate_schema_name (dev: dbt_adnane, prod: snapshots); legacy SQL `target_schema='snapshots'` is used AS IS (created schema `snapshots` even in dev).
- hard_deletes `ignore`: deleted source row stays current; `invalidate`: dbt_valid_to set to the run time, a returning row gets a new version; `new_record`: new row with `dbt_is_deleted = 'True'` (column type VARCHAR), returning row gets `'False'`.
- Switching an existing snapshot to new_record: `Compilation Error in snapshot customers_snapshot ... Snapshot target is missing configured columns (missing "dbt_is_deleted").`
- `dbt_valid_to_current: "cast('9999-12-31' as timestamp)"` and `snapshot_meta_column_names` work.

### Unit tests
- Parents must exist (column types are read from the database): `Not able to get columns for unit test 'stg_jaffle_shop__customers' from relation "practice"."dbt_adnane"."stg_jaffle_shop__customers" because the relation doesn't exist`.
- `input: this` on an incremental model needs the model's own relation: first `dbt build` on a brand-new schema -> the unit test errors and the model is SKIPPED. With `--defer --state <prod>` the lookup is deferred to the prod relation and it passes; for a NEW model (not in prod) it fails again -> run `dbt run --empty` first (ch25).
- Missing input: `Unit_Test '...test_dim_customers_lifetime_value_v1' ... depends on a node named 'country_regions' which was not found`.
- Failure output: `actual differs from expected:` followed by a diff table (`12.50→125.00`; the arrow is a non-ASCII character in dbt's output).
- Versioned model: one unit test per version (`test_dim_customers_lifetime_value_v1`, `_v2`).

### Source freshness
Query: `select max(_loaded_at) as max_loaded_at, now() as snapshotted_at from "practice"."jaffle_shop"."orders"` (+ `where status = 'success'` with the filter). Stale: `ERROR STALE freshness of jaffle_shop.orders`; fresh: `PASS`. `_loaded_at` is TIMESTAMP (no time zone) and is read as UTC -> fresh_load.sql stores UTC time. A partial run (`--select source:stripe`) REPLACES target/sources.json, which then breaks `source_status:fresher+` for the other sources.

### Hooks
- Model post-hook `analyze {{ this }}` (DuckDB ANALYZE) OK in run/build; breaks clone (see above).
- on-run-start / on-run-end: printed as `1 of 3 START hook: jaffle_dbt.on-run-start.0 ... [OK in 0.01s]`; executed by `dbt run` and `dbt test`; NOT by `dbt compile` and `dbt ls` (verified with an audit table).

### Seeds
Adding a column to the CSV without --full-refresh: `Runtime Error in seed country_regions ... Invalid Input Error: Error when sniffing file ".../seeds/country_regions.csv". It was not possible to automatically detect the CSV parsing dialect ... Columns are set as: "columns = { 'country' : 'VARCHAR', 'region' : 'VARCHAR', 'currency' : 'VARCHAR'}", and they contain: 3 columns. It does not match the number of columns found by the sniffer: 4.` With --full-refresh: `CREATE 6`.

### DuckDB-specific facts that affect the book
- One writer per database file. dbt while another process has it open read-write:
  `IO Error: Could not set lock on file ".../practice/practice.duckdb": Conflicting lock is held in <program path> (PID 34108) by user mac. See also https://duckdb.org/docs/stable/connect/concurrency`
  ...and while another process has it open READ-ONLY (like `duckdb -readonly`), dbt fails too:
  `... Conflicting lock is held in <program path> (PID 34205) by user mac. However, you would be able to open this database in read-only mode, e.g. by using the -readonly parameter in the CLI. See also https://duckdb.org/docs/stable/connect/concurrency`
  (builder reproduced the holder with Python `duckdb.connect`; with the CLI the holder path is the duckdb program). The lock is released as soon as dbt finishes.
- The database (catalog) name is the file stem: `practice.duckdb` -> `"practice"`. A COPY under another name breaks every view inside it: `Binder Error: Catalog "practice" does not exist!` Copy into another folder with the same file name instead.
- dbt-core 1.11 runs its YAML JSON-schema validation only for bigquery/databricks/redshift/snowflake. On DuckDB, `CustomKeyInObjectDeprecation` (typo `desciption:`) and `PropertyMovedToConfigDeprecation` (top-level `meta`, `tags`, `docs`, `group`, `access`, `freshness`, `loaded_at_field`) are NOT shown. Forced on (builder helper), they appear, e.g. `Found 'freshness' as a top-level property of 'sources[0].tables[0]' in file ... should be moved into the 'config' of 'sources[0].tables[0]'.` The reference project raises none of them even when forced.
- `MissingArgumentsPropertyInGenericTestDeprecation` (test inputs not under `arguments:`) IS shown on DuckDB:
  `[WARNING][MissingArgumentsPropertyInGenericTestDeprecation]: Deprecated functionality Found top-level arguments to test 'accepted_values' defined on 'stg_jaffle_shop__orders' ... Arguments to generic tests should be nested under the 'arguments' property.`
- Integer `/` integer returns DOUBLE; decimal / integer returns DOUBLE too; the project casts money to DECIMAL(16,2).
- `dbt show` prints decimals without trailing zeros and with thousands separators (`4,988.4`).
