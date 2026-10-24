# Capstone (ShopFlow) logs

- `mNN.md` : AUTHORITATIVE. Outputs of `a2/replay.sh run1`: every tag m00..m14 checked out in a fresh clone
  (a2/replay/run1/dbt-course/shopflow_dbt) on a fresh raw DB built from labs/capstone/setup.sql,
  update scripts applied at the milestone where the chapter applies them (fresh_load m01, day2 m08, day3 m09, fresh_load m14).
  Includes the demo steps (m05 macro bug, m06 rounds 1-3, m13 prod-before-feature, no-defer failure, clone, retry drill).
  Every checkpoint number in parts/part8/ch26-capstone.tex comes from these files.
- `dev/` : logs written while developing the solution. WARNING: dev/m00..m08 were captured with an EARLIER version of the
  generated data (before the "horizon" fix in tools/generate_capstone.py); counts there differ (refunds 201, shipments 2662...).
  dev/m07.md (unit-test error + diff, synthetic inputs), dev/m09.md (strategy check incl. insert_overwrite error, MERGE),
  dev/m11.md (private access, contract, versions, check-constraint, grants messages) and dev/m13*.md (write-write conflict,
  PARTIAL SUCCESS, defer, clone, retry) are used in the chapter for messages that do not depend on the data.
- `setup.txt` : row counts printed by setup.sql (day 1).
