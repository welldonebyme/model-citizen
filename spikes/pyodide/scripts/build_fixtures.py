"""Build the project fixtures loaded by dbt_jinja (site/fixtures/*.json).

usage: .venv/bin/python scripts/build_fixtures.py

* project_ch11.json: the reference project at tag ch11 (ground-truth/jaffle_dbt): models, sources and
  macros from its manifest/macros folder, plus real macro sources that dbt itself ships
  (dbt-adapters global_project/macros/utils, dbt-duckdb macros/utils) and dbt_utils 1.4.1
  (macros/sql + macros/jinja_helpers). Those files are Apache-2.0; they are copied verbatim.
* project_ch05.json: the tiny jaffle_practice project of Chapter 5.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GT = ROOT / "ground-truth" / "jaffle_dbt"
SP = ROOT / ".venv" / "lib" / "python3.12" / "site-packages"
OUT = ROOT / "site" / "fixtures"


def macro_files(folder, package, prefix):
    out = {}
    for f in sorted(Path(folder).rglob("*.sql")):
        out[f"{prefix}/{f.relative_to(folder)}"] = {"package": package, "source": f.read_text()}
    return out


def ch11():
    manifest = json.loads((GT / "target" / "manifest.json").read_text())
    models, sources = {}, {}
    for n in manifest["nodes"].values():
        if n["resource_type"] != "model":
            continue
        models[n["name"]] = {"path": n["original_file_path"], "materialized": n["config"]["materialized"],
                             "schema": n["config"].get("schema"), "alias": None}
    for s in manifest["sources"].values():
        src = sources.setdefault(s["source_name"], {"database": s["database"], "schema": s["schema"], "tables": {}})
        src["tables"][s["name"]] = {"identifier": s["identifier"]}
    files = {}
    files.update(macro_files(GT / "macros", "jaffle_dbt", "macros"))
    files.update(macro_files(SP / "dbt/include/global_project/macros/utils", "dbt", "dbt/global_project/macros/utils"))
    files.update(macro_files(SP / "dbt/include/duckdb/macros/utils", "dbt_duckdb", "dbt/duckdb/macros/utils"))
    for sub in ("sql", "jinja_helpers"):
        files.update(macro_files(GT / "dbt_packages/dbt_utils/macros" / sub, "dbt_utils",
                                 f"dbt_packages/dbt_utils/macros/{sub}"))
    return {
        "name": "jaffle_dbt", "database": "practice", "adapter_type": "duckdb",
        "targets": {"dev": {"schema": "dbt_adnane", "threads": 4}, "prod": {"schema": "prod", "threads": 4}},
        "target": "dev", "vars": {"dev_start_date": "2025-01-01"}, "env": {},
        "models": models, "sources": sources, "macro_files": files, "internal_packages": ["dbt_duckdb"],
        "run_started_at": "2026-10-21T22:13:33+00:00",
    }


def ch05():
    return {
        "name": "jaffle_practice", "database": "practice", "adapter_type": "duckdb",
        "targets": {"dev": {"schema": "dbt_adnane", "threads": 4}}, "target": "dev",
        "models": {"stg_orders": {"path": "models/staging/stg_orders.sql", "materialized": "view"}},
        "sources": {"jaffle_shop": {"schema": "jaffle_shop", "tables": {"orders": {}, "customers": {}}},
                    "stripe": {"schema": "stripe", "tables": {"payments": {}}}},
        "macro_files": {},
    }


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in (("project_ch11", ch11()), ("project_ch05", ch05())):
        p = OUT / f"{name}.json"
        p.write_text(json.dumps(data, indent=1))
        print(p.relative_to(ROOT), f"{p.stat().st_size / 1024:.0f} KB",
              f"{len(data['models'])} models, {len(data['macro_files'])} macro files")
