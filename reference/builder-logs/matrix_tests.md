# Support-matrix experiments (throwaway project, not part of the reference repo)

Reference-project build log. Every block below is a command that was really run, followed by its
complete, unedited output (dbt was run with `DBT_USE_COLORS=false`, so there are no ANSI colours).

Path mapping used in this file (the raw, unmapped output is in `logs/raw/matrix_tests.log`):
- builder HOME `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/home` is shown as `/Users/adnane` (so `~/dbt-course/jaffle_dbt` = `/Users/adnane/dbt-course/jaffle_dbt`)
- builder venv `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/v156/.venv` is shown as `/Users/adnane/dbt-course/.venv`
- `/Users/mac/Documents/Adnane/dbt-bible` is shown as `/Users/adnane/Documents/Adnane/dbt-bible`

Environment: macOS, zsh, dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb (Python) 1.5.6, Python 3.12.
Commands are run from `~/dbt-course/jaffle_dbt` unless a `cd` is shown.

Throwaway copy of the final project (`.../throwaway/matrix/jaffle_dbt`) with extra models in `models/matrix/`, on a copy of
the dev database. Used by logs/duckdb_support.md.

### models/matrix/_matrix.yml

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ cat models/matrix/_matrix.yml
```
```text
version: 2

models:
  - name: mx_parent
    config:
      contract: {enforced: true}
    columns:
      - name: id
        data_type: integer
        constraints:
          - type: primary_key
      - name: label
        data_type: varchar

  - name: mx_child_fk
    config:
      contract: {enforced: true}
    columns:
      - name: child_id
        data_type: integer
      - name: parent_id
        data_type: integer
        constraints:
          - type: foreign_key
            to: ref('mx_parent')
            to_columns: [id]

  - name: mx_child_fk_bad
    config:
      contract: {enforced: true}
    columns:
      - name: child_id
        data_type: integer
      - name: parent_id
        data_type: integer
        constraints:
          - type: foreign_key
            to: ref('mx_parent')
            to_columns: [id]

  - name: mx_parent_nopk
    columns:
      - name: id

  - name: mx_child_fk_nopk
    config:
      contract: {enforced: true}
    columns:
      - name: child_id
        data_type: integer
      - name: parent_id
        data_type: integer
        constraints:
          - type: foreign_key
            to: ref('mx_parent_nopk')
            to_columns: [id]

  - name: mx_view_contract
    config:
      contract: {enforced: true}
    columns:
      - name: id
        data_type: integer
        constraints:
          - type: not_null
          - type: check
            expression: "id > 0"

  - name: mx_ephemeral_contract
    config:
      contract: {enforced: true}
    columns:
      - name: id
        data_type: integer

  - name: mx_incremental_contract
    config:
      contract: {enforced: true}
    columns:
      - name: id
        data_type: integer
        constraints:
          - type: not_null
      - name: label
        data_type: varchar

  - name: mx_view_docs
    description: A view with persist_docs.
    columns:
      - name: id
        description: The id column.
```

### Contract on an INCREMENTAL model with the default on_schema_change (ignore): the whole project fails to parse (traceback lines removed)

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ cat models/matrix/mx_incremental_contract.sql && dbt parse --no-partial-parse 2>&1 | grep -v '^  File\|^    \|^Traceback\|^\s*\^'
```
```text
{{ config(materialized='incremental', unique_key='id') }}
select 1 as id, 'x' as label
21:47:29  Running with dbt=1.11.16
21:47:29  Registered adapter: duckdb=1.11.0
21:47:30  [WARNING]: Constraint types are not supported for view materializations and will
be ignored.  Set 'warn_unsupported: false' on this constraint to ignore this
warning.
21:47:30  Encountered an error:
Invalid value for on_schema_change: ignore. Models materialized as incremental with contracts enabled must set on_schema_change to 'append_new_columns' or 'fail'
21:47:30  Traceback (most recent call last):
dbt_common.dataclass_schema.ValidationError: Invalid value for on_schema_change: ignore. Models materialized as incremental with contracts enabled must set on_schema_change to 'append_new_columns' or 'fail'
```

