"""Native (CPython 3.12) run of the Jinja cases, with a real DuckDB for run_query/adapter calls.

usage: .venv/bin/python tests/run_native_jinja.py
writes results/jinja_native.json and results/jinja_query_replay.json (the queries + results that the
Pyodide runs replay, since the spike has no DuckDB-WASM).
"""
import datetime
import decimal
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "site" / "py"), str(ROOT / "site" / "test-py")]
import duckdb  # noqa: E402
import jinja_parity  # noqa: E402

con = duckdb.connect(str(ROOT / "ground-truth" / "db" / "practice.duckdb"), read_only=True)


def _plain(v):
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    return v


def query_fn(sql):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return cols, [[_plain(v) for v in r] for r in cur.fetchall()]


def main():
    cases = (ROOT / "results" / "jinja_cases.json").read_text()
    fixtures = json.dumps({"ch11": json.loads((ROOT / "site/fixtures/project_ch11.json").read_text()),
                           "ch05": json.loads((ROOT / "site/fixtures/project_ch05.json").read_text())})
    out = json.loads(jinja_parity.run(cases, fixtures, query_fn=query_fn))
    out["duckdb"] = duckdb.__version__
    replay = {r["id"]: r["recorded_queries"] for r in out["results"] if r["recorded_queries"]}
    (ROOT / "results" / "jinja_native.json").write_text(json.dumps(out, indent=1, default=str))
    (ROOT / "results" / "jinja_query_replay.json").write_text(json.dumps(replay, indent=1, default=str))
    for r in out["results"]:
        flag = {True: "PASS", False: "FAIL", None: "----"}[r["passed"]]
        print(flag, r["id"], r["status"], r["match"])
        if r["passed"] is False:
            print("   BOOK:", repr(r["book"])[:400])
            print("   GOT :", repr(r["got"])[:400])


if __name__ == "__main__":
    main()
