"""Re-run every golden selection command with the real dbt env and record the result in the golden file.

    .venv-verify/.venv/bin/python -I converter/reference/golden_verify.py [--work DIR] [--only-tags ch16,m04]

For each entry of converter/golden/dbt-ls.json (written by golden_extract.py):
  * fresh copy of the project at the entry's tag (git archive; the book repo is only read), dbt deps, a fresh raw
    database (day 1) next to it, the book's profiles (profiles.example.yml of the repos). For dbt build/run/test/
    seed/snapshot entries the database is first prepared with `dbt build --exclude-resource-type unit_test` at that
    revision, so that the nodes print START lines (not SKIP lines) like in the chapter.
  * the dbt part of the command is run exactly (same global flags, args, env vars; paths in env vars dropped)
  * dbt ls: printed node lines (or JSON objects, or the count) are compared with the recorded output;
    run-like commands: the set of nodes of the 'N of M' lines (mapped to node names with the tag's DAG export)
  * documented temporary demo edits of the book are re-applied when an entry belongs to them (DEMO_EDITS)
  * a mismatch is retried at other revisions: the previous/next tag, the commits between them, and every tag
    whose DAG contains all the expected nodes ("ok_other_tag": the log was taken at that state)
  * still different: "intermediate_state" when the chapter log/book says it was a temporary state (ANNOTATIONS,
    with the reason), otherwise "mismatch"
  * state-dependent entries (--state, --defer, state:/result:/source_status:) are not re-run ("not_rerun")

Writes the `verification` field (+ `unique_ids` of the selected nodes when they can be resolved) into
converter/golden/dbt-ls.json and a summary into converter/golden/verify-report.json.
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ACADEMY, BIBLE, PROJECTS, archive, build_db, git, install_packages, run_dbt,  # noqa: E402
                    write_profiles)
from golden_extract import canon_desc, parse_ls_output, parse_run_output  # noqa: E402

GOLDEN = ACADEMY / "converter" / "golden"
DAGS = ACADEMY / "site" / "src" / "generated" / "dag"
BUGS = BIBLE / "labs" / "practice-project" / "bugs"
PATH_ENV = {"DBT_DUCKDB_PATH", "SHOPFLOW_DB_PATH", "DBT_PROFILES_DIR", "GITHUB_WORKSPACE", "DBT_PROJECT_DIR"}
WARN_KEYS = ["does not match any enabled nodes", "No nodes selected", "Using default selector"]
RUNLIKE = {"build", "run", "test", "seed", "snapshot", "clone"}

# Temporary edits that the book/logs describe and that are cheap to re-apply exactly.
DEMO_EDITS = {
    "ch16-two-parent-test": {
        "tag": "ch16",
        "why": "Chapter 16 adds a TEMPORARY relationships test under fct_orders.customer_id for the indirect "
               "selection demo (book text, section 'The four modes on a real two-parent test')",
        "match": lambda e: e["origin"] == "book" and "ch16-commands-selection" in e["source"]
        and e["section"] in ("The four modes on a real two-parent test", "Why the default can surprise you"),
        "edits": [("models/marts/_marts__models.yml", "insert_after",
                   "        owner: finance-team\n        contains_pii: false\n",
                   "    columns:\n      - name: customer_id\n        data_tests:\n          - relationships:\n"
                   "              arguments:\n                to: ref('stg_jaffle_shop__customers')\n"
                   "                field: customer_id\n")],
    },
    "ch16-default-selector": {
        "tag": "ch16",
        "why": "Chapter 16 adds a TEMPORARY fifth selector dev_default (default: \"{{ target.name == 'dev' }}\", "
               "definition 'tag:finance'), book section 'The default selector'",
        "match": lambda e: e["origin"] == "book" and "ch16-commands-selection" in e["source"]
        and e["section"] == "The default selector",
        "edits": [("selectors.yml", "append", None,
                   "\n  - name: dev_default\n    description: TEMPORARY demo - used when no selection is given, in dev only.\n"
                   "    default: \"{{ target.name == 'dev' }}\"\n    definition: 'tag:finance'\n")],
    },
    "ch10-default-schema-macro": {
        "tag": "ch10",
        "why": "Chapter 10 first shows +schema with dbt's DEFAULT generate_schema_name (before the project's own "
               "macros/generate_schema_name.sql is added): schemas dbt_adnane_marts / prod_marts",
        "match": lambda e: e["tag"] == "ch10" and (
            "DEFAULT generate_schema_name" in e["section"] or e["section"] == "Custom databases and aliases"),
        "edits": [("macros/generate_schema_name.sql", "delete", None, None)],
    },
}

# Entries that stay different from every tag: the log or the book says they were taken in a temporary state.
# key: (file name, command prefix) -> reason
ANNOTATIONS = {
    ("ch06.md", "dbt run"): "the two dbt init example models, deleted before the ch06 commit",
    ("ch06.md", "dbt test"): "the tests of the two dbt init example models, deleted before the ch06 commit",
    ("ch08.md", "dbt run --select mv_orders_by_status"): "demo model, not committed (log section 'Demo (not committed)')",
    ("ch10.md", "dbt run --select fct_monthly_revenue"): "alias demo, reverted afterwards (log section 6)",
    ("ch10.md", "dbt ls --select fct_monthly_revenue --output json"): "alias demo, reverted afterwards (log section 6)",
    ("ch10.md", "dbt run"): "on-run-start/end hook demo, removed at the end of Chapter 10 (log section 7)",
    ("ch10.md", "dbt test --select stg_jaffle_shop__orders"): "on-run-start/end hook demo, removed afterwards",
    ("ch13.md", "dbt snapshot --select legacy_customers_snapshot"): "throwaway copy: legacy SQL snapshot demo",
    ("ch13.md", "dbt snapshot --select customers_snapshot_custom"): "throwaway copy: snapshot config demo",
    ("ch16.md", "dbt build --select staging"): "temporary singular test tests/demo_always_fails.sql (log section 9)",
    ("ch17.md", "dbt ls --resource-type model --output json --output-keys name config.group"):
        "taken before dim_customers became versioned (v1/v2 added later in Chapter 17)",
    ("ch17.md", "dbt ls --select dim_customers --resource-type model --output json --output-keys name version latest_version alias"):
        "taken while latest_version was still 1 (Chapter 17 promotes v2 afterwards)",
    ("ch17.md", "dbt ls --select version:latest version:prerelease"): "taken while latest_version was still 1",
    ("ch17.md", "dbt run --select demo_uses_v1"): "temporary model demo_uses_v1 (deleted in Chapter 17)",
    ("ch18.md", "dbt build"): "relationships test still failing (thresholds added later in Chapter 18): the "
                              "children are SKIPPED, and SKIP lines name versioned models without the version",
    ("ch23.md", "dbt run"): "a model made to fail on purpose (demo, reverted)",
    ("ch23.md", "dbt build --exclude-resource-type unit_test"): "temporary failing singular test demo_enriched_orders_fail",
    ("m06.md", "dbt build"): "DEMO steps of milestone m06 (severity configs removed temporarily)",
    ("m13.md", "dbt build --target prod --selector nightly"): "production = main BEFORE the feature "
                                                              "(fct_sessions without is_bounce), log section title",
    ("ch07-models-sources-dag.tex", "dbt run"): "taken before the marts were written (5 staging models)",
    ("ch08-materializations.tex", "dbt ls --select config.materialized:view"): "taken before the marts folder config "
                                                                               "(+materialized: table) was added",
    ("ch09-modularity-refactoring.tex", "dbt ls --select +legacy_monthly_revenue+"): "legacy model of the intermediate "
                                                                                    "commit (removed in the ch09 tag)",
    ("ch10-configuration.tex", "dbt ls -s intermediate --output json"): "book output abbreviated (selected keys) and "
                                                                        "taken with a temporary meta config",
    ("ch10-configuration.tex", "dbt run"): "hook / custom schema demos of Chapter 10 (temporary)",
    ("ch11-jinja-macros-packages.tex", "dbt ls -s 1+tmp_comment_demo"): "temporary model tmp_comment_demo",
    ("ch11-jinja-macros-packages.tex", "dbt ls -s fct_orders"): "temporary require-dbt-version: [\">=1.12.0\", \"<2.0.0\"]",
    ("ch14-incremental-microbatch.tex", "dbt run --select playground"): "lab 14.2: temporary models/playground/ "
                                                                         "folder (toy_* models)",
    ("ch16-commands-selection.tex", "dbt build -s stg_stripe__payments+"): "temporary failing test demo_payment_check",
    ("ch16-commands-selection.tex", "dbt build --select staging tests/demo_always_fails.sql"): "temporary test demo_always_fails",
    ("ch16-commands-selection.tex", "dbt ls --select fct_orders"): "run right after `dbt clean` (dbt_packages deleted)",
}


def annotation(e: dict) -> str | None:
    fname = e["source"].rsplit(":", 1)[0].split("/")[-1]
    best = None
    for (f, prefix), why in ANNOTATIONS.items():
        if f == fname and e["command"].startswith(prefix):
            if best is None or len(prefix) > len(best[0]):
                best = (prefix, why)
    return best[1] if best else None


def demo_edit_for(e: dict) -> str | None:
    for k, d in DEMO_EDITS.items():
        if d["tag"] == e["tag"] and d["match"](e):
            return k
    return None


def apply_edits(project: Path, key: str) -> None:
    for path, how, anchor, text in DEMO_EDITS[key]["edits"]:
        p = project / path
        if how == "delete":
            p.unlink()
        elif how == "append":
            p.write_text(p.read_text() + text)
        elif how == "insert_after":
            s = p.read_text()
            if anchor not in s:
                raise RuntimeError(f"demo edit {key}: anchor not found in {path}")
            p.write_text(s.replace(anchor, anchor + text, 1))


class RevDir:
    """A project copy at one revision (tag or commit), optionally with a demo edit, with its own database."""

    def __init__(self, key: str, rev: str, edit: str | None, root: Path, profiles: Path):
        self.key, self.rev, self.edit, self.root, self.profiles = key, rev, edit, root, profiles
        spec = PROJECTS[key]
        self.base = root / key / (rev + (f"+{edit}" if edit else ""))
        self.project = self.base / spec["project"]
        self.db = self.base / spec["data_dir"] / spec["db_file"]
        self.ready = False
        self.dirty = False
        self.prepped = False

    def prepare(self) -> None:
        if self.ready and not self.dirty:
            return
        spec = PROJECTS[self.key]
        archive(spec["repo"], self.rev, self.project)
        if self.edit:
            apply_edits(self.project, self.edit)
        install_packages(self.project, self.profiles, self.root / "pkg-cache")
        if not self.db.exists():
            build_db(spec["setup_sql"], self.db)
        self.ready, self.dirty = True, False

    def prep_db(self) -> None:
        """Build everything once (no unit tests), like the state of the chapter, so later logs show START lines."""
        if self.prepped:
            return
        self.prepare()
        run_dbt(["build", "--exclude-resource-type", "unit_test"], self.project, self.profiles)
        self.prepped = True


def bug_patch_for(entry: dict) -> Path | None:
    if entry["project"] != "jaffle" or entry["tag"] != "ch22":
        return None
    m = re.search(r"\bBug (\d+)\b", entry.get("section") or "")
    if not m:
        return None
    hits = sorted(BUGS.glob(f"{int(m.group(1)):02d}-*.patch"))
    return hits[0] if hits else None


def run_entry(entry: dict, rd: RevDir) -> dict:
    if entry["kind"] in RUNLIKE:
        rd.prep_db()
    rd.prepare()
    patch = bug_patch_for(entry)
    if patch:
        subprocess.run(["git", "apply", str(patch)], cwd=rd.project, check=True, capture_output=True)
        rd.dirty = True
    argv = shlex.split(entry["dbt"])[1:]
    env = {k: v for k, v in (entry.get("env") or {}).items() if k not in PATH_ENV}
    r = run_dbt(argv, rd.project, rd.profiles, extra_env=env)
    if patch:
        rd.prepare()
    lines = (r.stdout + ("\n" + r.stderr if r.stderr.strip() else "")).split("\n")
    return {"returncode": r.returncode, "lines": [l.rstrip() for l in lines], "patch": patch.name if patch else None}


# ---------------------------------------------------------------------------------------------- DAG lookups
_dag_cache: dict[str, dict] = {}


def dag(key: str, tag: str) -> dict | None:
    k = f"{key}-{tag}"
    if k not in _dag_cache:
        p = DAGS / f"{k}.json"
        _dag_cache[k] = json.loads(p.read_text()) if p.exists() else None
    return _dag_cache[k]


def name_of_canon(c: str, d: dict | None) -> str:
    """'rel:dbt_adnane.dim_customers_v1' -> 'dim_customers' (model name), 'test:x' -> 'x' ..."""
    kind, _, val = c.partition(":")
    if kind == "unit_test":
        # START lines of a versioned model's unit test say "<name>_v2", SKIP lines only "<name>"
        return "unit_test:" + re.sub(r"_v[0-9]+$", "", val)
    if kind != "rel":
        return f"{kind}:{val}"
    ident = val.split(".")[-1]
    if d:
        for n in d["nodes"]:
            if n["resource_type"] in ("model", "seed", "snapshot") and (n.get("alias") == ident or n["name"] == ident):
                return f"node:{n['name']}"
    return f"node:{re.sub(r'_v[0-9]+$', '', ident)}"


def unique_ids_for(e: dict, d: dict | None) -> list[str] | None:
    if not d or e.get("selected") is None:
        return None
    every = d["nodes"] + d["sources"] + d["exposures"]
    if e["kind"] == "ls":
        fmt = e["output_format"]
        if fmt == "selector":
            idx = {n["ls"]: n["unique_id"] for n in every}
        elif fmt == "name":
            idx = {}
            for n in every:
                idx.setdefault(n["search_name"], n["unique_id"])
        else:
            return None
        ids = [idx.get(x) for x in e["selected"]]
        return ids if all(ids) else None
    out = []
    for c in e.get("selected_canon") or []:
        kind, _, val = c.partition(":")
        hit = None
        if kind == "rel":
            ident = val.split(".")[-1]
            hits = [n["unique_id"] for n in d["nodes"] if n["resource_type"] in ("model", "seed", "snapshot")
                    and n.get("alias") == ident]
            hit = hits[0] if len(hits) == 1 else None
        elif kind == "test":
            hits = [n["unique_id"] for n in d["nodes"] if n["resource_type"] == "test" and n["name"] == val]
            hit = hits[0] if len(hits) == 1 else None
        elif kind == "unit_test":
            hits = [n["unique_id"] for n in d["nodes"] if n["resource_type"] == "unit_test" and n["name"] == val]
            hit = hits[0] if len(hits) == 1 else None
        elif kind == "exposure":
            hits = [x["unique_id"] for x in d["exposures"] if x["name"] == val]
            hit = hits[0] if len(hits) == 1 else None
        if not hit:
            return None
        out.append(hit)
    return sorted(out)


def expected_names(e: dict) -> set[str]:
    if e["kind"] == "ls":
        if e["output_format"] in ("selector", "name"):
            return {x.split(".")[-1] if e["output_format"] == "selector" else x for x in e["selected"] or []}
        return set()
    return {c.partition(":")[2].split(".")[-1] for c in e.get("selected_canon") or []}


def tags_containing(e: dict) -> list[str]:
    names = expected_names(e)
    if not names:
        return []
    out = []
    for tag in PROJECTS[e["project"]]["tags"]:
        d = dag(e["project"], tag)
        if not d:
            continue
        have = set()
        for n in d["nodes"] + d["sources"] + d["exposures"]:
            have.update({n["name"], n.get("alias") or n["name"], n["ls"].split(".")[-1], n["search_name"]})
        if names <= have:
            out.append(tag)
    return out


def candidates(e: dict) -> list[str]:
    key, tag = e["project"], e["tag"]
    tags = PROJECTS[key]["tags"]
    i = tags.index(tag)
    revs = []
    if i > 0:
        revs.append(tags[i - 1])
    if i + 1 < len(tags):
        revs.append(tags[i + 1])
    repo = PROJECTS[key]["repo"]
    for a, b in ((tags[i - 1] if i > 0 else None, tag), (tag, tags[i + 1] if i + 1 < len(tags) else None)):
        if a and b:
            for h in git(repo, "rev-list", "--reverse", f"{a}..{b}").decode().split():
                if h != git(repo, "rev-parse", f"{b}^{{commit}}").decode().strip():
                    revs.append(h)
    for t in tags_containing(e):
        if t != tag and t not in revs:
            revs.append(t)
    return revs[:5] if e["kind"] in RUNLIKE else revs[:8]


# ---------------------------------------------------------------------------------------------- comparison
def norm_json_line(s: str):
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return s


def compare(e: dict, res: dict, d: dict | None) -> dict:
    lines = res["lines"]
    if e["kind"] == "ls":
        p = parse_ls_output(lines)
        got_warn = {k for k in WARN_KEYS if any(k in w for w in p["logs"])}
        exp_warn = {k for k in WARN_KEYS if any(k in w for w in e.get("warnings") or [])}
        if e["output_format"] == "count":
            got = len(p["nodes"])
            return {"match": got == e["count"], "actual_count": got}
        exp = e["selected"] or []
        got = p["nodes"]
        if e["output_format"] == "json":
            ok = [norm_json_line(x) for x in exp] == [norm_json_line(x) for x in got]
        else:
            ok = exp == got
        subset = (not ok) and bool(exp) and all(x in got for x in exp)
        if not ok and e.get("partial") and subset:
            ok = True
        err_ok = bool(e.get("error")) == bool(p["error"])
        out = {"match": ok and err_ok and (exp_warn <= got_warn or not exp_warn)}
        if not ok:
            out["missing"] = [x for x in exp if x not in got]
            out["extra"] = [x for x in got if x not in exp][:40]
            if not out["missing"] and not out["extra"]:
                out["order_differs"] = True
            out["subset"] = subset
        if not err_ok:
            out["error_expected"] = (e.get("error") or "")[:300]
            out["error_actual"] = (p["error"] or "")[:300]
        if exp_warn - got_warn:
            out["warnings_missing"] = sorted(exp_warn - got_warn)
        if e.get("found_line") and p["found_line"]:
            fe = sorted(e["found_line"].replace("Found ", "").split(", "))
            fg = sorted(p["found_line"].replace("Found ", "").split(", "))
            out["found_line_match"] = fe == fg
        return out
    p = parse_run_output(lines)
    got = sorted({name_of_canon(canon_desc(n["desc"]), d) for n in p["nodes"]})
    exp = sorted({name_of_canon(c, d) for c in e.get("selected_canon") or []})
    ok = set(exp) <= set(got) if e.get("partial") else got == exp
    out = {"match": ok, "actual_total": p["total"]}
    if not ok:
        out["missing"] = sorted(set(exp) - set(got))
        out["extra"] = sorted(set(got) - set(exp))[:40]
    if e.get("total") is not None and p["total"] is not None and e["total"] != p["total"]:
        out["total_expected"] = e["total"]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=None)
    ap.add_argument("--only-tags", default=None)
    ap.add_argument("--only-ids", default=None)
    a = ap.parse_args()
    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="mc-verify-"))
    work.mkdir(parents=True, exist_ok=True)
    profiles = write_profiles(work)
    path = GOLDEN / "dbt-ls.json"
    entries = json.loads(path.read_text())
    only = set(a.only_tags.split(",")) if a.only_tags else None
    only_ids = set(a.only_ids.split(",")) if a.only_ids else None
    dirs: dict[tuple, RevDir] = {}

    def revdir(key: str, rev: str, edit: str | None) -> RevDir:
        k = (key, rev, edit)
        if k not in dirs:
            dirs[k] = RevDir(key, rev, edit, work, profiles)
        return dirs[k]

    order = sorted(range(len(entries)), key=lambda i: (entries[i]["project"], entries[i]["tag"],
                                                         entries[i]["source"].rsplit(":", 1)[0],
                                                         int(entries[i]["source"].rsplit(":", 1)[1])))
    for i in order:
        e = entries[i]
        if (only and e["tag"] not in only) or (only_ids and e["id"] not in only_ids):
            continue
        d = dag(e["project"], e["tag"])
        v: dict = {"dbt": "dbt-core 1.11.16 + dbt-duckdb 1.11.0 + duckdb 1.5.6", "tag_run": e["tag"]}
        if e["state_dependent"]:
            v.update(status="not_rerun", reason="needs the state/result artifacts of the chapter "
                                                "(--state, --defer, state:, result:, source_status:)")
            e["verification"] = v
            e["unique_ids"] = unique_ids_for(e, d)
            continue
        if (e.get("error") or "").startswith(("zsh:", "bash:")):
            v.update(status="not_rerun", reason="shell error (zsh globbing): dbt never ran")
            e["verification"] = v
            e["unique_ids"] = None
            continue
        dropped = sorted(k for k in (e.get("env") or {}) if k in PATH_ENV)
        if dropped:
            v["env_dropped"] = dropped
        edit = demo_edit_for(e)
        if edit:
            v["demo_edit"] = edit
            v["demo_edit_why"] = DEMO_EDITS[edit]["why"]
        try:
            res = run_entry(e, revdir(e["project"], e["tag"], edit))
        except subprocess.TimeoutExpired:
            v.update(status="error", reason="timeout")
            e["verification"] = v
            continue
        if res["patch"]:
            v["bug_patch_applied"] = res["patch"]
        cmp = compare(e, res, d)
        v["returncode"] = res["returncode"]
        v.update(cmp)
        matched_rev = e["tag"]
        if cmp["match"]:
            v["status"] = "ok"
        else:
            v["status"] = "mismatch"
            for rev in candidates(e):
                res2 = run_entry(e, revdir(e["project"], rev, None))
                c2 = compare(e, res2, dag(e["project"], rev) if rev in PROJECTS[e["project"]]["tags"] else d)
                if c2["match"]:
                    is_tag = rev in PROJECTS[e["project"]]["tags"]
                    v["status"] = "ok_other_tag"
                    v["matched_rev"] = rev
                    v["reason"] = (f"the output equals the project at {'tag ' + rev if is_tag else 'commit ' + rev[:7]}: "
                                   f"the log was taken at that state")
                    matched_rev = rev if is_tag else e["tag"]
                    break
            if v["status"] == "mismatch":
                why = annotation(e)
                if why:
                    v["status"] = "intermediate_state"
                    v["reason"] = why + " (not reproducible from any tag)"
                elif e["kind"] == "ls" and e["origin"] == "book" and cmp.get("subset") and not cmp.get("missing"):
                    v["status"] = "ok_excerpt"
                    v["reason"] = "every printed line is in the real output; the book shows an excerpt"
        e["verification"] = v
        e["unique_ids"] = unique_ids_for(e, dag(e["project"], matched_rev))
        print(f"{e['id']:<16} {e['tag']:<5} {v['status']:<18} {e['dbt'][:95]}", flush=True)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    st = Counter(e.get("verification", {}).get("status", "missing") for e in entries)
    by_origin: dict = {}
    for e in entries:
        by_origin.setdefault(e["origin"], Counter())[e.get("verification", {}).get("status", "missing")] += 1
    book16 = [e for e in entries if e["origin"] == "book" and e["tag"] == "ch16"]
    rep = {
        "entries": len(entries),
        "status": dict(sorted(st.items())),
        "status_meaning": {
            "ok": "re-run at the entry's tag (with the documented demo edit when there is one): same nodes",
            "ok_other_tag": "same nodes at another tag/commit: the log was taken at that state",
            "ok_excerpt": "book excerpt: every printed node is in the real output",
            "intermediate_state": "different from every tag; the log/book says it was a temporary state (reason)",
            "mismatch": "different, no explanation found",
            "not_rerun": "needs the chapter's state artifacts, or a shell error before dbt ran",
        },
        "by_origin": {k: dict(sorted(v.items())) for k, v in sorted(by_origin.items())},
        "book_ch16": dict(sorted(Counter(e["verification"]["status"] for e in book16 if "verification" in e).items())),
        "by_kind": {k: dict(sorted(Counter(e.get("verification", {}).get("status", "missing")
                                           for e in entries if e["kind"] == k).items()))
                    for k in sorted({e["kind"] for e in entries})},
        "with_unique_ids": sum(1 for e in entries if e.get("unique_ids")),
        "not_ok": [{"id": e["id"], "status": e["verification"]["status"], "source": e["source"], "tag": e["tag"],
                    "command": e["command"], "reason": e["verification"].get("reason"),
                    "missing": e["verification"].get("missing"), "extra": e["verification"].get("extra"),
                    "error_expected": e["verification"].get("error_expected"),
                    "error_actual": e["verification"].get("error_actual")}
                   for e in entries if e.get("verification", {}).get("status") in ("mismatch", "intermediate_state")],
    }
    (GOLDEN / "verify-report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({k: v for k, v in rep.items() if k not in ("not_ok", "status_meaning")}, indent=1))
    print(f"work folder: {work}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
