"""Re-run every golden selection command with the real dbt env at its tag and record the result.

    .venv-verify/.venv/bin/python -I converter/reference/golden_verify.py [--work DIR] [--only-tags ch16,m04]

For each entry of converter/golden/dbt-ls.json (written by golden_extract.py):
  * fresh copy of the project at the entry's tag (git archive, read-only for the book repo), dbt deps,
    fresh raw database (day 1) next to it, the book's profiles (profiles.example.yml of the repos)
  * the dbt part of the command is run exactly (same global flags, same args, same env vars except paths)
  * dbt ls: printed node lines (or JSON objects, or the count) are compared with the recorded output
    dbt build/run/test/seed/snapshot: the set of nodes in the 'N of M START/SKIP/NO-OP' lines is compared
  * a mismatch is retried at the previous and the next tag (logs are sometimes taken before the chapter's
    final commit, or after a temporary demo change); the result says where it matched
  * entries that need state artifacts (--state, --defer, state:/result:/source_status: methods) are not re-run

Writes the `verification` field of each entry back into converter/golden/dbt-ls.json and a summary
into converter/golden/verify-report.json. Entries are never deleted; mismatches are kept and labelled.
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ACADEMY, BIBLE, PROJECTS, archive, build_db, install_packages, run_dbt,  # noqa: E402
                    write_profiles)
from golden_extract import canon_desc, parse_ls_output, parse_run_output  # noqa: E402

GOLDEN = ACADEMY / "converter" / "golden"
BUGS = BIBLE / "labs" / "practice-project" / "bugs"
PATH_ENV = {"DBT_DUCKDB_PATH", "SHOPFLOW_DB_PATH", "DBT_PROFILES_DIR", "GITHUB_WORKSPACE", "DBT_PROJECT_DIR"}
WARN_KEYS = ["does not match any enabled nodes", "No nodes selected", "Using default selector"]


class TagDir:
    def __init__(self, key: str, tag: str, root: Path, profiles: Path):
        self.key, self.tag, self.root, self.profiles = key, tag, root, profiles
        spec = PROJECTS[key]
        self.base = root / key / tag
        self.project = self.base / spec["project"]
        self.db = self.base / spec["data_dir"] / spec["db_file"]
        self.ready = False
        self.dirty = False

    def prepare(self, force: bool = False) -> None:
        if self.ready and not force and not self.dirty:
            return
        spec = PROJECTS[self.key]
        archive(spec["repo"], self.tag, self.project)
        install_packages(self.project, self.profiles, self.root / "pkg-cache")
        if not self.db.exists():
            build_db(spec["setup_sql"], self.db)
        self.ready, self.dirty = True, False


def bug_patch_for(entry: dict) -> Path | None:
    if entry["project"] != "jaffle" or entry["tag"] != "ch22":
        return None
    m = re.search(r"\bBug (\d+)\b", entry.get("section") or "")
    if not m:
        return None
    n = int(m.group(1))
    hits = sorted(BUGS.glob(f"{n:02d}-*.patch"))
    return hits[0] if hits else None


def run_entry(entry: dict, td: TagDir) -> dict:
    td.prepare()
    patch = bug_patch_for(entry)
    if patch:
        subprocess.run(["git", "apply", str(patch)], cwd=td.project, check=True, capture_output=True)
        td.dirty = True
    argv = shlex.split(entry["dbt"])[1:]
    env = {k: v for k, v in (entry.get("env") or {}).items() if k not in PATH_ENV}
    r = run_dbt(argv, td.project, td.profiles, extra_env=env)
    if patch:
        td.prepare(force=True)
    lines = (r.stdout + ("\n" + r.stderr if r.stderr.strip() else "")).split("\n")
    return {"returncode": r.returncode, "lines": [l.rstrip() for l in lines], "patch": patch.name if patch else None}


def norm_json_line(s: str):
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return s


def compare(entry: dict, res: dict) -> dict:
    lines = res["lines"]
    if entry["kind"] == "ls":
        p = parse_ls_output(lines)
        got_warn = {k for k in WARN_KEYS if any(k in w for w in p["logs"])}
        exp_warn = {k for k in WARN_KEYS if any(k in w for w in entry.get("warnings") or [])}
        if entry["output_format"] == "count":
            nums = [x for x in p["nodes"] if re.fullmatch(r"\d+", x.strip())]
            # the count entry pipes into wc -l: count the lines dbt printed
            got = len(p["nodes"]) if not nums else int(nums[0])
            ok = got == entry["count"]
            return {"match": ok, "actual_count": got}
        exp = entry["selected"] or []
        got = p["nodes"]
        if entry["output_format"] == "json":
            e2 = [norm_json_line(x) for x in exp]
            g2 = [norm_json_line(x) for x in got]
            ok = e2 == g2
        else:
            ok = exp == got
            if not ok and entry.get("partial") and set(exp) <= set(got):
                ok = True
        err_ok = bool(entry.get("error")) == bool(p["error"])
        out = {"match": ok and err_ok and (exp_warn <= got_warn or not exp_warn)}
        if not ok:
            out["missing"] = [x for x in exp if x not in got]
            out["extra"] = [x for x in got if x not in exp]
            if not out["missing"] and not out["extra"]:
                out["order_differs"] = True
        if not err_ok:
            out["error_expected"] = (entry.get("error") or "")[:300]
            out["error_actual"] = (p["error"] or "")[:300]
        if exp_warn - got_warn:
            out["warnings_missing"] = sorted(exp_warn - got_warn)
        if entry.get("found_line") and p["found_line"]:
            fe = sorted(entry["found_line"].replace("Found ", "").split(", "))
            fg = sorted(p["found_line"].replace("Found ", "").split(", "))
            out["found_line_match"] = fe == fg
            if fe != fg:
                out["found_actual"] = p["found_line"]
        return out
    # run-like
    p = parse_run_output(lines)
    got = sorted({canon_desc(n["desc"]) for n in p["nodes"]})
    exp = entry.get("selected_canon") or []
    if entry.get("partial"):
        ok = set(exp) <= set(got)
    else:
        ok = got == exp
    out = {"match": ok, "actual_total": p["total"]}
    if not ok:
        out["missing"] = sorted(set(exp) - set(got))
        out["extra"] = sorted(set(got) - set(exp))
    if entry.get("total") is not None and p["total"] is not None and entry["total"] != p["total"]:
        out["total_expected"] = entry["total"]
    if entry.get("summary") and p["summary"]:
        out["summary_actual"] = p["summary"]
    return out


def neighbours(key: str, tag: str) -> list[str]:
    tags = PROJECTS[key]["tags"]
    i = tags.index(tag)
    return [t for t in (tags[i - 1] if i > 0 else None, tags[i + 1] if i + 1 < len(tags) else None) if t]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=None)
    ap.add_argument("--only-tags", default=None)
    ap.add_argument("--no-retry", action="store_true")
    a = ap.parse_args()
    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="mc-verify-"))
    work.mkdir(parents=True, exist_ok=True)
    profiles = write_profiles(work)
    path = GOLDEN / "dbt-ls.json"
    entries = json.loads(path.read_text())
    only = set(a.only_tags.split(",")) if a.only_tags else None
    dirs: dict[tuple[str, str], TagDir] = {}

    def tagdir(key: str, tag: str) -> TagDir:
        if (key, tag) not in dirs:
            dirs[(key, tag)] = TagDir(key, tag, work, profiles)
        return dirs[(key, tag)]

    # run in source order inside each tag (like the chapter), tags in order
    order = sorted(range(len(entries)), key=lambda i: (entries[i]["project"], entries[i]["tag"],
                                                         entries[i]["source"].rsplit(":", 1)[0],
                                                         int(entries[i]["source"].rsplit(":", 1)[1])))
    for i in order:
        e = entries[i]
        if only and e["tag"] not in only:
            continue
        v: dict = {"dbt": "dbt-core 1.11.16 + dbt-duckdb 1.11.0 + duckdb 1.5.6", "tag_run": e["tag"]}
        if e["state_dependent"]:
            v.update(status="not_rerun", reason="needs the state/result artifacts of the chapter "
                                                "(--state, --defer, state:, result:, source_status:)")
            e["verification"] = v
            continue
        if (e.get("error") or "").startswith(("zsh:", "bash:")):
            v.update(status="not_rerun", reason="shell error (zsh globbing): dbt never ran")
            e["verification"] = v
            continue
        dropped = sorted(k for k in (e.get("env") or {}) if k in PATH_ENV)
        if dropped:
            v["env_dropped"] = dropped
        td = tagdir(e["project"], e["tag"])
        try:
            res = run_entry(e, td)
        except subprocess.TimeoutExpired:
            v.update(status="error", reason="timeout")
            e["verification"] = v
            continue
        if res["patch"]:
            v["bug_patch_applied"] = res["patch"]
        cmp = compare(e, res)
        v["returncode"] = res["returncode"]
        v.update(cmp)
        if cmp["match"]:
            v["status"] = "ok"
        else:
            v["status"] = "mismatch"
            if not a.no_retry:
                for nt in neighbours(e["project"], e["tag"]):
                    res2 = run_entry(e, tagdir(e["project"], nt))
                    c2 = compare(e, res2)
                    if c2["match"]:
                        v["status"] = "ok_other_tag"
                        v["matched_tag"] = nt
                        v["reason"] = (f"the log was taken at an intermediate state of the chapter: the output "
                                       f"equals the project at {nt}")
                        break
        e["verification"] = v
        print(f"{e['id']:<16} {e['tag']:<5} {v['status']:<13} {e['dbt'][:100]}", flush=True)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    st = Counter(e.get("verification", {}).get("status", "missing") for e in entries)
    by_origin = {}
    for e in entries:
        by_origin.setdefault(e["origin"], Counter())[e.get("verification", {}).get("status", "missing")] += 1
    rep = {
        "entries": len(entries),
        "status": dict(sorted(st.items())),
        "by_origin": {k: dict(sorted(v.items())) for k, v in sorted(by_origin.items())},
        "by_kind": {k: dict(sorted(Counter(e.get("verification", {}).get("status", "missing")
                                           for e in entries if e["kind"] == k).items()))
                    for k in sorted({e["kind"] for e in entries})},
        "mismatches": [{"id": e["id"], "source": e["source"], "tag": e["tag"], "command": e["command"],
                        "notes": e["notes"], "missing": e["verification"].get("missing"),
                        "extra": e["verification"].get("extra"),
                        "error_expected": e["verification"].get("error_expected"),
                        "error_actual": e["verification"].get("error_actual")}
                       for e in entries if e.get("verification", {}).get("status") == "mismatch"],
    }
    (GOLDEN / "verify-report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({k: v for k, v in rep.items() if k != "mismatches"}, indent=1))
    print(f"work folder: {work}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
