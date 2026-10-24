"""Export a compact DAG per tag (feeds the TypeScript implementation of dbt's node selection).

    .venv-verify/.venv/bin/python -I converter/reference/export_dags.py [--work DIR] [--only jaffle|shopflow] [--tags ch07,ch16]

Needs the verification env (sh tools/setup_verification_env.sh .venv-verify):
dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb 1.5.6. For every tag of the two reference repos:
  1. git archive <tag> into a work folder (the book's repos are only read)
  2. build the raw database (dbt parse does not need it, but the folder layout is the book's)
  3. dbt deps (once per distinct package lock; network: hub.getdbt.com)
  4. dbt parse --no-partial-parse (dev target, in-process via _dbt_graph.py, which also returns dbt's own graph
     edges and the extra test edges of `dbt build`), and dbt parse --target prod (prod schemas/configs)
  5. dbt ls --resource-type all: the "Found ..." line and every node as dbt ls prints it; the export checks
     that its own `ls` field equals what dbt printed (fails otherwise)
Writes site/src/generated/dag/<key>-<tag>.json and site/src/generated/dag/index.json
(deterministic: no timestamps, no absolute paths, sorted lists).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ACADEMY, PROJECTS, PY, build_db, db_path, dbt_env, prepare_tag, run_dbt,  # noqa: E402
                    write_profiles)

OUT = ACADEMY / "site" / "src" / "generated" / "dag"
HERE = Path(__file__).resolve().parent

DROP_CONFIG_ALWAYS = {"static_analysis"}
KEEP_CONFIG_EVEN_EMPTY = {"materialized", "enabled", "tags"}


def prune_config(cfg: dict) -> dict:
    out = {}
    for k, v in sorted(cfg.items()):
        if k in DROP_CONFIG_ALWAYS:
            continue
        if k not in KEEP_CONFIG_EVEN_EMPTY and (v is None or v == {} or v == []):
            continue
        out[k] = v
    return out


def ls_selector(n: dict) -> str:
    """How `dbt ls` (default --output selector) prints a node (dbt/task/list.py, 1.11.16)."""
    rt = n["resource_type"]
    if rt == "source":
        return f"source:{n['package_name']}.{n['source_name']}.{n['name']}"
    if rt == "exposure":
        return f"exposure:{n['package_name']}.{n['name']}"
    if rt in ("metric", "saved_query", "semantic_model"):
        return f"{rt}:{n['package_name']}.{n['name']}"
    if rt == "unit_test":
        vn = n["name"] if n.get("version") is None else f"{n['name']}_v{n['version']}"
        return f"unit_test:{n['package_name']}.{vn}"
    return ".".join(n["fqn"])


def search_name(n: dict) -> str:
    """`dbt ls --output name` (node.search_name)."""
    rt = n["resource_type"]
    if rt == "source":
        return f"{n['source_name']}.{n['name']}"
    if rt == "model" and n.get("version") is not None:
        return f"{n['name']}.v{n['version']}"
    if rt == "unit_test" and n.get("version") is not None:
        return f"{n['name']}_v{n['version']}"
    return n["name"]


def macros_of(n: dict) -> list[str]:
    return sorted(m for m in n.get("depends_on", {}).get("macros", [])
                  if not (m.startswith("macro.dbt.") or m.startswith("macro.dbt_duckdb.")))


def compact_node(n: dict) -> dict:
    rt = n["resource_type"]
    o = {
        "unique_id": n["unique_id"],
        "name": n["name"],
        "resource_type": rt,
        "package_name": n["package_name"],
        "path": n.get("path"),
        "original_file_path": n.get("original_file_path"),
        "fqn": n.get("fqn"),
        "tags": sorted(n.get("tags") or []),
        "config": prune_config(n.get("config") or {}),
        "depends_on": {"nodes": sorted(n.get("depends_on", {}).get("nodes", [])), "macros": macros_of(n)},
        "ls": ls_selector(n),
        "search_name": search_name(n),
    }
    if rt in ("model", "seed", "snapshot", "analysis", "test"):
        o["language"] = n.get("language")
        o["database"] = n.get("database")
        o["schema"] = n.get("schema")
        o["alias"] = n.get("alias")
        o["relation_name"] = n.get("relation_name")
        cs = n.get("checksum") or {}
        o["checksum"] = cs.get("checksum")
    if rt == "model":
        o["access"] = n.get("access")
        o["group"] = n.get("group")
        o["version"] = n.get("version")
        o["latest_version"] = n.get("latest_version")
        o["deprecation_date"] = n.get("deprecation_date")
        o["contract_enforced"] = bool((n.get("contract") or {}).get("enforced"))
        o["description"] = n.get("description") or ""
    if rt in ("seed", "snapshot", "analysis", "test"):
        o["group"] = n.get("group")
    if rt == "test":
        tm = n.get("test_metadata")
        o["test_type"] = "generic" if tm else "singular"
        o["test_metadata"] = ({"name": tm.get("name"), "namespace": tm.get("namespace")} if tm else None)
        o["attached_node"] = n.get("attached_node")
        o["column_name"] = n.get("column_name")
        o["file_key_name"] = n.get("file_key_name")
    if rt == "unit_test":
        o["model"] = n.get("model")
        o["version"] = n.get("version")
        o["versions"] = n.get("versions")
        o["schema"] = n.get("schema")
        cs = n.get("checksum")
        o["checksum"] = cs.get("checksum") if isinstance(cs, dict) else cs
    return o


def compact_source(s: dict) -> dict:
    return {
        "unique_id": s["unique_id"],
        "name": s["name"],
        "source_name": s["source_name"],
        "resource_type": "source",
        "package_name": s["package_name"],
        "path": s.get("path"),
        "original_file_path": s.get("original_file_path"),
        "fqn": s.get("fqn"),
        "tags": sorted(s.get("tags") or []),
        "config": prune_config(s.get("config") or {}),
        "database": s.get("database"),
        "schema": s.get("schema"),
        "identifier": s.get("identifier"),
        "relation_name": s.get("relation_name"),
        "loaded_at_field": s.get("loaded_at_field"),
        "freshness": s.get("freshness"),
        "description": s.get("description") or "",
        "ls": ls_selector(s),
        "search_name": search_name(s),
    }


def compact_exposure(e: dict) -> dict:
    return {
        "unique_id": e["unique_id"],
        "name": e["name"],
        "resource_type": "exposure",
        "package_name": e["package_name"],
        "path": e.get("path"),
        "original_file_path": e.get("original_file_path"),
        "fqn": e.get("fqn"),
        "tags": sorted(e.get("tags") or []),
        "config": prune_config(e.get("config") or {}),
        "type": e.get("type"),
        "maturity": e.get("maturity"),
        "owner": e.get("owner"),
        "label": e.get("label"),
        "url": e.get("url"),
        "description": e.get("description") or "",
        "depends_on": {"nodes": sorted(e.get("depends_on", {}).get("nodes", []))},
        "ls": ls_selector(e),
        "search_name": search_name(e),
    }


FOUND_RE = re.compile(r"Found (.+)$")
TS_RE = re.compile(r"^\d\d:\d\d:\d\d\s")


PLURAL = {"model": "models", "analysis": "analyses", "seed": "seeds", "snapshot": "snapshots", "source": "sources",
          "exposure": "exposures", "macro": "macros", "group": "groups", "data test": "data tests",
          "unit test": "unit tests", "metric": "metrics", "semantic model": "semantic models",
          "saved query": "saved queries", "sql operation": "sql operations", "function": "functions"}


def parse_found(line: str) -> dict:
    """'Found 7 models, 1 seed, ...' -> {'models': 7, 'seeds': 1, ...} (keys always plural)."""
    out = {}
    body = line[len("Found "):] if line.startswith("Found ") else line
    for part in body.split(", "):
        m = re.match(r"(\d+) (.+)", part.strip())
        if m:
            name = m.group(2).strip()
            out[PLURAL.get(name, name)] = int(m.group(1))
    return dict(sorted(out.items()))


def diff_config(dev: dict, prod: dict) -> dict:
    d = {}
    for k in sorted(set(dev) | set(prod)):
        if dev.get(k) != prod.get(k):
            d[k] = prod.get(k)
    return d


def export_tag(key: str, tag: str, work: Path, profiles: Path) -> dict:
    spec = PROJECTS[key]
    pdir = prepare_tag(key, tag, work, profiles)
    graph_json = work / key / f"graph-{tag}.json"
    r = subprocess.run([str(PY), "-I", str(HERE / "_dbt_graph.py"), str(pdir), str(profiles), str(graph_json)],
                       cwd=pdir, env=dbt_env(profiles), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{key} {tag}: parse failed\n{r.stdout}\n{r.stderr}")
    parse_log = r.stdout
    manifest = json.loads((pdir / "target" / "manifest.json").read_text())
    (work / key / "manifests").mkdir(parents=True, exist_ok=True)
    (work / key / "manifests" / f"{tag}.json").write_text(json.dumps(manifest))
    graph = json.loads(graph_json.read_text())

    rp = run_dbt(["parse", "--no-partial-parse", "--target", "prod"], pdir, profiles)
    if rp.returncode != 0:
        raise RuntimeError(f"{key} {tag}: prod parse failed\n{rp.stdout}")
    prod = json.loads((pdir / "target" / "manifest.json").read_text())

    rl = run_dbt(["ls", "--resource-type", "all"], pdir, profiles)
    if rl.returncode != 0:
        raise RuntimeError(f"{key} {tag}: dbt ls failed\n{rl.stdout}")
    found_line = None
    ls_lines = []
    for line in rl.stdout.splitlines():
        if TS_RE.match(line):
            m = FOUND_RE.search(line)
            if m:
                found_line = m.group(0)
            continue
        if line.strip():
            ls_lines.append(line.strip())

    nodes = [compact_node(n) for n in manifest["nodes"].values()]
    nodes += [compact_node(u) for u in manifest.get("unit_tests", {}).values()]
    nodes.sort(key=lambda n: n["unique_id"])
    prod_nodes = {**prod["nodes"], **prod.get("unit_tests", {})}
    for n in nodes:
        p = prod_nodes.get(n["unique_id"])
        if p is None:
            continue
        pc = compact_node(p)
        ov = {}
        for k in ("database", "schema", "alias", "relation_name"):
            if k in n and pc.get(k) != n.get(k):
                ov[k] = pc.get(k)
        cd = diff_config(n["config"], pc["config"])
        if cd:
            ov["config"] = cd
        if ov:
            n["prod"] = ov
    sources = sorted((compact_source(s) for s in manifest["sources"].values()), key=lambda s: s["unique_id"])
    for s in sources:
        p = prod["sources"].get(s["unique_id"])
        if p and p.get("relation_name") != s["relation_name"]:
            s["prod"] = {"schema": p.get("schema"), "relation_name": p.get("relation_name")}
    exposures = sorted((compact_exposure(e) for e in manifest["exposures"].values()), key=lambda e: e["unique_id"])
    groups = sorted(({"unique_id": g["unique_id"], "name": g["name"], "owner": g.get("owner"),
                      "original_file_path": g.get("original_file_path")}
                     for g in manifest.get("groups", {}).values()), key=lambda g: g["unique_id"])
    macros = sorted(({"unique_id": m["unique_id"], "name": m["name"], "package_name": m["package_name"],
                      "original_file_path": m["original_file_path"],
                      "depends_on": {"macros": macros_of(m)}}
                     for m in manifest["macros"].values() if m["package_name"] == spec["project"]),
                    key=lambda m: m["unique_id"])
    selectors_yml = (pdir / "selectors.yml").read_text() if (pdir / "selectors.yml").exists() else None
    selectors = manifest.get("selectors") or {}

    # self-check: our `ls` strings must be exactly what dbt ls printed
    expected = sorted(x["ls"] for x in nodes + sources + exposures)
    if sorted(ls_lines) != expected:
        missing = sorted(set(expected) - set(ls_lines))
        extra = sorted(set(ls_lines) - set(expected))
        raise RuntimeError(f"{key} {tag}: ls mismatch missing={missing} extra={extra}")
    # dbt ls prints in sorted(unique_id) order: keep that order for the engine's output
    order = [x["ls"] for x in sorted(nodes + sources + exposures, key=lambda x: x["unique_id"])]
    if order != ls_lines:
        raise RuntimeError(f"{key} {tag}: ls order differs from sorted(unique_id)")

    all_ids = {x["unique_id"] for x in nodes + sources + exposures}
    for a, b in graph["edges"] + graph["test_edges"]:
        if a not in all_ids or b not in all_ids:
            raise RuntimeError(f"{key} {tag}: edge with unknown node {a} -> {b}")

    counts = parse_found(found_line) if found_line else {}
    pkgs = sorted({m["package_name"] for m in manifest["macros"].values()} - {"dbt", "dbt_duckdb", spec["project"]})
    lock = None
    if (pdir / "package-lock.yml").exists():
        lock = (pdir / "package-lock.yml").read_text()
    return {
        "schema": 1,
        "project": spec["project"],
        "key": key,
        "tag": tag,
        "commit": subprocess.run(["git", "-C", str(spec["repo"]), "rev-parse", f"{tag}^{{commit}}"],
                                 capture_output=True, text=True, check=True).stdout.strip(),
        "dbt_version": manifest["metadata"]["dbt_version"],
        "adapter_type": manifest["metadata"]["adapter_type"],
        "target": "dev",
        "found_line": found_line,
        "counts": counts,
        "packages": pkgs,
        "package_lock": lock,
        "notes": [
            "nodes = models, seeds, snapshots, analyses, data tests and unit tests, sorted by unique_id; "
            "`ls` = the line dbt ls prints (default output), `search_name` = dbt ls --output name.",
            "dbt ls prints selected nodes in sorted(unique_id) order; analyses are listed only with "
            "--resource-type analysis/all.",
            "edges = dbt's selection graph (parent, child); test_edges = extra (test, node) edges that "
            "`dbt build` adds before selecting (Linker.add_test_edges).",
            "config: keys with null/empty values removed (materialized, enabled, tags always kept); "
            "`prod` = values that differ with --target prod.",
        ],
        "nodes": nodes,
        "sources": sources,
        "exposures": exposures,
        "groups": groups,
        "macros": macros,
        "edges": graph["edges"],
        "test_edges": graph["test_edges"],
        "selectors": selectors,
        "selectors_yml": selectors_yml,
        "ls_all": ls_lines,
        "_parse_log_tail": None if not parse_log else None,
    }


def dump(path: Path, obj) -> int:
    obj.pop("_parse_log_tail", None)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n"
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if old != data:
        path.write_text(data, encoding="utf-8")
    return len(data.encode())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=None)
    ap.add_argument("--only", choices=list(PROJECTS), default=None)
    ap.add_argument("--tags", default=None)
    a = ap.parse_args()
    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="mc-dag-"))
    work.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    profiles = write_profiles(work)
    index_path = OUT / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"schema": 1, "tags": {}}
    total = 0
    for key, spec in PROJECTS.items():
        if a.only and key != a.only:
            continue
        build_db(spec["setup_sql"], db_path(key, work))
        tags = spec["tags"] if not a.tags else [t for t in spec["tags"] if t in a.tags.split(",")]
        for tag in tags:
            d = export_tag(key, tag, work, profiles)
            size = dump(OUT / f"{key}-{tag}.json", d)
            total += size
            index["tags"][f"{key}-{tag}"] = {
                "key": key, "tag": tag, "file": f"{key}-{tag}.json", "found_line": d["found_line"],
                "counts": d["counts"], "nodes": len(d["nodes"]), "sources": len(d["sources"]),
                "exposures": len(d["exposures"]), "edges": len(d["edges"]), "test_edges": len(d["test_edges"]),
                "selectors": sorted(d["selectors"]), "bytes": size,
            }
            print(f"{key}-{tag}: {len(d['nodes'])} nodes, {len(d['sources'])} sources, "
                  f"{len(d['exposures'])} exposures, {len(d['edges'])} edges (+{len(d['test_edges'])} test edges), "
                  f"{size / 1024:.1f} KiB | {d['found_line']}", flush=True)
    index["tags"] = dict(sorted(index["tags"].items()))
    index["dbt"] = "dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb 1.5.6 (Python 3.12)"
    dump(index_path, index)
    print(f"work folder: {work}")
    print(f"written: {total / 1024:.1f} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
