# Mock Exam 3 (StreamBox) -- verification log

Environment: dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb 1.5.6 (venv scratchpad/v156/.venv), scratch project
scratchpad/mock3/sb (profiles in scratchpad/mock3/profiles, targets dev=dbt_adnane, prod=analytics, fresh=dbt_fresh).
Raw notes with the observed outputs: scratchpad/mock3/notes_raw.md.  "RUN" = reproduced with dbt; "DOCS" = docs.getdbt.com (WebFetch); "CODE" = read in dbt-core 1.11.16 source.

| Q | Obj | Format | How verified |
|---|-----|--------|--------------|
| 1 | 1.6 | MC | RUN: exact dbt_project.yml + _marts.yml; dbt ls --output json -> materialized incremental, tags [streambox, marts, daily, yaml_tag] |
| 2 | 6.2 | MC | RUN: exact sources YAML; dbt source freshness -> invoices ERROR STALE, refunds WARN, payouts not checked (only 2 nodes) |
| 3 | 1.2 | DOMC | RUN: dbt run -s ephemeral -> no node run; not_null test on ephemeral PASS; dbt show on ephemeral -> rows; contract on ephemeral silently not checked; no relation created |
| 4 | 3.2 | Hotspot | RUN: exact ephemeral model (2-line select); compiled file shown verbatim; Binder Error at line 7 select; alias session_day on line 3 |
| 5 | 1.14 | FIB | RUN: microbatch begin 2026-10-11, day, lookback=2; 2nd run on 2026-10-21 -> "Batch 1 of 3 ... 2026-10-19", 10-20, 10-21 |
| 6 | 7.1 | MC | RUN: macro body change; ls state:modified / .macros -> fct_invoice_amounts; .body / .configs -> no nodes |
| 7 | 5.1 | MC | RUN: dict rows for ephemeral input -> "Not able to get columns ... relation doesn't exist"; format: sql -> PASS. DOCS: ephemeral inputs need format sql |
| 8 | 1.11 | Matching | DOCS: incremental-strategy page (append, merge, delete+insert "useful when unique_key isn't truly unique", insert_overwrite partitions, microbatch batches); BigQuery 3 strategies (no delete+insert) |
| 9 | 2.1 | DOMC | RUN: YAML order differs -> OK, table in YAML order; extra SQL column -> "missing in contract"; missing data_type -> parse OK, run error; sync_all_columns+contract -> parse error; unversioned breaking change -> WARNING only |
| 10 | 1.7 | MC | RUN: lock pinned 1.1.1 -> dbt deps installs 1.1.1 (1.2.1 in range available); dbt deps --upgrade -> 1.2.1, lock rewritten |
| 11 | 4.1 | MC | RUN: warn accepted_values on stg_app__subscriptions (WARN 1) + not_null error on stg_billing__invoices (FAIL 2) -> dim_subscribers, rpt_plan_mix OK; fct_invoices, fct_invoice_amounts SKIP |
| 12 | 1.1 | FIB | RUN: dbt compile --inline -> "streambox"."stripe_billing"."invoices_2026" |
| 13 | 2.2 | Build list | DOCS (model versions: prerelease when v > latest_version; deprecation_date warnings) + RUN (ref resolution with latest_version 1; v=2 pin; warnings for deprecated v1). Order logic forced by the two stated rules |
| 14 | 5.2 | MC | RUN: same 7 failing rows; severity warn + error_if >3 -> WARN 7; error_if >10 + warn_if >5 -> WARN 7 |
| 15 | 1.10 | Hotspot | RUN: exact YAML -> "A snapshot configured with the timestamp strategy must specify an updated_at configuration."; strategy: check -> snapshot OK |
| 16 | 7.2 | MC | RUN: build ERROR+SKIP, fix, dbt compile -s dim_subscribers, dbt retry -> "Nothing to do" |
| 17 | 1.4 | MS2 | RUN: add CSV column -> dbt seed error; --full-refresh OK; dbt run -s seed -> Nothing to do; --empty not an option of dbt seed (--help); dbt build runs seed + its tests (DOCS) |
| 18 | 3.5 | MC | RUN: flags fail_fast true + DBT_FAIL_FAST=false -> fail_fast False (dbt.log args line); env false + --fail-fast -> True |
| 19 | 1.12 | DOMC | RUN: dbt build --empty ran unit test + data tests (PASS); seed has no --empty (--help); hard-coded table not wrapped; dbt compile --empty shows where false limit 0 |
| 20 | 6.1 | MC | RUN: type report -> Parsing Error "'report' is not one of ['dashboard', 'notebook', 'analysis', 'ml', 'application']"; owner with name only parses |
| 21 | 1.5 | MC | RUN: exact model; first run OK, second run "dbt was unable to infer all dependencies ..."; -- depends_on hint fixes it |
| 22 | 4.2 | MC | DOCS: clone page (zero-copy on Snowflake/Databricks/BigQuery, otherwise pointer view). RUN on DuckDB (no zero-copy): CREATE VIEW ... AS SELECT * FROM analytics.x |
| 23 | 5.2 | Matching | RUN: where -> FAIL 2 (subset); limit 3 -> FAIL 3; store_failures -> table in dbt_adnane_dbt_test__audit; fail_calc sum(n_bad) -> PASS; severity warn -> WARN; wrapper shows count(*) as failures |
| 24 | 1.3 | MC | RUN: dbt compile --inline -> "round( / 100.0, 2)" (no compile error) |
| 25 | 2.3 | MC | DOCS: constraints page: Snowflake enforces only not_null; PK/unique/FK metadata only |
| 26 | 7.1 | MS2 | RUN: materialized change in dbt_project.yml -> modified.configs; meta -> modified.configs; tags -> not modified (CODE: CompareBehavior.Exclude); description w/o persist_docs -> not modified; alias -> modified.relation only |
| 27 | 1.8 | Hotspot | RUN: exact Python model -> "Parsing Error ... No jinja in python model code is allowed"; with min_secs variable -> OK |
| 28 | 3.1 | Matching | RUN: each message reproduced (YAML indent, missing ref, cycle, contract mismatch, Binder Error "Referenced column ... not found in FROM clause!") |
| 29 | 1.10 | MC | RUN: hard_deletes new_record + dbt_valid_to_current: deleted id -> old row closed at run time + new row dbt_is_deleted 'True', valid_to 9999-12-31 |
| 30 | 5.3 | Build list | RUN: dbt build --threads 1 -s +fct_device_watch START order: views -> parent tests -> unit test -> model -> model tests |
| 31 | 1.1 | MC | RUN: hard-coded table -> depends_on nodes []; not in dbt ls -s source:events+ |
| 32 | 1.14 | DOMC | RUN: compiled batch SQL (parent without event_time unfiltered); --event-time-start alone -> usage error; failed batch + dbt retry -> 1 batch; --full-refresh -> 11 batches from begin; default lookback 1 (dbt ls config) |
| 33 | 3.3 | MC | RUN: top-level values -> [WARNING][MissingArgumentsPropertyInGenericTestDeprecation], test still runs; arguments: + config: -> no warning |
| 34 | 1.6 | FIB | RUN: dbt ls --target prod -> schema analytics_finance, alias invoice_events (dev: dbt_adnane_finance) |
| 35 | 5.1 | FIB | RUN: overrides: macros: is_incremental: true + input: this -> PASS; DOCS unit-test-overrides |
| 36 | 7.1 | DOMC | RUN: --defer -> analytics.stg_app__subscriptions + dbt_fresh.stg_app__devices; --favor-state -> both analytics; no defer -> Catalog Error; model built in dbt_fresh |
| 37 | 1.9 | MC | RUN: dbt ls config.grants -> {'select': ['finance_team', 'auditor']}; DOCS grants (+ prefix appends, otherwise more specific clobbers) |
| 38 | 2.1 | MS2 | RUN: python + contract -> Parsing Error "Language Error: Expected 'sql' but found 'python'"; ephemeral + contract -> not checked. DOCS contract page: not supported for ephemeral / python; view + incremental(append_new_columns/fail) supported |
| 39 | 1.5 | Build list | DOCS: guide "Refactoring legacy SQL to dbt" (migrate 1:1, sources, CTE groupings, port CTEs to models, audit) |
| 40 | 1.3 | Hotspot | RUN: exact macro + model -> 'syntax error at or near "sum"'; compiled shows missing commas, trailing comma after last |
| 41 | 6.2 | FIB | RUN: dbt ls -s "source_status:fresher+" --state (previous sources.json) -> models downstream of the refreshed source |
| 42 | 4.1 | MS2 | RUN: failing error test on stg_events__playback -> SKIP fct_daily_watch (via ephemeral), fct_playback_daily; py_device_stats, snapshots, dim_subscribers OK |
| 43 | 1.11 | MC | RUN: sync_all_columns -> dropped removed columns, added amount, old rows NULL (append_new_columns and fail also run for distractors) |
| 44 | 3.1 | MC | RUN: logs/dbt.log contains [debug] lines with SQL by default |
| 45 | 1.7 | DOMC | RUN: both files with packages -> Runtime Error; Jinja not rendered in dependencies.yml; unpinned git warning + lock records sha; build without deps -> "Run dbt deps". DOCS: projects in dependencies.yml |
| 46 | 5.1 | MC | RUN: expect {2} PASS, expect {1,2} FAIL. DOCS: expected output is what will be merged/inserted |
| 47 | 2.2 | MC | RUN: ref -> dim_devices.v1; warnings "passed its deprecation date" + "Found a reference to dim_devices.v1, which was deprecated"; run PASS=3 |
| 48 | 1.2 | Matching | DOCS (materializations page) + RUN (view/table DDL in dbt.log; ephemeral CTE) |
| 49 | 4.2 | DOMC | RUN: existing dev relation -> "Relation ... already exists" kept; --full-refresh replaces; ephemeral not cloned. DOCS: defer cheaper; BI testing use case |
| 50 | 1.4 | MC | RUN: dbt show --target fresh -> Catalog Error dbt_fresh.stg_events__playback does not exist; nothing created |
| 51 | 3.4 | Build list | Standard git/PR workflow (Chapter 3) + CI with state:modified+ --defer (DOCS CI jobs). Order forced by dependencies (test must fail before fix) |
| 52 | 6.1 | MS2 | RUN: ls +exposure -> upstream nodes + tests; dbt run -s exposure:x -> Nothing to do; owner name only valid; build +exposure PASS=9 + NO-OP exposure |
| 53 | 1.12 | MC | RUN: dbt compile --empty exact model -> two refs wrapped, .render() source and raw_app.devices not wrapped |
| 54 | 7.2 | Build list | RUN: retry before fix -> ERROR again + SKIP; after fix -> OK OK; again -> Nothing to do |
| 55 | 2.1 | MC | RUN: contract mismatch -> Compilation Error; dbt.log shows DESCRIBE (... where false limit 0) preflight; old table still 6 rows DOUBLE |
| 56 | 3.3 | Hotspot | RUN: exact YAML -> "Syntax error near line 10 ... mapping values are not allowed in this context" |
| 57 | 1.4 | FIB | RUN: dbt docs generate --static -> target/static_index.html |
| 58 | 5.1 | MC | RUN: count(*) test -> FAIL 1 with 0 bad rows; fail_calc sum(n_bad) -> PASS |
| 59 | 7.1 | Matching | RUN: defer / favor-state / clone / state:modified+ / state:new behaviours (Q36, Q49, Q6 runs; state:new new model) |
| 60 | 1.13 | MC | RUN: --sample="2 days" -> only event_time inputs filtered (rolling now-2d..now); stg_app__devices unfiltered; "1 week" -> Invalid grain size 'week' |
| 61 | 4.1 | DOMC | RUN: --fail-fast -> ERROR then CANCEL; failing unit test -> model + tests SKIP; warn test no skip; on-run-start failure default -> models still run (flag skip_nodes_if_on_run_start_fails default False, CODE+RUN); other branches continue |
| 62 | 2.3 | MC | RUN (DuckDB): constraints without contract -> no constraint DDL, NULL + duplicate rows accepted; with contract -> "NOT NULL constraint failed". DOCS: constraints require enforced contract |
| 63 | 5.2 | MS2 | RUN: data_tests on source columns PASS; singular test on source; unit test with model: source(...) -> Parsing Error. DOCS: constraints/contracts not for sources |
| 64 | 3.2 | MC | RUN: target/run/.../fct_daily_watch.sql contains create table ... __dbt_tmp as ( ; target/compiled has only the select |
| 65 | 5.3 | MC | RUN: --exclude-resource-type unit_test removes unit tests; dbt build runs unit tests; unit test with missing parent relation -> error. DOCS: run unit tests in dev/CI only |

Not fully reproducible locally (platform-specific, checked in docs only): Q22 Snowflake/Postgres clone behaviour (DuckDB run confirms the
"pointer view" branch), Q25 Snowflake constraint enforcement, Q8 adapter-specific strategies (BigQuery insert_overwrite), Q62 is
reproduced on DuckDB (the question says Postgres; dbt-core logic is identical: without an enforced contract no constraint DDL is generated).
