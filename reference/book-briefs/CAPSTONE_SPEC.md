# Capstone "ShopFlow" — spec (Part VIII, Chapter 26)

Purpose: after Part VII, the student builds a NEW, larger dbt project alone, using every exam objective at least once,
with milestone checkpoints they can verify, and a full reference solution to compare with.

## Deliverables
1. Data generator `/Users/mac/Documents/Adnane/dbt-bible/tools/generate_capstone.py` (fixed seed, deterministic) writing
   `/Users/mac/Documents/Adnane/dbt-bible/labs/capstone/data/*.csv`, plus `labs/capstone/setup.sql` (creates `shopflow.duckdb`
   raw schemas) and `labs/capstone/updates/day2.sql` (+ any other update scripts), and `labs/capstone/README.md`.
2. Reference solution: `/Users/mac/Documents/Adnane/dbt-bible/labs/capstone/shopflow_dbt` — a git repo with one commit + annotated tag
   per milestone (`m00` … `m14`), local git config only (author "Adnane <adnane@example.com>"), `profiles.example.yml`, README.
   It must build cleanly at every tag with dbt-core 1.11 + dbt-duckdb (venv in STYLE.md), except where a milestone deliberately
   shows a failing test that the student must handle.
3. The chapter `/Users/mac/Documents/Adnane/dbt-bible/parts/part8/ch26-capstone.tex` (replace stub; keep \chapter{Capstone Project: ShopFlow}\label{ch:capstone}),
   about 40-60 pages.

## Raw data (schemas in shopflow.duckdb) — realistic and a bit messy on purpose
- `shopflow_app`: customers (with created_at, updated_at), addresses, products (sku, category, price, currency EUR/USD/MAD),
  orders (status lifecycle, updated_at), order_items.
- `payments_provider`: payments (amount in cents, currency, status), refunds.
- `web_analytics`: events (event_id, session_id, customer_id nullable, event_type, event_timestamp, page; ~20-50k rows;
  some DUPLICATE event_ids from the tracker; late-arriving events) → microbatch / incremental.
- `shipping`: shipments (status changes over time, updated_at) → snapshot.
- Messy traps: duplicates, NULLs, mixed-case emails, currency mix (seed with exchange rates), an orphan foreign key, a negative amount,
  timestamps as strings in one table. Each trap is discovered through a test or a milestone question.
- day2.sql: new + updated rows for snapshots/incremental/freshness exercises.

## Milestones (one \section each in the chapter; tag m00..m14 in the solution)
m00 Setup: new git repo + GitHub, venv reuse, profile `shopflow` (dev/prod targets), dbt init, first commit, branch protection idea.
m01 Sources: sources.yml for 4 raw schemas, source freshness config, first `dbt source freshness`.
m02 Staging: one stg model per raw table; renaming, casting, cents→currency units, dedupe events (row_number/qualify), lower emails.
m03 Seeds: exchange_rates, country_regions; column_types.
m04 Intermediate & marts: int models; fct_orders, fct_order_items, dim_customers, dim_products, fct_sessions; folder materializations.
m05 Jinja/macros/packages: dbt_utils (surrogate keys, date_spine...), currency conversion macro, generate_schema_name, a run-operation.
m06 Data tests: generic (arguments syntax), relationships (orphan!), accepted_values, singular, custom generic, package tests, configs
    (severity, where, store_failures), source tests.
m07 Unit tests: at least 3 (business logic, currency conversion, incremental logic with is_incremental override).
m08 Snapshots (YAML): products price history (timestamp), shipments status (check); apply day2 and re-snapshot.
m09 Incremental: fct_orders (merge/delete+insert, unique_key) and fct_events microbatch (event_time, batch_size, lookback, backfill).
m10 Python model: e.g. RFM customer segmentation.
m11 Governance: groups, access, contracts + constraints on public marts, versions (v1→v2 with deprecation_date).
m12 Docs & exposures: descriptions, doc blocks, exposures for 2 dashboards; docs generate.
m13 State & CI: prod build + artifacts, state:modified+, --defer, dbt clone, dbt retry drill, selectors.yml, GitHub Actions CI file,
    PR template, --empty in CI.
m14 Release: final checklist; self-assessment rubric mapping every exam objective (1.1-7.2) to where the student used it in ShopFlow.

## Chapter structure
- Intro: the business story (ShopFlow), raw data dictionary table, target DAG figure (TikZ), how to use milestones and tags.
- Each milestone section: Goal; \labtag objectives; Requirements (checklist); Hints (no full code); Checkpoint (EXACT expected results
  from the solution: row counts, test PASS/WARN/FAIL counts, sample rows) ; "Compare with the solution: git checkout mNN" ;
  a few "Exam link" notes (trapbox/dbtbox) connecting to exam objectives.
- End: rubric table (objective → milestone(s)), "if you are stuck" guide, summary box.
- Every checkpoint number must come from actually running the solution at that tag.
