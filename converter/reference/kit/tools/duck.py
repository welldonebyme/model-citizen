"""duck.py - run SQL on a DuckDB file with the DuckDB *Python library* of your venv.

Use it when you do not have the DuckDB command-line tool (or when PowerShell refuses the `<` sign).
It uses the same DuckDB version as dbt, so it can never create a file that dbt cannot open.

    python duck.py practice.duckdb -f setup.sql             # = duckdb practice.duckdb < setup.sql
    python duck.py practice.duckdb -f updates/day2.sql      # = duckdb practice.duckdb < updates/day2.sql
    python duck.py practice.duckdb "select count(*) from jaffle_shop.orders"
    python duck.py practice.duckdb .tables                   # list the tables
    python duck.py practice.duckdb                           # small interactive prompt (.quit to leave)
    python duck.py --version                                 # the DuckDB library version

Relative paths inside the SQL (for example data/customers.csv) are read from the folder you are in,
exactly like the DuckDB CLI: run it from the folder that contains the SQL file's data/ folder.
Close every other DuckDB session first: a DuckDB file has only one writer at a time.
"""
from __future__ import annotations

import argparse
import sys

try:
    import duckdb
except ImportError:  # pragma: no cover
    sys.exit("The duckdb Python library is missing. Activate the venv first (see the kit README).")

PRINT_TYPES = {"SELECT", "PRAGMA", "EXPLAIN", "CALL", "EXECUTE", "RELATION", "ANALYZE"}


def fmt(v) -> str:
    return "NULL" if v is None else str(v)


def table(cols: list[str], rows: list[tuple], max_rows: int) -> str:
    shown = rows[:max_rows]
    cells = [[fmt(v) for v in r] for r in shown]
    widths = [max([len(c)] + [len(r[i]) for r in cells]) for i, c in enumerate(cols)]
    line = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    out = [line, "| " + " | ".join(c.ljust(w) for c, w in zip(cols, widths)) + " |", line]
    for r, raw in zip(cells, shown):
        out.append("| " + " | ".join(v.rjust(w) if isinstance(x, (int, float)) and not isinstance(x, bool)
                                      else v.ljust(w) for v, w, x in zip(r, widths, raw)) + " |")
    out.append(line)
    n = len(rows)
    out.append(f"({n} rows, {max_rows} shown)" if n > max_rows else f"({n} row{'s' if n != 1 else ''})")
    return "\n".join(out)


def run(con, sql: str, max_rows: int) -> None:
    if sql.strip().rstrip(";") in (".tables", ".schema"):
        sql = ("select table_schema, table_name, table_type from information_schema.tables "
               "order by table_schema, table_name")
    for st in duckdb.extract_statements(sql):
        res = con.execute(st)
        if st.type.name in PRINT_TYPES and res.description:
            cols = [d[0] for d in res.description]
            print(table(cols, res.fetchall(), max_rows))


def repl(con, max_rows: int) -> None:
    print(f"DuckDB {duckdb.__version__} (Python library). End each statement with ';'. Type .quit to leave.")
    buf = []
    while True:
        try:
            line = input("D " if not buf else "... ")
        except EOFError:
            print()
            return
        s = line.strip()
        if not buf and s in (".quit", ".exit", "exit", "quit"):
            return
        if not buf and s in (".tables", ".schema"):
            run(con, s, max_rows)
            continue
        buf.append(line)
        if s.endswith(";"):
            try:
                run(con, "\n".join(buf), max_rows)
            except duckdb.Error as e:
                print(f"Error: {e}")
            buf = []


def main() -> int:
    ap = argparse.ArgumentParser(description="Run SQL on a DuckDB file with the venv's DuckDB library.")
    ap.add_argument("db", nargs="?", help="database file, for example practice.duckdb")
    ap.add_argument("sql", nargs="?", help="SQL text (or .tables)")
    ap.add_argument("-f", "--file", action="append", help="SQL file to run (can be repeated)")
    ap.add_argument("--max", type=int, default=40, help="rows to print per result (default 40)")
    ap.add_argument("--readonly", action="store_true", help="open the file read-only")
    ap.add_argument("--version", action="store_true", help="print the DuckDB library version")
    a = ap.parse_args()
    if a.version:
        print(duckdb.__version__)
        return 0
    if not a.db:
        ap.error("give a database file")
    try:
        con = duckdb.connect(a.db, read_only=a.readonly)
    except duckdb.Error as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    try:
        if a.file:
            for f in a.file:
                with open(f, encoding="utf-8") as fh:
                    run(con, fh.read(), a.max)
        if a.sql:
            run(con, a.sql, a.max)
        if not a.file and not a.sql:
            repl(con, a.max)
    except duckdb.Error as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
