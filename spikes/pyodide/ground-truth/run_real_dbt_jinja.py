"""Ground truth: run every Jinja case that has a `real` spec with the real dbt-core 1.11.16 + dbt-duckdb 1.11.0.

usage: .venv/bin/python ground-truth/run_real_dbt_jinja.py results/jinja_cases.json > results/jinja_real_dbt.json

ch11 cases run in ground-truth/jaffle_dbt (reference repo at tag ch11, built into ground-truth/db/practice.duckdb);
ch05 cases run in a tiny jaffle_practice project. Files written for a case are removed afterwards.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DBT = str(HERE.parent / ".venv" / "bin" / "dbt")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
TS = re.compile(r"^\d\d:\d\d:\d\d  ", re.M)
NOISE = ("Running with dbt", "Registered adapter", "Performance info", "Unable to do partial", "Found ",
         "Concurrency:", "[WARNING][DeprecationsSummary]", "Summary of encountered", "- ")
ENV = {**os.environ, "DBT_SEND_ANONYMOUS_USAGE_STATS": "false"}


def ch05_project():
    root = HERE / "_proj_jinja_ch05"
    if root.exists():
        shutil.rmtree(root)
    (root / "models" / "staging").mkdir(parents=True)
    (root / "dbt_project.yml").write_text("name: 'jaffle_practice'\nversion: '1.0.0'\nprofile: 'jaffle_practice'\n")
    (root / "profiles.yml").write_text(
        "jaffle_practice:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n"
        f"      path: '{HERE}/db/practice.duckdb'\n      schema: dbt_adnane\n      threads: 1\n")
    (root / "models" / "staging" / "_sources.yml").write_text(
        "version: 2\n\nsources:\n  - name: jaffle_shop\n    schema: jaffle_shop\n    tables:\n"
        "      - name: orders\n      - name: customers\n  - name: stripe\n    schema: stripe\n    tables:\n"
        "      - name: payments\n")
    (root / "models" / "staging" / "stg_orders.sql").write_text(
        "select id as order_id, user_id as customer_id, order_date, status\nfrom {{ source('jaffle_shop', 'orders') }}\n")
    return root


def run(args, root):
    p = subprocess.run([DBT, *args, "--profiles-dir", str(root), "--project-dir", str(root), "--no-partial-parse"],
                       capture_output=True, text=True, cwd=root, env=ENV)
    text = TS.sub("", ANSI.sub("", p.stdout + p.stderr))
    return p.returncode, text


def parse_output(text, marker):
    out = {"output": text.strip("\n")}
    if marker in text:
        out["compiled"] = text.split(marker, 1)[1].lstrip("\n").rstrip("\n")
    out["log_lines"] = [l for l in text.split("\n") if l.strip() and not l.startswith(NOISE)]
    return out


def main():
    cases = json.load(open(sys.argv[1]))
    roots = {"ch11": HERE / "jaffle_dbt", "ch05": ch05_project()}
    results = {}
    for c in cases:
        spec = c.get("real")
        if not spec:
            continue
        root = roots[spec.get("project", c.get("project", "ch11"))]
        written = []
        for path, src in (c.get("extra_macro_files") or {}).items():
            f = root / path
            f.write_text(src)
            written.append(f)
        target = ["--target", spec["target"]] if spec.get("target") else []
        try:
            if spec["kind"] == "inline":
                code, text = run(["compile", "--inline", c["template"], *target], root)
                res = parse_output(text, "Compiled inline node is:")
            elif spec["kind"] == "model":
                f = root / c["node"]["path"]
                if not spec.get("existing"):
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_text(c["template"])
                    written.append(f)
                elif f.read_text().strip() != c["template"].strip():
                    print(f"NOTE {c['id']}: book listing differs from {f.relative_to(root)}", file=sys.stderr)
                if spec.get("run_first"):
                    run(["run", "-s", c["node"]["name"], *target], root)
                code, text = run(["compile", "-s", c["node"]["name"], *target], root)
                res = parse_output(text, f"Compiled node '{c['node']['name']}' is:")
            elif spec["kind"] == "run-operation":
                args = ["run-operation", spec["macro"]] + (["--args", spec["args"]] if spec.get("args") else [])
                code, text = run(args, root)
                res = parse_output(text, "\x00never")
            else:
                raise ValueError(spec["kind"])
        finally:
            for f in written:
                f.unlink(missing_ok=True)
        res["exit_code"] = code
        results[c["id"]] = res
        print(c["id"], code, file=sys.stderr)
    json.dump(results, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
