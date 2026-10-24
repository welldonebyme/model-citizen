"""Export DAGs of the intermediate project states that some golden entries were recorded in (test fixtures only).

    .venv-verify/.venv/bin/python -I -B site/tests/selector/tools/export_variants.py [--work DIR]

The golden verifier (converter/reference/golden_verify.py, read-only here) re-ran some entries on a tag plus a
documented temporary edit of the book (DEMO_EDITS), or on a commit between two tags. To test the engine on
those entries with the same kind of data, this script builds the DAG (same format as export_dags.py, by calling
its export_tag with a patched checkout step) and the extras (export_extras.py worker) of each such state:

    site/tests/selector/fixtures/variants/<key>-<rev>[+<edit>].json        (DAG)
    site/tests/selector/fixtures/variants/extras-<key>-<rev>[+<edit>].json (extras, no state comparison)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parents[2]
ACADEMY = SITE.parent
OUT = SITE / "tests" / "selector" / "fixtures" / "variants"
sys.path.insert(0, str(ACADEMY / "converter" / "reference"))
import export_dags  # noqa: E402
import golden_verify  # noqa: E402
from common import PROJECTS, PY, archive, dbt_env, install_packages, write_profiles  # noqa: E402

VARIANTS = [
    ("jaffle", "ch10", "ch10-default-schema-macro"),
    ("jaffle", "ch16", "ch16-two-parent-test"),
    ("jaffle", "ch16", "ch16-default-selector"),
    ("jaffle", "ea74932", None),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=None)
    a = ap.parse_args()
    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="mc-var-"))
    work.mkdir(parents=True, exist_ok=True)
    profiles = write_profiles(work)
    OUT.mkdir(parents=True, exist_ok=True)
    for key, rev, edit in VARIANTS:
        name = f"{key}-{rev}" + (f"+{edit}" if edit else "")
        spec = PROJECTS[key]

        def prepare(k, tag, w, prof, _edit=edit):
            pdir = w / k / name / spec["project"]
            archive(spec["repo"], tag, pdir)
            if _edit:
                golden_verify.apply_edits(pdir, _edit)
            install_packages(pdir, prof, w / "pkg-cache")
            return pdir

        export_dags.prepare_tag = prepare
        real_run_dbt = export_dags.run_dbt

        def run_dbt(args, *rest, **kw):
            # a default selector changes what a bare `dbt ls` lists: give the default includes explicitly
            if args == ["ls", "--resource-type", "all"]:
                args = args + ["--select", "fqn:*", "source:*", "exposure:*", "metric:*", "semantic_model:*"]
            return real_run_dbt(args, *rest, **kw)

        export_dags.run_dbt = run_dbt
        try:
            d = export_dags.export_tag(key, rev, work, profiles)
        finally:
            export_dags.run_dbt = real_run_dbt
        d.pop("_parse_log_tail", None)
        d["variant"] = {"rev": rev, "edit": edit, "why": golden_verify.DEMO_EDITS[edit]["why"] if edit else
                        "commit between two tags (golden_verify ok_other_tag)"}
        (OUT / f"{name}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n")
        pdir = work / key / name / spec["project"]
        out = work / f"extras-{name}.json"
        r = subprocess.run([str(PY), "-I", "-B", str(HERE / "export_extras.py"), "--worker", str(pdir), str(profiles),
                            str(out), "-"], cwd=pdir, env=dbt_env(profiles), capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-3000:], r.stderr[-3000:], file=sys.stderr)
            raise SystemExit(f"{name}: extras worker failed")
        ex = json.loads(out.read_text())
        files = subprocess.run(["git", "-C", str(spec["repo"]), "ls-tree", "-r", "--name-only", rev],
                               capture_output=True, text=True, check=True).stdout.splitlines()
        # files of the edited checkout (an edit may add or delete files)
        if edit:
            files = sorted(str(p.relative_to(pdir)) for p in pdir.rglob("*") if p.is_file()
                           and not any(part in ("target", "logs", "dbt_packages") for part in p.relative_to(pdir).parts))
        doc = {"schema": 1, "key": key, "tag": rev, "project": spec["project"], "files": sorted(files),
               "patch_path": ex["patch_path"], "empty": ex["empty"], "hooks": ex["hooks"], "ci": ex["ci"],
               "state_prev": None, "dicts": ex["dicts"], "selfcheck": ex["selfcheck"]}
        (OUT / f"extras-{name}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
        print(f"{name}: {len(d['nodes'])} nodes, selfcheck={ex['selfcheck']['ok']}", flush=True)
    print(f"work folder: {work}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
