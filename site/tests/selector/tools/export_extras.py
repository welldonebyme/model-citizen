"""Export the extra per-tag facts the TypeScript selection engine needs, using REAL dbt-core 1.11.16.

Run with the verification env (read-only use; it is never modified):

    .venv-verify/.venv/bin/python -I -B site/tests/selector/tools/export_extras.py [--work DIR] [--only jaffle|shopflow] [--tags ch16,ch24]

For every tag of the two reference repositories (read with `git archive`, never modified):
  * `dbt deps`, then `dbt parse --no-partial-parse` IN-PROCESS (dbtRunner), and from the parsed manifest:
      - files       : `git ls-tree -r --name-only <tag>` (the files `path:` globs can see)
      - patch_path  : the YAML file that documents a node (`path:` also matches it)
      - empty       : nodes whose raw code is empty (run/build skip them, ls keeps them)
      - hooks       : on-run-start / on-run-end hooks (the `hook: <pkg>.<type>.<i>` lines of run logs)
      - dicts       : `node.to_dict(omit_none=False)` minus heavy keys (for `dbt ls --output json --output-keys`);
                      floats are kept as {"__f": "<python repr>"} so the TypeScript printer is exact
      - ls_json     : the exact default `dbt ls --output json` line of every node (ListTask.ALLOWED_KEYS)
      - ci          : schema/alias/database of each node with `--target ci` when it differs from dev
  * state comparison with the PREVIOUS tag of the same repository: for each state selector value the set of
    unique ids that `state:<value>` matches (`dbt ls -s state:<value> --state <previous manifest>
    --resource-type all --indirect-selection empty`), or the error dbt raised.
  * a self-check: one real `dbt ls --resource-type all --output json` must print exactly ls_json.

Writes site/src/lib/selector/data/extras-<key>-<tag>.json (deterministic), the exact default JSON lines into
site/tests/selector/fixtures/lsjson-<key>-<tag>.json (tests only) and a work folder (scratch).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parents[2]
ACADEMY = SITE.parent
OUT = SITE / "src" / "lib" / "selector" / "data"
FIX = SITE / "tests" / "selector" / "fixtures"
sys.path.insert(0, str(ACADEMY / "converter" / "reference"))
from common import PROJECTS, PY, archive, dbt_env, git, install_packages, write_profiles  # noqa: E402

STATE_VALUES = ["new", "old", "modified", "unmodified", "modified.body", "modified.configs",
                "modified.persisted_descriptions", "modified.relation", "modified.macros", "modified.contract"]
HEAVY = {"raw_code", "compiled_code", "created_at", "config_call_dict", "unrendered_config_call_dict",
         "build_path", "compiled_path", "extra_ctes", "extra_ctes_injected", "compiled", "_event_status"}


# ------------------------------------------------------------------------------------------------ worker
def worker(project_dir: str, profiles_dir: str, out: str, prev_state: str | None) -> int:
    from dbt.cli.main import dbtRunner
    from dbt.node_types import NodeType
    from dbt.task.list import ListTask
    from dbt.utils import JSONEncoder

    base = ["--project-dir", project_dir, "--profiles-dir", profiles_dir]
    res = dbtRunner().invoke(["parse", "--no-partial-parse", "--quiet", *base])
    if not res.success:
        print(f"parse failed: {res.exception}", file=sys.stderr)
        return 1
    m = res.result

    def plain(d):
        return json.loads(json.dumps(d, cls=JSONEncoder), parse_float=lambda s: {"__f": s})

    every = {}
    every.update(m.nodes)
    every.update(m.sources)
    every.update(m.exposures)
    every.update(m.unit_tests)
    for extra in ("metrics", "semantic_models", "saved_queries", "functions"):
        every.update(getattr(m, extra, {}) or {})

    dicts, ls_json, patch_path, empty, hooks = {}, {}, {}, [], []
    for uid, node in sorted(every.items()):
        if getattr(node, "resource_type", None) == NodeType.Operation:
            hooks.append({"unique_id": uid, "package_name": node.package_name, "name": node.name,
                          "index": node.index, "tags": list(node.tags)})
            continue
        d = node.to_dict(omit_none=False)
        ls_json[uid] = json.dumps({k: v for k, v in d.items() if k in ListTask.ALLOWED_KEYS}, cls=JSONEncoder)
        dicts[uid] = plain({k: v for k, v in d.items() if k not in HEAVY})
        pp = getattr(node, "patch_path", None)
        if pp:
            patch_path[uid] = pp.split("://", 1)[1]
        if uid in m.nodes and getattr(node, "empty", False):
            empty.append(uid)

    # self-check against a real `dbt ls --output json`
    r = dbtRunner().invoke(["ls", "--resource-type", "all", "--output", "json", "--quiet", *base])
    real = list(r.result or [])
    mine = [ls_json[u] for u in sorted(ls_json)]
    selfcheck = {"ok": real == mine, "real_count": len(real), "mine_count": len(mine)}
    if real != mine:
        selfcheck["first_diff"] = next(([a, b] for a, b in zip(real, mine) if a != b), None)

    # target ci (schema/alias/database that differ from dev)
    ci = {}
    rc = dbtRunner().invoke(["parse", "--no-partial-parse", "--quiet", "--target", "ci", *base])
    if rc.success:
        mc = rc.result
        for uid, node in {**mc.nodes, **mc.unit_tests}.items():
            dev = m.nodes.get(uid) or m.unit_tests.get(uid)
            if dev is None or getattr(node, "resource_type", None) == NodeType.Operation:
                continue
            diff = {}
            for k in ("database", "schema", "alias"):
                if getattr(node, k, None) != getattr(dev, k, None):
                    diff[k] = getattr(node, k, None)
            if diff:
                ci[uid] = diff
    else:
        ci = {"__error__": str(rc.exception)}
    # the ci parse overwrote target/manifest.json: parse dev again so the saved manifest is the dev one
    dbtRunner().invoke(["parse", "--no-partial-parse", "--quiet", *base])

    state = None
    if prev_state:
        state = {"results": {}, "errors": {}}
        for v in STATE_VALUES:
            rs = dbtRunner().invoke(["ls", "-s", f"state:{v}", "--state", prev_state, "--resource-type", "all",
                                     "--indirect-selection", "empty", "--output", "json", "--output-keys",
                                     "unique_id", "--quiet", *base])
            if rs.success or rs.exception is None:
                state["results"][v] = sorted(json.loads(x)["unique_id"] for x in (rs.result or []))
            else:
                state["errors"][v] = str(rs.exception)
        # parse again (ls with --state does not change the manifest, but keep the dev manifest for the next tag)
        dbtRunner().invoke(["parse", "--no-partial-parse", "--quiet", *base])

    Path(out).write_text(json.dumps({
        "patch_path": patch_path, "empty": sorted(empty), "hooks": hooks, "dicts": dicts, "ls_json": ls_json,
        "ci": ci, "state": state, "selfcheck": selfcheck,
    }, ensure_ascii=False))
    return 0


# ------------------------------------------------------------------------------------------- orchestrator
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=None)
    ap.add_argument("--only", choices=list(PROJECTS), default=None)
    ap.add_argument("--tags", default=None)
    ap.add_argument("--worker", nargs=4, default=None)
    a = ap.parse_args()
    if a.worker:
        pdir, prof, out, prev = a.worker
        return worker(pdir, prof, out, None if prev == "-" else prev)

    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="mc-sel-"))
    work.mkdir(parents=True, exist_ok=True)
    profiles = write_profiles(work)
    OUT.mkdir(parents=True, exist_ok=True)
    only_tags = set(a.tags.split(",")) if a.tags else None
    for key, spec in PROJECTS.items():
        if a.only and key != a.only:
            continue
        prev_manifest_dir: Path | None = None
        prev_tag = None
        for tag in spec["tags"]:
            pdir = work / key / tag / spec["project"]
            archive(spec["repo"], tag, pdir)
            install_packages(pdir, profiles, work / "pkg-cache")
            out = work / key / f"extras-{tag}.json"
            skip = only_tags is not None and tag not in only_tags
            if not skip:
                r = subprocess.run([str(PY), "-I", "-B", str(Path(__file__).resolve()), "--worker", str(pdir),
                                    str(profiles), str(out), str(prev_manifest_dir) if prev_manifest_dir else "-"],
                                   cwd=pdir, env=dbt_env(profiles), capture_output=True, text=True, timeout=3600)
                if r.returncode != 0:
                    print(r.stdout[-4000:], r.stderr[-4000:], file=sys.stderr)
                    raise SystemExit(f"{key} {tag}: worker failed")
                ex = json.loads(out.read_text())
                files = git(spec["repo"], "ls-tree", "-r", "--name-only", tag).decode().splitlines()
                doc = {
                    "schema": 1, "key": key, "tag": tag, "project": spec["project"],
                    "dbt": "dbt-core 1.11.16, dbt-duckdb 1.11.0",
                    "files": sorted(files),
                    "patch_path": dict(sorted(ex["patch_path"].items())),
                    "empty": ex["empty"],
                    "hooks": ex["hooks"],
                    "ci": dict(sorted(ex["ci"].items())),
                    "state_prev": ({"prev_tag": prev_tag, **ex["state"]} if ex["state"] else None),
                    "dicts": dict(sorted(ex["dicts"].items())),
                    "selfcheck": ex["selfcheck"],
                }
                data = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
                (OUT / f"extras-{key}-{tag}.json").write_text(data, encoding="utf-8")
                # the exact default `dbt ls --output json` lines: test fixture only (not shipped to the browser)
                FIX.mkdir(parents=True, exist_ok=True)
                (FIX / f"lsjson-{key}-{tag}.json").write_text(
                    json.dumps(dict(sorted(ex["ls_json"].items())), ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
                print(f"{key}-{tag}: {len(doc['dicts'])} nodes, {len(doc['files'])} files, "
                      f"selfcheck={doc['selfcheck']['ok']}, state={'yes' if doc['state_prev'] else 'no'} "
                      f"({len(data) / 1024:.0f} KiB)", flush=True)
            # this tag's dev manifest becomes the state of the next tag
            mdir = work / "manifests" / key / tag
            mdir.mkdir(parents=True, exist_ok=True)
            mf = pdir / "target" / "manifest.json"
            if mf.exists():
                (mdir / "manifest.json").write_bytes(mf.read_bytes())
                prev_manifest_dir, prev_tag = mdir, tag
            elif not skip:
                raise SystemExit(f"{key} {tag}: no manifest.json")
    print(f"work folder: {work}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
