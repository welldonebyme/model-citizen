# Chapter 4 parity — chromium

DuckDB v2.0.0-dev88614 (d54cbbe3df), bundle `base`, @duckdb/duckdb-wasm 1.33.1-dev110.0
User agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Safari/537.36
**69/69 match**, total 1249 ms

| Example | Result | Differences (error) | Notes (warning / annotation) |
|---|---|---|---|
| `ch04-sql-a:88` | match |  |  |
| `ch04-sql-a:108` | match |  |  |
| `ch04-sql-a:159` | match |  |  |
| `ch04-sql-a:190` | match |  |  |
| `ch04-sql-a:221` | match |  |  |
| `ch04-sql-a:253` | match |  |  |
| `ch04-sql-a:277` | match |  |  |
| `ch04-sql-a:300` | match |  |  |
| `ch04-sql-a:335` | match |  |  |
| `ch04-sql-a:442` | match |  |  |
| `ch04-sql-a:505` | match |  |  |
| `ch04-sql-a:538` | match |  |  |
| `ch04-sql-a:582` | match |  |  |
| `ch04-sql-a:612` | match |  |  |
| `ch04-sql-a:648` | match |  |  |
| `ch04-sql-a:700` | match |  |  |
| `ch04-sql-a:744` | match |  |  |
| `ch04-sql-a:784` | match |  |  |
| `ch04-sql-a:815` | match |  |  |
| `ch04-sql-a:846` | match |  |  |
| `ch04-sql-a:872` | match |  |  |
| `ch04-sql-a:913` | match |  |  |
| `ch04-sql-a:944` | match |  |  |
| `ch04-sql-a:994` | match |  |  |
| `ch04-sql-a:1020` | match |  |  |
| `ch04-sql-a:1051` | match |  | DuckDB adds: "Either add it to the GROUP BY list, or use ANY_VALUE("user_id") if the exact value of "user_id" is not important. LINE 1: select status, user_id, count(*) ^^^^^^^" |
| `ch04-sql-a:1067` | match |  |  |
| `ch04-sql-a:1093` | match |  |  |
| `ch04-sql-a:1167` | match |  |  |
| `ch04-sql-a:1224` | match |  |  |
| `ch04-sql-a:1337` | match |  |  |
| `ch04-sql-a:1383` | match |  |  |
| `ch04-sql-a:1412` | match |  |  |
| `ch04-sql-a:1440` | match |  |  |
| `ch04-sql-a:1472` | match |  |  |
| `ch04-sql-a:1544` | match |  |  |
| `ch04-sql-a:1584` | match |  |  |
| `ch04-sql-b:33` | match |  |  |
| `ch04-sql-b:51` | match |  |  |
| `ch04-sql-b:85` | match |  | DuckDB adds: "Use "SET scalar_subquery_error_on_multiple_rows=false" to revert to previous behavior of returning a random row." |
| `ch04-sql-b:102` | match |  |  |
| `ch04-sql-b:132` | match |  |  |
| `ch04-sql-b:147` | match |  |  |
| `ch04-sql-b:172` | match |  |  |
| `ch04-sql-b:219` | match |  |  |
| `ch04-sql-b:252` | match |  |  |
| `ch04-sql-b:310` | match |  |  |
| `ch04-sql-b:520` | match |  |  |
| `ch04-sql-b:578` | match |  |  |
| `ch04-sql-b:632` | match |  |  |
| `ch04-sql-b:670` | match |  |  |
| `ch04-sql-b:708` | match |  |  |
| `ch04-sql-b:765` | match |  |  |
| `ch04-sql-b:802` | match |  |  |
| `ch04-sql-b:851` | match |  | DuckDB adds: "LINE 3: where row_number() over (partition by user_id order by order_date... ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^" |
| `ch04-sql-b:863` | match |  |  |
| `ch04-sql-b:1055` | match |  |  |
| `ch04-sql-b:1095` | match |  |  |
| `ch04-sql-b:1123` | match |  |  |
| `ch04-sql-b:1171` | match |  |  |
| `ch04-sql-b:1258` | match |  |  |
| `ch04-sql-b:1288` | match |  |  |
| `ch04-sql-b:1471` | match |  |  |
| `ch04-sql-b:1598` | match |  | placeholders replaced by ch04-sql-b:1471 (legacy) and ch04-sql-b:1529 (refactored), without order by |
| `ch04-sql-b:1598#except` | match |  | derived from the book note "both EXCEPT queries return 0 rows" |
| `ch04-sql-b:1676` | match |  | output printed after a sentence; first 10 rows only, name columns hidden (columnSubset + rowPrefix) |
| `ch04-sql-b:1780` | match |  | placeholder "( ... the query above ... )" replaced by ch04-sql-b:1676 without its order by |
| `ch04-sql-b:1811` | match |  |  |
| `ch04-sql-b:1836` | match |  |  |

## day2.sql

| Check | Expected (README) | Actual | |
|---|---|---|---|
| customers | 100 | 100 | OK |
| orders | 320 | 320 | OK |
| order_items | 638 | 638 | OK |
| products | 12 | 12 | OK |
| payments | 371 | 371 | OK |
| successful payments | 347 | 347 | OK |
| successful amount | 544320 | 544320 | OK |
| max orders._loaded_at | 2026-01-04 16:13:00 | 2026-01-04 16:13:00 | OK |
| orders by status | completed 252, shipped 38, returned 18, return_pending 12 | completed 252, shipped 38, returned 18, return_pending 12 | OK |
| null / upper emails | 4 / 8 | 4 / 8 | OK |
| customers without orders | 9 | 9 | OK |
| orphan orders | 1 | 1 | OK |
| idempotent (second run changes nothing) | same | same | OK |
