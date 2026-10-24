# SQL parity, chromium

DuckDB v1.5.4, 70/70 checks match, 2190 ms

| Chapter | blocks with a result | checked | matched | skipped |
|---|---:|---:|---:|---:|
| ch04 | 68 | 69 | 69 | 0 |
| ch09 | 1 | 0 | 0 | 1 |
| ch13 | 5 | 0 | 0 | 5 |
| ch15 | 1 | 0 | 0 | 1 |
| ch18 | 1 | 1 | 1 | 0 |

| Example | Result | Notes |
|---|---|---|
| ch04-c3 | match | 5 rows, same columns and values, same order. |
| ch04-c5 | match | 5 rows, same columns and values. |
| ch04-c7 | match | 3 rows, same columns and values. |
| ch04-c9 | match | 5 rows, same columns and values. |
| ch04-c11 | match | 3 rows, same columns and values. |
| ch04-c13 | match | 5 rows, same columns and values. |
| ch04-c15 | match | 1 row, same columns and values. |
| ch04-c17 | match | 1 row, same columns and values. |
| ch04-c19 | match | 18 rows (the book prints 5 of them), same columns and values. |
| ch04-c25 | match | 7 rows, same columns and values. |
| ch04-c27 | match | 1 row, same columns and values. |
| ch04-c29 | match | 5 rows, same columns and values. |
| ch04-c32 | match | 3 rows, same columns and values. |
| ch04-c34 | match | 1 row, same columns and values. |
| ch04-c36 | match | 5 rows, same columns and values, same order. |
| ch04-c38 | match | 5 rows, same columns and values, same order. |
| ch04-c41 | match | 3 rows, same columns and values. |
| ch04-c43 | match | 3 rows, same columns and values. |
| ch04-c45 | match | 3 rows, same columns and values. |
| ch04-c47 | match | 3 rows, same columns and values. |
| ch04-c49 | match | 5 rows, same columns and values, same order. |
| ch04-c51 | match | 4 rows, same columns and values, same order. |
| ch04-c53 | match | 1 row, same columns and values. |
| ch04-c55 | match | 1 row, same columns and values. |
| ch04-c57 | match | 4 rows, same columns and values, same order. |
| ch04-c59 | match | Same error as the book: Binder Error.<br>warning: DuckDB adds: "Either add it to the GROUP BY list, or use "ANY_VALUE(user_id)" if the exact value of "user_id" is not important. LINE 1: select status, user_id, count(*) ^" |
| ch04-c61 | match | 4 rows, same columns and values, same order. |
| ch04-c63 | match | 6 rows, same columns and values, same order. |
| ch04-c65 | match | 1 row, same columns and values. |
| ch04-c67 | match | 5 rows, same columns and values, same order. |
| ch04-c69 | match | 4 rows, same columns and values, same order. |
| ch04-c72 | match | 11 rows, same columns and values, same order. |
| ch04-c74 | match | 1 row, same columns and values. |
| ch04-c76 | match | 4 rows, same columns and values, same order. |
| ch04-c78 | match | 1 row, same columns and values. |
| ch04-c81 | match | 5 rows, same columns and values, same order. |
| ch04-c83 | match | 6 rows, same columns and values, same order. |
| ch04-c87 | match | 1 row, same columns and values. |
| ch04-c89 | match | 5 rows, same columns and values, same order. |
| ch04-c91 | match | Same error as the book: Invalid Input Error.<br>warning: DuckDB adds: "Use "SET scalar_subquery_error_on_multiple_rows=false" to revert to previous behavior of returning a random row." |
| ch04-c93 | match | 11 rows, same columns and values, same order. |
| ch04-c95 | match | 1 row, same columns and values. |
| ch04-c97 | match | 1 row, same columns and values. |
| ch04-c99 | match | 5 rows, same columns and values, same order. |
| ch04-c102 | match | 5 rows, same columns and values, same order. |
| ch04-c104 | match | 3 rows, same columns and values, same order. |
| ch04-c107 | match | 7 rows, same columns and values, same order. |
| ch04-c111 | match | 6 rows, same columns and values, same order. |
| ch04-c114 | match | 8 rows, same columns and values, same order. |
| ch04-c116 | match | 4 rows, same columns and values, same order. |
| ch04-c118 | match | 7 rows, same columns and values, same order. |
| ch04-c120 | match | 12 rows, same columns and values, same order. |
| ch04-c122 | match | 9 rows, same columns and values, same order. |
| ch04-c124 | match | 12 rows, same columns and values, same order. |
| ch04-c126 | match | Same error as the book: Binder Error.<br>warning: DuckDB adds: "LINE 3: where row_number() over (partition by user_id order by order_date... ^" |
| ch04-c128 | match | 5 rows, same columns and values, same order. |
| ch04-c132 | match | 1 row, same columns and values. |
| ch04-c135 | match | 3 rows, same columns and values, same order. |
| ch04-c137 | match | 3 rows, same columns and values, same order. |
| ch04-c141 | match | 4 rows, same columns and values, same order. |
| ch04-c144 | match | 1 row, same columns and values. |
| ch04-c146 | match | 7 rows, same columns and values, same order. |
| ch04-c150 | match | 6 rows, same columns and values, same order. |
| ch04-c153 | match | 1 row, same columns and values.<br>The book writes the two views with placeholders ("SELECT ... ;" for the legacy query, "with ... ;" for the refactored one): the workspace puts the two queries of the lab there (without their ORDER BY). |
| ch04-c153#except | match | 1 row, same columns and values.<br>Derived check of the note under the result ("both EXCEPT queries return 0 rows"): both counts must be 0. |
| ch04-c155 | match | The first 10 rows, same columns and values, same order.<br>The book prints this result after a sentence, shows the first 10 rows only and hides the name columns: compared on the columns and rows it shows. |
| ch04-c157 | match | 1 row, same columns and values.<br>The book writes "( ... the query above, without the order by ... )": the workspace puts the query of the previous step there (without its ORDER BY). |
| ch04-c159 | match | 1 row, same columns and values. |
| ch04-c161 | match | 1 row, same columns and values. |
| ch18-c8 | match | 2 rows (book: 2)<br>The book shows the dbt log "FAIL 2": a failing test is a query that returns rows, so the check is "this query returns 2 rows". The model stg_jaffle_shop__orders is compiled from the reference project (same file at tags ch11 and ch18) and created as a view in the browser. |

