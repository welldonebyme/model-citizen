# Data update scripts

These scripts change the RAW tables of the practice database (`jaffle_shop.*` and `stripe.*`)
to simulate new loads. They never touch the schemas created by dbt.

| Script | Used in | What it simulates |
|---|---|---|
| `day2.sql` | Chapter 13 (snapshots), Chapter 14 (incremental models, microbatch), later chapters | the next loading day (2 January 2026): changed rows + new rows |
| `fresh_load.sql` | Chapter 21 (source freshness) | 2 orders loaded "right now", so that `dbt source freshness` passes |

## How to run them

Copy the folder next to your database once, then run a script with the DuckDB CLI
(close every other DuckDB session first: DuckDB allows only one writer, and even a
`duckdb -readonly` session blocks dbt and these scripts):

```bash
cp -r ~/Documents/Adnane/dbt-bible/labs/updates ~/dbt-course/practice/
cd ~/dbt-course/practice
duckdb practice.duckdb < updates/day2.sql
duckdb practice.duckdb < updates/fresh_load.sql
```

Without the DuckDB CLI (same statements, run by the Python duckdb library):

```bash
python tools/build_practice_db.py ~/dbt-course/practice/practice.duckdb --sql labs/updates/day2.sql
```

Each script ends with a small check query (row counts, or the newest `_loaded_at`).

## Reset

To go back to the original data (day 1), re-run setup.sql. It recreates the 5 raw tables
(`create or replace table`) and does NOT drop the dbt schemas:

```bash
cd ~/dbt-course/practice
duckdb practice.duckdb < setup.sql
```

Warning: after a reset, do not run `dbt snapshot` (or a full `dbt build`) before you apply
day2.sql again, otherwise the snapshots record the reset as a change.

## day2.sql in detail (deterministic, safe to run twice)

Customers (5 rows changed, no new rows):

| id | change |
|---|---|
| 5 | country Morocco -> France |
| 12 | country Morocco -> Spain |
| 40 | country Spain -> Germany |
| 17 | email NULL -> `leo.fernandez17@example.com` |
| 11 | email `YOUSSEF.WILSON11@EXAMPLE.COM` -> `youssef.wilson11@example.com` (case fix only) |

Orders: 13 rows changed, each with a new `_loaded_at` on 2026-01-02 (07:00 to 08:00):
the 10 `placed` orders (288, 289, 290, 292, 295, 296, 297, 298, 299, 300) become `shipped`;
orders 255, 276, 291 go from `shipped` to `completed`.
20 new orders (ids 301-320), dated 2026-01-01 to 2026-01-04 (5 per day), `_loaded_at` the same day;
301-310 `completed`, 311-320 `shipped`. Customers 96 and 97 (who never ordered) place orders 301 and 306.

Order items: 32 new rows (ids 607-638) for the new orders.

Payments: 30 new successful payments (ids 342-371), amounts in cents equal to the total of the
order's items: 342-361 for the new orders (created on the order date), 362-371 for the 10 formerly
placed orders (created 2026-01-02).

### Counts before / after (verified)

| Table / measure | day 1 (setup.sql) | after day2.sql | after day2.sql + 1 x fresh_load.sql |
|---|---:|---:|---:|
| jaffle_shop.customers | 100 | 100 (5 changed) | 100 |
| jaffle_shop.orders | 300 | 320 (13 changed, 20 new) | 322 |
| jaffle_shop.order_items | 606 | 638 | 640 |
| jaffle_shop.products | 12 | 12 | 12 |
| stripe.payments | 341 | 371 | 373 |
| successful payments | 317 | 347 | 349 |
| total successful amount (cents) | 500440 | 544320 | 545140 (*) |
| max(orders._loaded_at) | 2025-12-31 16:22 | 2026-01-04 16:13 | the current UTC time |
| orders by status | completed 239, shipped 21, returned 18, return_pending 12, placed 10 | completed 252, shipped 38, returned 18, return_pending 12, placed 0 | + 2 completed |
| customers with NULL email / upper-case email | 5 / 9 | 4 / 8 | 4 / 8 |
| customers without orders | 11 | 9 | 9 |
| orphan orders (user_id without customer) | 1 (order 159) | 1 | 1 |

(*) fresh_load.sql adds 380 + 440 cents (1 Cappuccino for customer 1, 2 Croissants for customer 2).

Effect on the dbt project (reference run, logs of Chapters 13 and 14):
`customers_snapshot` 100 -> 105 rows (5 closed versions), `orders_snapshot` 300 -> 333 rows
(13 closed versions, 20 new orders), incremental `fct_orders` 300 -> 320 rows (33 rows processed:
13 updated + 20 inserted), `fct_monthly_revenue` 65 -> 71 rows.

## fresh_load.sql in detail (NOT idempotent)

Adds 2 orders (ids = current max + 1 and + 2), one item each, one successful payment each,
with `_loaded_at` = the current time in UTC (`current_timestamp at time zone 'UTC'`).
`_loaded_at` has no time zone; dbt treats such values as UTC when it computes freshness,
so storing the UTC time keeps the freshness age correct whatever the computer's time zone.
Every run adds 2 more orders.