### Same model with on_schema_change='append_new_columns': runs (twice, second run incremental)

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ head -1 models/matrix/mx_incremental_contract.sql && dbt run --select mx_incremental_contract && dbt run --select mx_incremental_contract
```
```text
{{ config(materialized='incremental', unique_key='id', on_schema_change='append_new_columns') }}
21:47:32  Running with dbt=1.11.16
21:47:32  Registered adapter: duckdb=1.11.0
21:47:32  Unable to do partial parsing because saved manifest not found. Starting full parse.
21:47:34  [WARNING]: Constraint types are not supported for view materializations and will
be ignored.  Set 'warn_unsupported: false' on this constraint to ignore this
warning.
21:47:34  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:34  
21:47:34  Concurrency: 4 threads (target='dev')
21:47:34  
21:47:34  1 of 1 START sql incremental model dbt_adnane.mx_incremental_contract .......... [RUN]
21:47:34  1 of 1 OK created sql incremental model dbt_adnane.mx_incremental_contract ..... [OK in 0.08s]
21:47:34  
21:47:34  Finished running 1 incremental model in 0 hours 0 minutes and 0.22 seconds (0.22s).
21:47:34  
21:47:34  Completed successfully
21:47:34  
21:47:34  Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
21:47:36  Running with dbt=1.11.16
21:47:36  Registered adapter: duckdb=1.11.0
21:47:37  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:37  
21:47:37  Concurrency: 4 threads (target='dev')
21:47:37  
21:47:37  1 of 1 START sql incremental model dbt_adnane.mx_incremental_contract .......... [RUN]
21:47:37  1 of 1 OK created sql incremental model dbt_adnane.mx_incremental_contract ..... [OK in 0.10s]
21:47:37  
21:47:37  Finished running 1 incremental model in 0 hours 0 minutes and 0.22 seconds (0.22s).
21:47:37  
21:47:37  Completed successfully
21:47:37  
21:47:37  Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
```

### Foreign key constraint to a parent that has a primary key

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run --select mx_parent mx_child_fk
```
```text
21:47:39  Running with dbt=1.11.16
21:47:39  Registered adapter: duckdb=1.11.0
21:47:39  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:39  
21:47:39  Concurrency: 4 threads (target='dev')
21:47:39  
21:47:40  1 of 2 START sql table model dbt_adnane.mx_parent .............................. [RUN]
21:47:40  1 of 2 OK created sql table model dbt_adnane.mx_parent ......................... [OK in 0.08s]
21:47:40  2 of 2 START sql table model dbt_adnane.mx_child_fk ............................ [RUN]
21:47:40  2 of 2 OK created sql table model dbt_adnane.mx_child_fk ....................... [OK in 0.02s]
21:47:40  
21:47:40  Finished running 2 table models in 0 hours 0 minutes and 0.21 seconds (0.21s).
21:47:40  
21:47:40  Completed successfully
21:47:40  
21:47:40  Done. PASS=2 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=2
```

### The FK DDL and the constraint in DuckDB

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ grep -n -i 'references' target/run/jaffle_dbt/models/matrix/mx_child_fk.sql; python -I /Users/adnane/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "select table_name, constraint_type, constraint_text from duckdb_constraints() where table_name in ('mx_parent', 'mx_child_fk') order by 1, 2"
```
```text
11:    parent_id integer references "dbt_adnane"."mx_parent" (id)
+-------------+-----------------+-------------------------------------------------------------+
| table_name  | constraint_type | constraint_text                                             |
+-------------+-----------------+-------------------------------------------------------------+
| mx_child_fk | FOREIGN KEY     | FOREIGN KEY (parent_id) REFERENCES dbt_adnane.mx_parent(id) |
| mx_parent   | NOT NULL        | NOT NULL                                                    |
| mx_parent   | PRIMARY KEY     | PRIMARY KEY(id)                                             |
+-------------+-----------------+-------------------------------------------------------------+
(3 rows)
```

### FK violated (parent_id 3 does not exist in mx_parent)

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run --select mx_child_fk_bad
```
```text
21:47:42  Running with dbt=1.11.16
21:47:42  Registered adapter: duckdb=1.11.0
21:47:42  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:42  
21:47:42  Concurrency: 4 threads (target='dev')
21:47:42  
21:47:42  1 of 1 START sql table model dbt_adnane.mx_child_fk_bad ........................ [RUN]
21:47:43  1 of 1 ERROR creating sql table model dbt_adnane.mx_child_fk_bad ............... [ERROR in 0.07s]
21:47:43  
21:47:43  Finished running 1 table model in 0 hours 0 minutes and 0.20 seconds (0.20s).
21:47:43  
21:47:43  Completed with 1 error, 0 partial successes, and 0 warnings:
21:47:43  
21:47:43  Failure in model mx_child_fk_bad (models/matrix/mx_child_fk_bad.sql)
21:47:43    Runtime Error in model mx_child_fk_bad (models/matrix/mx_child_fk_bad.sql)
  Constraint Error: Violates foreign key constraint because key "id: 3" does not exist in the referenced table
21:47:43  
21:47:43    compiled code at target/compiled/jaffle_dbt/models/matrix/mx_child_fk_bad.sql
21:47:43  
21:47:43  Done. PASS=0 WARN=0 ERROR=1 SKIP=0 NO-OP=0 TOTAL=1
```
(exit code 1)

