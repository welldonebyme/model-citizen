# Mock Exam 1 - verification log (one line per question)

Scratch project: scratchpad/mock1/dbt-course/jaffle_dbt (replica of the PROJECT_SPEC names: sources jaffle_shop/stripe,
stg_* models, int_payments__successful (ephemeral), int_orders__enriched, int_orders__payment_methods_pivoted,
fct_orders, fct_order_items (dbt_utils 1.4.1), dim_customers (+contract), fct_monthly_revenue, customer_segments.py,
fct_orders_monthly (microbatch), seeds/country_regions.csv, snapshots/snapshots.yml, exposures.yml, unit tests, custom generic test).
DB: scratchpad/mock1/dbt-course/practice/practice.duckdb (tools/build_practice_db.py). dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb 1.5.6.
RUN = reproduced with dbt in the scratch project; DOCS = docs.getdbt.com page (WebFetch, 2026-10-21). Detailed raw notes: scratchpad/mock1/notes.md

Q01 1.2  MC   D   RUN  compiled fct_orders starts `with __dbt__cte__int_payments__successful as (`; no relation in information_schema.
Q02 5.2  MS   B,D RUN  accepted_values (arguments: values: [...]) on payment_method PASS; relationships syntax as used in project; DOCS data tests.
Q03 1.1  FIB  shop/orders_raw RUN dbt compile -> select * from "practice"."jaffle_shop"."orders" (source name shop, table orders_raw, identifier orders).
Q04 7.1  MC   C   RUN  dbt ls -s state:modified+ --state prod-artifacts --resource-type model after editing stg_jaffle_shop__orders -> exactly the 6 models.
Q05 3.3  HS   9   RUN  exact YAML -> Parsing Error "Syntax error near line 9" / "did not find expected '-' indicator ... line 9, column 8"; fixed YAML PASSes.
Q06 1.6  BL   B,D,A,C RUN dbt ls --output json config.materialized with 4 levels set, removing one at a time: config() > yml > folder > root.
Q07 2.1  MC   A   RUN  extra column signup_date -> "enforced contract that failed ... missing in contract"; old table unchanged (9 cols, 100 rows).
Q08 1.12 DOMC Y,N,Y,N,Y RUN build --empty: `(select * ... where false limit 0)`, hard-coded model 300 rows, Binder Error still raised, tests PASS; E: DOCS reference/commands/build.
Q09 4.1  MC   C   RUN  dbt build with failing not_null email -> SKIP dim_customers, int_orders__enriched, customer_segments, fct_monthly_revenue; fct_orders OK.
Q10 6.2  MC   B   RUN  _loaded_at = now-15h, warn 12h/error 24h -> "WARN freshness of jaffle_shop.orders", sources.json status warn.
Q11 1.4  MAT  1C 2D 3E 4F 5A 6B RUN seed (INSERT 5), snapshot, show, docs generate (catalog.json+index.html), compile, build all executed.
Q12 1.11 MC   D   RUN  order 290 status change: append -> 2 rows; append+unique_key -> 2 rows; merge and delete+insert + unique_key -> 1 row.
Q13 5.1  MC   B   RUN  singular test executed (PASS); FAIL N = returned row count (not_null email FAIL 5 = 5 NULL emails).
Q14 3.1  MC   A   RUN  ref('stg_jaffle_shop_order_items') -> "depends on a node named 'stg_jaffle_shop_order_items' which was not found"; missing source msg checked.
Q15 1.9  MC   C   RUN+DOCS dbt ls config.grants -> {'select': ['finance_team']} (clobber), with '+select' -> both; DOCS resource-configs/grants. DuckDB: grants unsupported (warn only).
Q16 7.2  DOMC Y,N,Y,Y,N RUN retry after fix -> 7 nodes (1 error + 6 skipped); after success -> "Nothing to do..."; E: DOCS commands/retry (supported commands).
Q17 1.3  MS   A,C RUN+DOCS macro cents_to_dollars used; ref() to an analysis -> "depends on a node named 'payments_cte' which was not found"; rest = dbt best practice.
Q18 2.2  MC   B   RUN  exact YAML: ref('dim_customers') -> dim_customers_v1 (+ deprecation WARNING); without latest_version -> _v2.
Q19 1.10 HS   7   RUN  exact YAML (check + updated_at, no check_cols) -> "A snapshot configured with the check strategy must specify a check_cols configuration."
Q20 5.3  BL   B,E,C,D,A RUN dbt build -s +dim_customers log order; failing unit test -> SKIP dim_customers + its test; DOCS commands/build.
Q21 1.6  FIB  dbt_adnane_marts RUN +schema: marts -> model created in dbt_adnane_marts.
Q22 4.2  MC   D   RUN  dbt clone --state prod-artifacts on empty dev schema -> VIEW `SELECT * FROM practice.prod.fct_orders`.
Q23 1.8  MC   C   RUN  python model materialized view -> 'Materialization "materialization_view_default" only supports languages ['sql']; got "python"', PASS=5 ERROR=1.
Q24 6.1  HS   4   RUN  exact YAML -> "'report' is not one of ['dashboard', 'notebook', 'analysis', 'ml', 'application']".
Q25 1.14 DOMC N,Y,Y,N,N RUN microbatch model as printed: per-batch filter on upstream event_time; 2nd run 2 batches (lookback 1); Mar-Jun window -> 3 batches; week -> parse error.
Q26 3.2  MS   A,B RUN  dbt clean + compile -> no target/run; ephemeral compiled files exist; target/run/fct_orders.sql has create table.
Q27 1.5  BL   B,E,C,A,D DOCS best-practices/how-we-structure (staging only place for source(); staging -> intermediate -> marts); exposure downstream (RUN dbt ls).
Q28 7.1  MAT  1C 2E 3A 4B 5D RUN body (SQL edit), configs (+materialized in project yml), relation (alias), new (new file), contract (data_type change).
Q29 5.2  MC   A   RUN  1 orphan: severity error+warn_if>0+error_if>5 -> WARN; warn_if>5 only -> fail (!= 0); severity warn + error_if -> WARN.
Q30 1.7  MC   A   RUN  compile before deps -> "'dbt_utils' is undefined ... install package dependencies with "dbt deps""; after dbt deps OK.
Q31 2.3  FIB  check RUN DDL `lifetime_value double check (lifetime_value >= 0)`; violation -> "CHECK constraint failed"; Snowflake support from DOCS constraints.
Q32 1.13 MC   D   RUN  --sample="3 days" without event_time -> unfiltered; with event_time on stg orders -> filtered subquery; --sample=100 rejected.
Q33 4.1  MS   A,C RUN  same build (WARN relationships skips nothing, fct_orders OK); dbt run -> PASS=12; --fail-fast stops (SKIP=23).
Q34 3.5  MC   B   RUN  --warn-error turns warn test into failure ("configured to fail if != 0", ERROR=1).
Q35 1.10 MC   A   RUN  check_cols [email,country]: id 7 country change -> 2 rows; id 8 first_name change -> still 1 row (Karim).
Q36 5.1  MAT  1A 2B 3D 4C 5E RUN built-in, singular, custom generic (is_positive), unit test all executed; dbt_utils 1.4.1 installed (accepted_range: DOCS/package).
Q37 2.1  DOMC Y,N,N,Y,Y RUN reorder columns OK (YAML order kept), missing data_type error, view -> constraint warning; B: DOCS model-contracts.
Q38 1.4  MC   C   RUN  dropped fct_monthly_revenue, dbt show printed rows, table still absent afterwards.
Q39 7.1  MS   A,C RUN  empty dev + --defer --state -> fct_orders in dbt_adnane, refs to "practice"."prod".stg_*; no --state -> "--state or --defer-state are required".
Q40 1.11 FIB  this RUN compiled filter uses "practice"."dbt_adnane"."<model>"; self-ref() in is_incremental -> "unable to infer all dependencies".
Q41 3.2  HS   6   RUN  exact model -> Binder Error Referenced column "credit_card" not found; quoting '{{ pm }}' fixes it.
Q42 1.2  MAT  1D 2B 3E 4A 5C RUN view/table/ephemeral/incremental behaviour; materialized_view: DOCS build/materializations.
Q43 4.2  DOMC Y,Y,N,N,Y RUN no --state error, "Relation ... already exists" skip, view fallback; B,E: DOCS commands/clone.
Q44 6.2  FIB  loaded_at_field RUN freshness with loaded_at_field _loaded_at -> ERROR STALE / WARN as expected; only configured table checked.
Q45 1.5  MC   D   DOCS best-practices/how-we-structure/2-staging ("Staging models are the only place we'll use the source macro").
Q46 5.1  MC   C   RUN  exact unit test PASS (only expect columns compared, missing given columns OK); wrong expected value -> diff 30.0 vs 25.5.
Q47 3.4  BL   B,D,E,A,C Best practice (git feature-branch + PR + CI); consistent with Ch3 git workflow. Not runnable as a dbt behaviour.
Q48 2.2  MC   B   RUN  private + other group -> "Parsing Error ... private to the 'finance' group"; consumer without group -> same error; protected -> parse OK.
Q49 1.12 MC   A   RUN  compiled stg_jaffle_shop__orders under --empty: `from (select * from "practice"."jaffle_shop"."orders" where false limit 0)`.
Q50 7.2  MC   D   RUN  dbt retry without fix -> 1 ERROR + 6 SKIP again (PASS=0 ERROR=1 SKIP=6).
Q51 1.7  DOMC Y,N,Y,N,Y RUN dbt_packages/, package-lock.yml version 1.4.1, build fails before deps; E: DOCS build/packages (git + revision).
Q52 1.4  BL   D,B,C,E,A RUN dbt --debug run: manifest written -> "Writing injected SQL" -> "Writing runtime sql"/create table -> run_results.json.
Q53 3.1  MAT  1B 2E 3C 4D 5A RUN all five messages reproduced (profile, ref typo, cycle via dbt ls/run, Binder Error, unclosed if); categories DOCS guides/debug-errors.
Q54 5.2  DOMC Y,Y,Y,N,N RUN severity warn, where -> PASS, store_failures -> dbt_adnane_dbt_test__audit table, limit 2 -> FAIL 2, error_if ignored with warn.
Q55 1.14 MC   C   RUN  --event-time-start 2025-03-01 --event-time-end 2025-04-01 -> 1 batch (2025-03); start without end -> usage error.
Q56 2.1  HS   18  RUN  exact YAML (line 18 = `- name: country`): parse OK, run -> "Contracted models require data_type ... ['country']".
Q57 1.1  MS   A,B RUN  hard-coded model runs, absent from source:jaffle_shop.orders+ selection; B: DOCS sources (single place for location).
Q58 4.1  MC   B   RUN  stg_stripe__payments error in dbt run -> fct_order_items OK, 6 descendants SKIP.
Q59 6.1  DOMC Y,N,Y,Y,N RUN dbt ls +exposure (models + tests), dbt run -s exposure -> "Nothing to do", no owner -> required, maturity production invalid.
Q60 1.3  MC   D   RUN  compiled stg_stripe__payments -> `round(amount / 100, 2) as amount`.
Q61 7.1  FIB  state/manifest.json RUN --state prod-artifacts with prod manifest.json used for state:modified and defer.
Q62 5.3  MC   A   RUN  --exclude-resource-type unit_test and DBT_EXCLUDE_RESOURCE_TYPES=unit_test both skip the unit test.
Q63 3.3  MC   C   RUN  second entry for stg_stripe__payments in another yml -> "dbt found two schema.yml entries for the same resource ...".
Q64 2.3  MC   B   RUN  contract enforced false + violating check -> model built, no check in DDL; DOCS constraints (prerequisite: enforced contract).
Q65 5.1  MC   A   RUN  data_tests: [is_positive] PASS; [test_is_positive] -> "'test_test_is_positive' is undefined".
