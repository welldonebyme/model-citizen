"""Ground truth: run the real dbt-core 1.11.16 (`dbt parse`) on every YAML case whose engine is "dbt".

usage: .venv/bin/python ground-truth/run_real_dbt_yaml.py results/yaml_cases.json > results/yaml_real_dbt.json

A throwaway project is created under ground-truth/_proj_<name>/ for each project name used by the cases.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DBT = HERE.parent / ".venv" / "bin" / "dbt"
ANSI = re.compile(r"\x1b\[[0-9;]*m")
TS = re.compile(r"^\d\d:\d\d:\d\d  ", re.M)


def make_project(name):
    root = HERE / f"_proj_{name}"
    if root.exists():
        shutil.rmtree(root)
    (root / "models" / "staging").mkdir(parents=True)
    (root / "dbt_project.yml").write_text(
        f"name: '{name}'\nversion: '1.0.0'\nprofile: '{name}'\nmodel-paths: ['models']\n"
    )
    (root / "profiles.yml").write_text(
        f"{name}:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n"
        f"      path: '{root}/practice.duckdb'\n      schema: dbt_adnane\n      threads: 1\n"
    )
    (root / "models" / "staging" / "stg_orders.sql").write_text("select 1 as id\n")
    return root


def main():
    cases = json.load(open(sys.argv[1]))
    projects = {}
    out = {}
    for c in cases:
        if c["engine"] != "dbt":
            continue
        name = c["project"]
        root = projects.get(name) or projects.setdefault(name, make_project(name))
        rel = c["path"][len("models/"):] if c["path"].startswith("models/") else c["path"]
        target = root / "models" / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(c["text"])
        p = subprocess.run(
            [str(DBT), "parse", "--no-partial-parse", "--profiles-dir", str(root), "--project-dir", str(root)],
            capture_output=True, text=True, cwd=root,
        )
        target.unlink()
        text = TS.sub("", ANSI.sub("", p.stdout + p.stderr))
        # keep only the interesting part: from the first warning/error line to the end
        lines = [l for l in text.split("\n") if not l.startswith(("Running with dbt", "Registered adapter",
                                                                    "Performance info", "Unable to do partial"))]
        out[c["id"]] = {"exit_code": p.returncode, "output": "\n".join(lines).strip("\n")}
        print(c["id"], p.returncode, file=sys.stderr)
    json.dump(out, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