### FK to a parent WITHOUT a primary key / unique constraint

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run --select mx_parent_nopk mx_child_fk_nopk
```
```text
21:47:45  Running with dbt=1.11.16
21:47:45  Registered adapter: duckdb=1.11.0
21:47:45  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:45  
21:47:45  Concurrency: 4 threads (target='dev')
21:47:45  
21:47:45  1 of 2 START sql table model dbt_adnane.mx_parent_nopk ......................... [RUN]
21:47:46  1 of 2 OK created sql table model dbt_adnane.mx_parent_nopk .................... [OK in 0.06s]
21:47:46  2 of 2 START sql table model dbt_adnane.mx_child_fk_nopk ....................... [RUN]
21:47:46  2 of 2 ERROR creating sql table model dbt_adnane.mx_child_fk_nopk .............. [ERROR in 0.04s]
21:47:46  
21:47:46  Finished running 2 table models in 0 hours 0 minutes and 0.22 seconds (0.22s).
21:47:46  
21:47:46  Completed with 1 error, 0 partial successes, and 0 warnings:
21:47:46  
21:47:46  Failure in model mx_child_fk_nopk (models/matrix/mx_child_fk_nopk.sql)
21:47:46    Runtime Error in model mx_child_fk_nopk (models/matrix/mx_child_fk_nopk.sql)
  Binder Error: Failed to create foreign key: there is no primary key or unique constraint for referenced table "mx_parent_nopk"
21:47:46  
21:47:46    compiled code at target/compiled/jaffle_dbt/models/matrix/mx_child_fk_nopk.sql
21:47:46  
21:47:46  Done. PASS=1 WARN=0 ERROR=1 SKIP=0 NO-OP=0 TOTAL=2
```
(exit code 1)

### Rebuild the PARENT while a child table has an FK to it

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run --select mx_parent
```
```text
21:47:48  Running with dbt=1.11.16
21:47:48  Registered adapter: duckdb=1.11.0
21:47:48  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:48  
21:47:48  Concurrency: 4 threads (target='dev')
21:47:48  
21:47:48  1 of 1 START sql table model dbt_adnane.mx_parent .............................. [RUN]
21:47:48  1 of 1 ERROR creating sql table model dbt_adnane.mx_parent ..................... [ERROR in 0.08s]
21:47:48  
21:47:48  Finished running 1 table model in 0 hours 0 minutes and 0.20 seconds (0.20s).
21:47:49  
21:47:49  Completed with 1 error, 0 partial successes, and 0 warnings:
21:47:49  
21:47:49  Failure in model mx_parent (models/matrix/mx_parent.sql)
21:47:49    Runtime Error in model mx_parent (models/matrix/mx_parent.sql)
  Dependency Error: Cannot alter entry "mx_parent" because there are entries that depend on it.
21:47:49  
21:47:49    compiled code at target/compiled/jaffle_dbt/models/matrix/mx_parent.sql
21:47:49  
21:47:49  Done. PASS=0 WARN=0 ERROR=1 SKIP=0 NO-OP=0 TOTAL=1
```
(exit code 1)

### Contract with constraints (not_null, check) on a VIEW

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run --select mx_view_contract && python -I /Users/adnane/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "select count(*) as constraints_on_view from duckdb_constraints() where table_name = 'mx_view_contract'"
```
```text
21:47:51  Running with dbt=1.11.16
21:47:51  Registered adapter: duckdb=1.11.0
21:47:51  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:51  
21:47:51  Concurrency: 4 threads (target='dev')
21:47:51  
21:47:51  1 of 1 START sql view model dbt_adnane.mx_view_contract ........................ [RUN]
21:47:51  1 of 1 OK created sql view model dbt_adnane.mx_view_contract ................... [OK in 0.06s]
21:47:51  
21:47:51  Finished running 1 view model in 0 hours 0 minutes and 0.17 seconds (0.17s).
21:47:51  
21:47:51  Completed successfully
21:47:51  
21:47:51  Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
+---------------------+
| constraints_on_view |
+---------------------+
|                   0 |
+---------------------+
(1 row)
```

### Contract on an EPHEMERAL model

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run --select mx_uses_ephemeral
```
```text
21:47:53  Running with dbt=1.11.16
21:47:53  Registered adapter: duckdb=1.11.0
21:47:54  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:54  
21:47:54  Concurrency: 4 threads (target='dev')
21:47:54  
21:47:54  1 of 1 START sql view model dbt_adnane.mx_uses_ephemeral ....................... [RUN]
21:47:54  1 of 1 OK created sql view model dbt_adnane.mx_uses_ephemeral .................. [OK in 0.04s]
21:47:54  
21:47:54  Finished running 1 view model in 0 hours 0 minutes and 0.16 seconds (0.16s).
21:47:54  
21:47:54  Completed successfully
21:47:54  
21:47:54  Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
```

