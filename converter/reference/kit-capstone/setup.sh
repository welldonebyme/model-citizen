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
#  Installs the kit in ~/dbt-course/kit/capstone (= the book's labs/capstone folder: data/ seeds/ setup.sql
#  updates/ shopflow_dbt.bundle = THE SOLUTION, profiles/, README.md, and a ready-made shopflow.duckdb), then does
#  the first step of milestone m00: ~/dbt-course/shopflow-data (data/ updates/ setup.sql shopflow.duckdb).
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

build_db() {  # build_db <folder>: shopflow.duckdb from setup.sql in that folder
  local dir="$1"
  if [ -e "$dir/shopflow.duckdb" ] && [ "${REBUILD_DB:-0}" != 1 ]; then
    ok "$dir/shopflow.duckdb exists: kept (REBUILD_DB=1 to reset it to day 1)"
  else
    (cd "$dir" && "$PY" "$COURSE/kit/tools/duck.py" shopflow.duckdb -f setup.sql)
    ok "built $dir/shopflow.duckdb with DuckDB $("$PY" -c 'import duckdb; print(duckdb.__version__)')"
  fi
}

CAP="$COURSE/kit/capstone"
step "Kit folder: $CAP"
for d in data seeds updates profiles; do copy_tree "$KIT_DIR/$d" "$CAP/$d"; done
copy_tree "$KIT_DIR/tools" "$COURSE/kit/tools"
for f in setup.sql shopflow_dbt.bundle README.md KIT-VERSION.txt; do
  [ -e "$CAP/$f" ] || cp "$KIT_DIR/$f" "$CAP/$f"
done
ok "data/ seeds/ setup.sql updates/ profiles/ README.md and shopflow_dbt.bundle (the SOLUTION: look only after your own attempt)"
step "Ready-made raw database in the kit folder"
build_db "$CAP"

DATA="$COURSE/shopflow-data"
step "Milestone m00, first step: $DATA (= copy data/, updates/, setup.sql from the kit, then duckdb shopflow.duckdb < setup.sql)"
copy_tree "$CAP/data" "$DATA/data"
copy_tree "$CAP/updates" "$DATA/updates"
[ -e "$DATA/setup.sql" ] || cp "$CAP/setup.sql" "$DATA/setup.sql"
build_db "$DATA"

cat <<EOF

 Done. Next (milestone m00): cd $COURSE && dbt init shopflow_dbt --skip-profile-setup
 and add the 'shopflow' profile to ~/.dbt/profiles.yml (Chapter 26).
EOF
