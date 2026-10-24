#!/usr/bin/env bash
# End-to-end test of the two kits on macOS / Linux, in an isolated HOME (your real ~/dbt-course and ~/.dbt
# are never touched). Leaves everything in the work folder for inspection.
#
#   bash converter/reference/test_kits.sh <empty-work-folder> [--full]
#
# Steps: unzip the practice kit -> setup.sh from scratch -> setup.sh again (idempotent) -> the reference
# clone at ch07: dbt build, summary compared with reference/builder-logs/ch07.md -> manual `git clone` of the
# bundle + the README's "reference" remote -> the 9 bug patches at ch21 (git apply --check) -> duck.py day2.sql
# -> capstone kit: setup.sh + row counts.
# --full also builds tag ch25 on a fresh database (dbt deps; the fresh-database rule of Chapter 19).
set -euo pipefail

WORK="${1:?give an empty work folder}"
FULL="${2:-}"
ACADEMY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KITS="$ACADEMY/site/public/kits"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
[ -z "$(ls -A "$WORK")" ] || { echo "work folder must be empty: $WORK" >&2; exit 2; }

REAL_HOME="$HOME"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$REAL_HOME/.cache/uv}"
export UV_PYTHON_INSTALL_DIR="${UV_PYTHON_INSTALL_DIR:-$REAL_HOME/.local/share/uv/python}"
export HOME="$WORK/home"
mkdir -p "$HOME"
for v in $(env | grep -o '^DBT_[A-Z_]*' || true); do unset "$v"; done
export DBT_SEND_ANONYMOUS_USAGE_STATS=false DBT_USE_COLORS=false

pass=0; failn=0
check() {  # check <description> <command...>
  local d="$1"; shift
  if "$@"; then echo "PASS  $d"; pass=$((pass + 1)); else echo "FAIL  $d"; failn=$((failn + 1)); fi
}

echo "== unzip"
mkdir -p "$WORK/unzip" && (cd "$WORK/unzip" && unzip -q "$KITS/dbt-course-kit.zip" && unzip -q "$KITS/shopflow-capstone-kit.zip")
KIT="$WORK/unzip/dbt-course-kit"
COURSE="$HOME/dbt-course"

echo "== setup.sh (from scratch)"
check "setup.sh from scratch exits 0" bash -c "bash '$KIT/setup.sh' > '$WORK/setup1.log' 2>&1"
tail -25 "$WORK/setup1.log"
check "dbt debug passed in setup" grep -q "All checks passed!" "$WORK/setup1.log"
check "venv has dbt 1.11" bash -c "'$COURSE/.venv/bin/dbt' --version | grep -q 'installed: 1.11.'"
check "venv has duckdb 1.5.6" bash -c "[ \"\$('$COURSE/.venv/bin/python' -c 'import duckdb; print(duckdb.__version__)')\" = 1.5.6 ]"
check "practice.duckdb row counts (100/300/606/12/341)" bash -c "grep -A8 'n_rows' '$WORK/setup1.log' | tr -s ' ' | grep -q 'stripe.payments | 341'"
check "~/.dbt not created by setup" test ! -e "$HOME/.dbt/profiles.yml"

echo "== setup.sh again (idempotent)"
check "second run exits 0" bash -c "bash '$KIT/setup.sh' > '$WORK/setup2.log' 2>&1"
check "second run keeps the database" grep -q "exists: kept" "$WORK/setup2.log"
check "second run keeps the venv" grep -q "existing venv kept" "$WORK/setup2.log"

echo "== reference project at ch07: dbt build"
REF="$COURSE/reference/jaffle_dbt"
check "reference clone has 20 tags" bash -c "[ \$(git -C '$REF' tag -l 'ch*' | wc -l) -eq 20 ]"
check "profiles.yml ignored by git" bash -c "[ -z \"\$(git -C '$REF' status --porcelain)\" ]"
git -C "$REF" checkout -q ch07
(cd "$REF" && "$COURSE/.venv/bin/dbt" build > "$WORK/ch07-build.log" 2>&1) || true
EXPECTED="$(grep -o 'Done\. PASS=[0-9]* WARN=[0-9]* ERROR=[0-9]* SKIP=[0-9]* NO-OP=[0-9]* TOTAL=[0-9]*' "$ACADEMY/reference/builder-logs/ch07.md" | sed -n 2p)"
GOT="$(grep -o 'Done\. PASS=[0-9]* WARN=[0-9]* ERROR=[0-9]* SKIP=[0-9]* NO-OP=[0-9]* TOTAL=[0-9]*' "$WORK/ch07-build.log" | tail -1)"
echo "   expected (builder-logs/ch07.md, dbt build): $EXPECTED"
echo "   got:                                        $GOT"
check "ch07 dbt build summary equals the log" test "$GOT" = "$EXPECTED"
check "ch07 dbt build wrote into the reference database only" bash -c \
  "'$COURSE/.venv/bin/python' '$COURSE/kit/tools/duck.py' --readonly '$COURSE/practice/practice.duckdb' \"select count(*) as n from information_schema.tables where table_schema = 'dbt_adnane'\" | grep -q '| 0 |'"