### INCREMENTAL Python model (run twice)

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run --select mx_python_incremental && dbt run --select mx_python_incremental && python -I /Users/adnane/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "select * from dbt_adnane.mx_python_incremental order by id"
```
```text
21:47:56  Running with dbt=1.11.16
21:47:56  Registered adapter: duckdb=1.11.0
21:47:57  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:47:57  
21:47:57  Concurrency: 4 threads (target='dev')
21:47:57  
21:47:57  1 of 1 START python incremental model dbt_adnane.mx_python_incremental ......... [RUN]
21:47:57  1 of 1 OK created python incremental model dbt_adnane.mx_python_incremental .... [OK in 0.39s]
21:47:57  
21:47:57  Finished running 1 incremental model in 0 hours 0 minutes and 0.51 seconds (0.51s).
21:47:57  
21:47:57  Completed successfully
21:47:57  
21:47:57  Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
21:47:59  Running with dbt=1.11.16
21:47:59  Registered adapter: duckdb=1.11.0
21:48:00  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:48:00  
21:48:00  Concurrency: 4 threads (target='dev')
21:48:00  
21:48:00  1 of 1 START python incremental model dbt_adnane.mx_python_incremental ......... [RUN]
21:48:00  1 of 1 OK created python incremental model dbt_adnane.mx_python_incremental .... [OK in 0.28s]
21:48:00  
21:48:00  Finished running 1 incremental model in 0 hours 0 minutes and 0.40 seconds (0.40s).
21:48:00  
21:48:00  Completed successfully
21:48:00  
21:48:00  Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
+----+-------+
| id | value |
+----+-------+
|  1 |    10 |
|  2 |    20 |
|  3 |    30 |
+----+-------+
(3 rows)
```

### persist_docs on a VIEW

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run --select mx_view_docs && python -I /Users/adnane/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "select view_name, comment from duckdb_views() where view_name = 'mx_view_docs'" && python -I /Users/adnane/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "select column_name, comment from duckdb_columns() where table_name = 'mx_view_docs'"
```
```text
21:48:02  Running with dbt=1.11.16
21:48:03  Registered adapter: duckdb=1.11.0
21:48:03  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:48:03  
21:48:03  Concurrency: 4 threads (target='dev')
21:48:03  
21:48:03  1 of 1 START sql view model dbt_adnane.mx_view_docs ............................ [RUN]
21:48:03  1 of 1 OK created sql view model dbt_adnane.mx_view_docs ....................... [OK in 0.06s]
21:48:03  
21:48:03  Finished running 1 view model in 0 hours 0 minutes and 0.17 seconds (0.17s).
21:48:03  
21:48:03  Completed successfully
21:48:03  
21:48:03  Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
+--------------+---------------------------+
| view_name    | comment                   |
+--------------+---------------------------+
| mx_view_docs | A view with persist_docs. |
+--------------+---------------------------+
(1 row)
+-------------+----------------+
| column_name | comment        |
+-------------+----------------+
| id          | The id column. |
+-------------+----------------+
(1 row)
```