## Skipped

- ch09-c2 (dbt-log): a model file whose only line is a ref() in a comment; the Result is the dbt error "Found a cycle", not a query result
- ch13-c11 (snapshot): the Result is the snapshot row of order 301 after `dbt snapshot` (dbt_valid_from / dbt_valid_to are written by dbt)
- ch13-c36 (snapshot): queries dbt snapshot tables: dbt_valid_from is the time of each `dbt snapshot` run on the learner's machine
- ch13-c38 (snapshot): queries dbt snapshot tables: dbt_valid_from is the time of each `dbt snapshot` run on the learner's machine
- ch13-c40 (snapshot): queries dbt snapshot tables: dbt_valid_from is the time of each `dbt snapshot` run on the learner's machine
- ch13-c42 (snapshot): queries dbt snapshot tables: dbt_valid_from is the time of each `dbt snapshot` run on the learner's machine
- ch15-c31 (dbt-models): reads information_schema for dim_customers and customer_segments, two models built by dbt (customer_segments is the Python model of Chapter 15)

## day2.sql

- OK day 1: customers: 100 (expected 100)
- OK day 1: orders: 300 (expected 300)
- OK day 1: order_items: 606 (expected 606)
- OK day 1: products: 12 (expected 12)
- OK day 1: payments: 341 (expected 341)
- OK day 1: successful payments: 317 (expected 317)
- OK day 1: successful amount: 500440 (expected 500440)
- OK day 1: max orders._loaded_at: 2025-12-31 16:22:00 (expected 2025-12-31 16:22:00)
- OK day 1: orders by status: completed 239, shipped 21, returned 18, return_pending 12, placed 10 (expected completed 239, shipped 21, returned 18, return_pending 12, placed 10)
- OK day 1: null / upper emails: 5 / 9 (expected 5 / 9)
- OK day 1: customers without orders: 11 (expected 11)
- OK day 1: orphan orders: 1 (expected 1)
- OK day 2: customers: 100 (expected 100)
- OK day 2: orders: 320 (expected 320)
- OK day 2: order_items: 638 (expected 638)
- OK day 2: products: 12 (expected 12)
- OK day 2: payments: 371 (expected 371)
- OK day 2: successful payments: 347 (expected 347)
- OK day 2: successful amount: 544320 (expected 544320)
- OK day 2: max orders._loaded_at: 2026-01-04 16:13:00 (expected 2026-01-04 16:13:00)
- OK day 2: orders by status: completed 252, shipped 38, returned 18, return_pending 12 (expected completed 252, shipped 38, returned 18, return_pending 12)
- OK day 2: null / upper emails: 4 / 8 (expected 4 / 8)
- OK day 2: customers without orders: 9 (expected 9)
- OK day 2: orphan orders: 1 (expected 1)
- OK day2.sql twice changes nothing: same (expected same)
- OK reset brings day 1 back: same (expected same)
