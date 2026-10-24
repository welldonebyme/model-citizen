#!/bin/sh
# Recreate the exact dbt environment used to verify the book (and to verify the website content).
#
#   sh tools/setup_verification_env.sh <folder>      # e.g. sh tools/setup_verification_env.sh /tmp/v156
#   <folder>/.venv/bin/dbt --version                  # dbt-core 1.11.16, dbt-duckdb 1.11.0
#
# Versions match what the student installs in Chapter 2 of the book:
# dbt Core 1.11 (the exam version) + DuckDB 1.5.6 (same as the Homebrew DuckDB CLI, pinned on purpose).
set -e
DEST="${1:?give a destination folder}"
mkdir -p "$DEST"
uv venv --python 3.12 "$DEST/.venv"
uv pip install --python "$DEST/.venv/bin/python" \
  "dbt-core==1.11.16" "dbt-duckdb==1.11.0" "duckdb==1.5.6" pandas pyyaml jinja2
"$DEST/.venv/bin/dbt" --version
echo "Practice database: $DEST/.venv/bin/python -I ../dbt-bible/tools/build_practice_db.py <path>/practice.duckdb"