git -C "$REF" checkout -q main

echo "== manual clone of the bundle + the README's reference remote"
check "git clone jaffle_dbt.bundle" git clone -q "$KIT/jaffle_dbt.bundle" "$WORK/manual-clone"
check "manual clone: checkout ch07" git -C "$WORK/manual-clone" checkout -q ch07
mkdir -p "$WORK/myproject" && git -C "$WORK/myproject" init -q && git -C "$WORK/myproject" commit -q --allow-empty -m init
git -C "$WORK/myproject" remote add reference "$COURSE/kit/jaffle_dbt.bundle"
check "fetch reference tags as ref-*" git -C "$WORK/myproject" fetch -q --no-tags reference "refs/tags/*:refs/tags/ref-*"
check "20 ref-ch tags" bash -c "[ \$(git -C '$WORK/myproject' tag -l 'ref-ch*' | wc -l) -eq 20 ]"

echo "== bug patches at ch21"
git -C "$WORK/manual-clone" checkout -q ch21
for p in "$COURSE"/kit/bugs/*.patch; do
  check "git apply --check $(basename "$p")" git -C "$WORK/manual-clone" apply --check "$p"
done

echo "== duck.py: day2.sql on your practice database"
(cd "$COURSE/practice" && "$COURSE/.venv/bin/python" ../kit/tools/duck.py practice.duckdb -f updates/day2.sql > "$WORK/day2.log" 2>&1)
cat "$WORK/day2.log"
check "day2: 320 orders, 371 payments" bash -c "tr -s ' ' < '$WORK/day2.log' | grep -q 'jaffle_shop.orders | 320' && tr -s ' ' < '$WORK/day2.log' | grep -q 'stripe.payments | 371'"
check "run_sql.py (book helper) works" bash -c "cd '$COURSE/practice' && '$COURSE/.venv/bin/python' -I ../kit/tools/run_sql.py --db practice.duckdb 'select count(*) as n from jaffle_shop.customers' | grep -q 100"

if [ "$FULL" = "--full" ]; then
  echo "== reference project at ch25 on a fresh database (Chapter 19 rule)"
  (cd "$COURSE/reference/practice" && "$COURSE/.venv/bin/python" ../../kit/tools/duck.py practice.duckdb -f setup.sql > /dev/null)
  (cd "$COURSE/reference/practice" && "$COURSE/.venv/bin/python" ../../kit/tools/duck.py practice.duckdb -f updates/day2.sql > /dev/null)
  git -C "$REF" checkout -q ch25
  (cd "$REF" && "$COURSE/.venv/bin/dbt" deps > "$WORK/ch25-deps.log" 2>&1) || true
  uv pip install -q --python "$COURSE/.venv/bin/python" pandas   # Chapter 15 (README section 7)
  (cd "$REF" && "$COURSE/.venv/bin/dbt" build --exclude-resource-type unit_test > "$WORK/ch25-build1.log" 2>&1) || true
  (cd "$REF" && "$COURSE/.venv/bin/dbt" build > "$WORK/ch25-build2.log" 2>&1) || true
  grep -h 'Done\.' "$WORK/ch25-build1.log" "$WORK/ch25-build2.log" | sed 's/^/   /'
  check "ch25 second build: PASS=66 WARN=1 ERROR=0" grep -q 'Done\. PASS=66 WARN=1 ERROR=0 SKIP=0' "$WORK/ch25-build2.log"
  git -C "$REF" checkout -q main
fi

echo "== capstone kit"
CAP="$WORK/unzip/shopflow-capstone-kit"
check "capstone setup.sh exits 0" bash -c "bash '$CAP/setup.sh' > '$WORK/cap-setup.log' 2>&1"
tail -18 "$WORK/cap-setup.log"
for t in "shopflow_app.customers | 504" "shopflow_app.orders | 3000" "web_analytics.events | 25444" "shipping.shipments | 2646"; do
  check "capstone day 1: $t" bash -c "tr -s ' ' < '$WORK/cap-setup.log' | grep -q '$t'"
done
check "capstone bundle: 15 milestone tags" bash -c "git clone -q '$COURSE/kit/capstone/shopflow_dbt.bundle' '$WORK/cap-clone' && [ \$(git -C '$WORK/cap-clone' tag -l 'm*' | wc -l) -eq 15 ]"

echo
echo "RESULT: $pass passed, $failn failed   (work folder: $WORK)"
[ "$failn" -eq 0 ]