### Ephemeral contract with a WRONG data_type (varchar instead of integer): is it checked?

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ grep -n -A6 'name: mx_ephemeral_contract' models/matrix/_matrix.yml && dbt run --select mx_uses_ephemeral
```
```text
69:  - name: mx_ephemeral_contract
70-    config:
71-      contract: {enforced: true}
72-    columns:
73-      - name: id
74-        data_type: varchar
75-
21:48:20  Running with dbt=1.11.16
21:48:20  Registered adapter: duckdb=1.11.0
21:48:21  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:48:21  
21:48:21  Concurrency: 4 threads (target='dev')
21:48:21  
21:48:21  1 of 1 START sql view model dbt_adnane.mx_uses_ephemeral ....................... [RUN]
21:48:21  1 of 1 OK created sql view model dbt_adnane.mx_uses_ephemeral .................. [OK in 0.05s]
21:48:21  
21:48:21  Finished running 1 view model in 0 hours 0 minutes and 0.14 seconds (0.14s).
21:48:21  
21:48:21  Completed successfully
21:48:21  
21:48:21  Done. PASS=1 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
```

### store_failures (default: a TABLE in the target schema, because of our generate_schema_name in dev)

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt test --select relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_ --store-failures --vars '{}' && python -I /Users/adnane/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "select table_schema, table_name, table_type from information_schema.tables where table_name like 'relationships_stg%'"
```
```text
21:48:23  Running with dbt=1.11.16
21:48:23  Registered adapter: duckdb=1.11.0
21:48:23  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:48:23  
21:48:23  Concurrency: 4 threads (target='dev')
21:48:23  
21:48:24  1 of 1 START test relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_  [RUN]
21:48:24  1 of 1 WARN 1 relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_  [WARN 1 in 0.04s]
21:48:24  
21:48:24  Finished running 1 test in 0 hours 0 minutes and 0.16 seconds (0.16s).
21:48:24  
21:48:24  Completed with 1 warning:
21:48:24  
21:48:24  Warning in test relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_ (models/staging/jaffle_shop/_jaffle_shop__models.yml)
21:48:24  Got 1 result, configured to warn if >0
21:48:24  
21:48:24    compiled code at target/compiled/jaffle_dbt/models/staging/jaffle_shop/_jaffle_shop__models.yml/relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c.sql
21:48:24  
21:48:24    See test failures:
  -------------------------------------------------------------------------------------------------------
  select * from "practice"."dbt_adnane"."relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c"
  -------------------------------------------------------------------------------------------------------
21:48:24  
21:48:24  Done. PASS=0 WARN=1 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
+--------------+-----------------------------------------------------------------+------------+
| table_schema | table_name                                                      | table_type |
+--------------+-----------------------------------------------------------------+------------+
| dbt_adnane   | relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c | BASE TABLE |
+--------------+-----------------------------------------------------------------+------------+
(1 row)
```

### store_failures_as: view (configured on the test)

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ python -I /Users/adnane/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "drop table dbt_adnane.relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c" > /dev/null; dbt test --select relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_ && python -I /Users/adnane/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "select table_schema, table_name, table_type from information_schema.tables where table_name like 'relationships_stg%'"
```
```text
21:48:26  Running with dbt=1.11.16
21:48:26  Registered adapter: duckdb=1.11.0
21:48:27  Found 26 models, 2 analyses, 45 data tests, 1 seed, 2 snapshots, 5 sources, 2 exposures, 670 macros, 2 groups, 5 unit tests
21:48:27  
21:48:27  Concurrency: 4 threads (target='dev')
21:48:27  
21:48:27  1 of 1 START test relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_  [RUN]
21:48:27  1 of 1 WARN 1 relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_  [WARN 1 in 0.04s]
21:48:27  
21:48:27  Finished running 1 test in 0 hours 0 minutes and 0.12 seconds (0.12s).
21:48:27  
21:48:27  Completed with 1 warning:
21:48:27  
21:48:27  Warning in test relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_ (models/staging/jaffle_shop/_jaffle_shop__models.yml)
21:48:27  Got 1 result, configured to warn if >0
21:48:27  
21:48:27    compiled code at target/compiled/jaffle_dbt/models/staging/jaffle_shop/_jaffle_shop__models.yml/relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c.sql
21:48:27  
21:48:27    See test failures:
  -------------------------------------------------------------------------------------------------------
  select * from "practice"."dbt_adnane"."relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c"
  -------------------------------------------------------------------------------------------------------
21:48:27  
21:48:27  Done. PASS=0 WARN=1 ERROR=0 SKIP=0 NO-OP=0 TOTAL=1
+--------------+-----------------------------------------------------------------+------------+
| table_schema | table_name                                                      | table_type |
+--------------+-----------------------------------------------------------------+------------+
| dbt_adnane   | relationships_stg_jaffle_shop__69c2006accf24d593d7f144684ebb92c | VIEW       |
+--------------+-----------------------------------------------------------------+------------+
(1 row)
```

### run-operation works

(run from `/private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/a1/throwaway/matrix/jaffle_dbt`)

```bash
$ dbt run-operation print_row_counts --args '{materializations: [view]}' | tail -3
```
```text
21:48:30  stg_jaffle_shop__orders: 324 rows
21:48:30  stg_jaffle_shop__products: 12 rows
21:48:30  stg_stripe__payments: 375 rows
```

