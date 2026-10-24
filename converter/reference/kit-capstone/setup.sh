#!/usr/bin/env bash
# ============================================================================
#  ShopFlow capstone kit - setup for macOS, Linux and WSL (milestone m00, first step)
#
#    bash setup.sh
#
#  Needs the course folder of the practice kit (~/dbt-course/.venv, Chapter 2).
#  Options (environment variables):
#    DBT_COURSE_DIR=/some/folder   another course folder (default: ~/dbt-course)
#    REBUILD_DB=1                  rebuild shopflow.duckdb even if it exists (= reset the raw data to day 1)
#
#  Creates ~/dbt-course/shopflow-data (data/ updates/ setup.sql shopflow.duckdb) and
#  ~/dbt-course/kit/capstone (shopflow_dbt.bundle = THE SOLUTION, seeds/, profiles/, README.md).
#  It does not clone the solution.
# ============================================================================
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COURSE="${DBT_COURSE_DIR:-$HOME/dbt-course}"
mkdir -p "$COURSE" && COURSE="$(cd "$COURSE" && pwd)"   # absolute path
PY="$COURSE/.venv/bin/python"

step() { printf '\n==> %s\n' "$*"; }
ok()   { printf '    OK  %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

for f in setup.sql data/orders.csv updates/day2.sql updates/day3.sql seeds/exchange_rates.csv shopflow_dbt.bundle tools/duck.py; do
  [ -e "$KIT_DIR/$f" ] || die "the kit is incomplete: $f is missing. Unzip shopflow-capstone-kit.zip again."
done
[ -x "$PY" ] || die "$COURSE/.venv not found. Run the practice kit's setup first (dbt-course-kit.zip, setup.sh)."

copy_tree() {  # copy files that are missing (never overwrite your changes)
  local src="$1" dst="$2"
  mkdir -p "$dst"
  (cd "$src" && find . -type f) | while IFS= read -r f; do
    if [ ! -e "$dst/$f" ]; then mkdir -p "$(dirname "$dst/$f")"; cp "$src/$f" "$dst/$f"; fi
  done
}

DATA="$COURSE/shopflow-data"
step "Raw data folder: $DATA"
copy_tree "$KIT_DIR/data" "$DATA/data"
copy_tree "$KIT_DIR/updates" "$DATA/updates"
[ -e "$DATA/setup.sql" ] || cp "$KIT_DIR/setup.sql" "$DATA/setup.sql"
ok "data/, updates/ and setup.sql are in place"

step "shopflow.duckdb (= duckdb shopflow.duckdb < setup.sql)"
if [ -e "$DATA/shopflow.duckdb" ] && [ "${REBUILD_DB:-0}" != 1 ]; then
  ok "exists: kept (REBUILD_DB=1 to reset it to day 1)"
else
  (cd "$DATA" && "$PY" "$KIT_DIR/tools/duck.py" shopflow.duckdb -f setup.sql)
  ok "built $DATA/shopflow.duckdb with DuckDB $("$PY" -c 'import duckdb; print(duckdb.__version__)')"
fi

step "Kit files: $COURSE/kit/capstone"
copy_tree "$KIT_DIR/seeds" "$COURSE/kit/capstone/seeds"
copy_tree "$KIT_DIR/profiles" "$COURSE/kit/capstone/profiles"
copy_tree "$KIT_DIR/tools" "$COURSE/kit/tools"
for f in shopflow_dbt.bundle README.md; do
  [ -e "$COURSE/kit/capstone/$f" ] || cp "$KIT_DIR/$f" "$COURSE/kit/capstone/$f"
done
ok "shopflow_dbt.bundle (the SOLUTION: look only after your own attempt), seeds/, profiles/"

cat <<EOF

 Done. Next (milestone m00): cd $COURSE && dbt init shopflow_dbt --skip-profile-setup
 and add the 'shopflow' profile to ~/.dbt/profiles.yml (Chapter 26).
EOF
