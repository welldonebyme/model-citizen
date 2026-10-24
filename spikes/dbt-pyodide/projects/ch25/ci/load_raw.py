"""Create a fresh practice database for CI from ci/raw/setup.sql.

    python ci/load_raw.py <path/to/practice.duckdb>

Same statements as `duckdb practice.duckdb < setup.sql`, for machines without
the DuckDB CLI (like a GitHub Actions runner). Keep the file name practice.duckdb:
DuckDB uses the file name as the database name.
"""
import os
import sys
from pathlib import Path

import duckdb

db = Path(sys.argv[1]).resolve()
raw = Path(__file__).resolve().parent / "raw"
db.parent.mkdir(parents=True, exist_ok=True)
con = duckdb.connect(str(db))
os.chdir(raw)                      # setup.sql reads data/*.csv relative to its folder
for statement in duckdb.extract_statements((raw / "setup.sql").read_text()):
    con.execute(statement)
con.close()
print(f"raw data loaded into {db}")
