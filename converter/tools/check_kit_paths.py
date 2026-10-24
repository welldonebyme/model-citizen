"""Install the kits in a temporary HOME and check that every path the website shows exists there.

    converter/.venv/bin/python -m converter.tools.check_kit_paths [--work DIR] [--no-install]

1. unzips site/public/kits/dbt-course-kit.zip and shopflow-capstone-kit.zip and runs their setup.sh (macOS/Linux)
   with HOME = <work>/home (uv caches are reused; the real ~/dbt-course and ~/.dbt are never touched)
2. collects every path that starts at the learner's home in the generated content (site/src/generated: chapters,
   questions, mocks; prose, inline code, code blocks, titles and the Windows/WSL variants of code blocks):
   ~/..., /Users/you/..., $HOME\\... (Windows variants)
3. each path must exist in the installed kit, or match an entry of `created_by_labs` in converter/rules/paths.yaml
   (a path that a lab step creates, or that is wrong on purpose, with the step that explains it)

Writes converter/golden/kit-paths.json (every path, where it is used, and its status) and exits 1 on a missing path.
"""
from __future__ import annotations

import argparse
import fnmatch
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import yaml

from ..config import ACADEMY, OUT, RULES

KITS = ACADEMY / "site" / "public" / "kits"
REPORT = ACADEMY / "converter" / "golden" / "kit-paths.json"
PATH_RE = re.compile(r"(?:(?<![\w$])~|/Users/you|\$HOME)(?:[/\\][^\s\"'`<>|;,()\[\]{}]*)?")


def install(work: Path) -> Path:
    home = work / "home"
    home.mkdir(parents=True, exist_ok=True)
    unzip = work / "unzip"
    for z in ("dbt-course-kit.zip", "shopflow-capstone-kit.zip"):
        with zipfile.ZipFile(KITS / z) as zf:
            zf.extractall(unzip)
    env = {k: v for k, v in os.environ.items() if not k.startswith("DBT_")}
    real_home = os.environ["HOME"]
    env.update(HOME=str(home), DBT_SEND_ANONYMOUS_USAGE_STATS="false", DBT_USE_COLORS="false",
               UV_CACHE_DIR=env.get("UV_CACHE_DIR", f"{real_home}/.cache/uv"),
               UV_PYTHON_INSTALL_DIR=env.get("UV_PYTHON_INSTALL_DIR", f"{real_home}/.local/share/uv/python"))
    for kit in ("dbt-course-kit", "shopflow-capstone-kit"):
        r = subprocess.run(["bash", str(unzip / kit / "setup.sh")], env=env, capture_output=True, text=True)
        (work / f"{kit}-setup.log").write_text(r.stdout + r.stderr)
        if r.returncode != 0:
            raise SystemExit(f"{kit}/setup.sh failed (see {work}/{kit}-setup.log)")
    return home


def strings(obj, where: str, out: list):
    """(where, kind, text) of every rendered string, code text and variant."""
    if isinstance(obj, dict):
        wid = obj.get("id") if isinstance(obj.get("id"), str) else None
        here = f"{where}#{wid}" if wid and obj.get("t") == "code" else where
        for k, v in obj.items():
            if k in ("textBook", "titleBook", "keyRaw", "href", "src", "id"):
                continue
            if k == "variants" and isinstance(v, dict):
                for os_name, text in v.items():
                    out.append((here, f"variant:{os_name}", text))
                continue
            if isinstance(v, str):
                out.append((here, k, v))
            else:
                strings(v, here, out)
    elif isinstance(obj, list):
        for v in obj:
            strings(v, where, out)


def normalise(token: str) -> tuple[str, str]:
    """('~/dbt-course/kit/bugs', display) from any of the three forms; trailing punctuation removed."""
    t = token.rstrip(".:*\\/").rstrip(".")
    if t.startswith("$HOME"):
        t = "~" + t[len("$HOME"):].replace("\\", "/")
    elif t.startswith("/Users/you"):
        t = "~" + t[len("/Users/you"):]
    return t, token


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=None)
    ap.add_argument("--no-install", action="store_true", help="reuse <work>/home from an earlier run")
    a = ap.parse_args(argv)
    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="mc-kit-paths-"))
    work.mkdir(parents=True, exist_ok=True)
    home = work / "home" if a.no_install else install(work)
    created = yaml.safe_load((RULES / "paths.yaml").read_text())["created_by_labs"]

    found: dict[str, dict] = {}
    for p in sorted(OUT.glob("*/*.json")):
        top = p.parent.name
        if top not in ("chapters", "questions", "mocks"):
            continue
        out: list = []
        strings(json.loads(p.read_text()), f"{top}/{p.stem}", out)
        for where, kind, text in out:
            for m in PATH_RE.finditer(text):
                path, shown = normalise(m.group(0))
                if path in ("~", ""):
                    continue
                e = found.setdefault(path, {"path": path, "forms": set(), "where": set(), "variant_only": True})
                e["forms"].add(shown)
                e["where"].add(where)
                if not kind.startswith("variant:"):
                    e["variant_only"] = False

    results = []
    missing = []
    for path in sorted(found):
        e = found[path]
        real = str(home) + path[1:]
        exists = bool(glob.glob(real)) if any(ch in real for ch in "*?[") else os.path.exists(real)
        status, why = ("exists", None) if exists else ("missing", None)
        if not exists:
            for c in created:
                pats = [c["path"]] + c.get("also", [])
                if any(fnmatch.fnmatch(path, pat) for pat in pats):
                    status, why = "created_by_lab_step", c["by"]
                    break
        if status == "missing":
            missing.append(path)
        results.append({"path": path, "status": status, **({"by": why} if why else {}),
                        "forms": sorted(e["forms"]), "used_in": sorted(e["where"])[:12],
                        "uses": len(e["where"]), "only_in_os_variants": e["variant_only"]})
    summary = {
        "paths": len(results),
        "exists": sum(1 for r in results if r["status"] == "exists"),
        "created_by_lab_step": sum(1 for r in results if r["status"] == "created_by_lab_step"),
        "missing": len(missing),
    }
    REPORT.write_text(json.dumps({"summary": summary, "kit_layout": "converter/rules/paths.yaml (header)",
                                  "paths": results}, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(summary))
    for m in missing:
        r = next(x for x in results if x["path"] == m)
        print(f"MISSING {m}  (used in {', '.join(r['used_in'][:3])})")
    print(f"work folder: {work}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
