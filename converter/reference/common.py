"""Shared helpers for the reference scripts (export_dags.py, golden_verify.py, build_kits.py).

Everything here READS the book repositories (git archive / show) and writes only into a work folder.
"""
from __future__ import annotations

import hashlib
import io
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

ACADEMY = Path(__file__).resolve().parents[2]
BIBLE = ACADEMY.parent / "dbt-bible"
VENV = ACADEMY / ".venv-verify" / ".venv"
VENV_BIN = VENV / ("Scripts" if os.name == "nt" else "bin")
DBT = VENV_BIN / "dbt"
PY = VENV_BIN / "python"

JAFFLE_REPO = BIBLE / "labs" / "practice-project" / "jaffle_dbt"
SHOPFLOW_REPO = BIBLE / "labs" / "capstone" / "shopflow_dbt"

PROJECTS = {
    "jaffle": {
        "repo": JAFFLE_REPO,
        "project": "jaffle_dbt",
        "profile": "jaffle_dbt",
        "tags": [f"ch{n:02d}" for n in range(6, 26)],
        "data_dir": "practice",          # sibling folder of the project, as in the book
        "db_file": "practice.duckdb",
        "setup_sql": BIBLE / "labs" / "setup.sql",
        "updates": BIBLE / "labs" / "updates",
        "profile_rev": "main",           # profiles.example.yml lives on main (ch25 + README)
    },
    "shopflow": {
        "repo": SHOPFLOW_REPO,
        "project": "shopflow_dbt",
        "profile": "shopflow",
        "tags": [f"m{n:02d}" for n in range(0, 15)],
        "data_dir": "shopflow-data",
        "db_file": "shopflow.duckdb",
        "setup_sql": BIBLE / "labs" / "capstone" / "setup.sql",
        "updates": BIBLE / "labs" / "capstone" / "updates",
        "profile_rev": "m14",
    },
}

DBT_ENV = {
    "DBT_USE_COLORS": "false",
    "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
    "DBT_PRINTER_WIDTH": "80",
}


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


def archive(repo: Path, rev: str, dest: Path) -> None:
    """`git archive <rev>` extracted into dest (dest is emptied first). Read-only for the repo."""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    data = git(repo, "archive", "--format=tar", rev)
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        tf.extractall(dest, filter="data")


def build_db(setup_sql: Path, db_path: Path, extra_sql: list[Path] | None = None) -> str:
    """Build a DuckDB file from setup.sql with the verification venv's duckdb library."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    wal = db_path.with_suffix(db_path.suffix + ".wal")
    if wal.exists():
        wal.unlink()
    cmd = [str(PY), "-I", str(BIBLE / "tools" / "build_practice_db.py"), str(db_path), "--sql", str(setup_sql)]
    for s in extra_sql or []:
        cmd += ["--sql", str(s)]
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def write_profiles(work: Path) -> Path:
    """profiles.yml with the book's two profiles (from the repos' profiles.example.yml)."""
    pdir = work / "profiles"
    pdir.mkdir(parents=True, exist_ok=True)
    parts = []
    for spec in PROJECTS.values():
        parts.append(git(spec["repo"], "show", f"{spec['profile_rev']}:profiles.example.yml").decode())
    (pdir / "profiles.yml").write_text("\n".join(parts))
    return pdir


def dbt_env(profiles_dir: Path, extra: dict | None = None) -> dict:
    env = dict(os.environ)
    for k in list(env):
        if k.startswith("DBT_"):
            del env[k]
    env.update(DBT_ENV)
    env["DBT_PROFILES_DIR"] = str(profiles_dir)
    if extra:
        env.update(extra)
    return env


def run_dbt(args: list[str], cwd: Path, profiles_dir: Path, extra_env: dict | None = None,
            check: bool = False, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run([str(DBT), *args], cwd=cwd, env=dbt_env(profiles_dir, extra_env),
                          capture_output=True, text=True, check=check, timeout=timeout)


def install_packages(project_dir: Path, profiles_dir: Path, cache: Path) -> str | None:
    """dbt deps once per distinct packages.yml + package-lock.yml, then copy the cached dbt_packages."""
    pk = project_dir / "packages.yml"
    if not pk.exists():
        return None
    h = hashlib.sha256()
    for name in ("packages.yml", "package-lock.yml", "dependencies.yml"):
        p = project_dir / name
        if p.exists():
            h.update(name.encode() + b"\0" + p.read_bytes())
    key = h.hexdigest()[:16]
    cdir = cache / key
    if not (cdir / "dbt_packages").exists():
        r = run_dbt(["deps"], project_dir, profiles_dir)
        if r.returncode != 0:
            raise RuntimeError(f"dbt deps failed in {project_dir}:\n{r.stdout}\n{r.stderr}")
        cdir.mkdir(parents=True, exist_ok=True)
        shutil.copytree(project_dir / "dbt_packages", cdir / "dbt_packages")
    else:
        dst = project_dir / "dbt_packages"
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(cdir / "dbt_packages", dst)
    return key


def prepare_tag(key: str, tag: str, work: Path, profiles_dir: Path) -> Path:
    """Fresh copy of the project at <tag> in <work>/<key>/<project> (deps installed).

    The data folder (<work>/<key>/<data_dir>) is a sibling, so the relative profile path works."""
    spec = PROJECTS[key]
    pdir = work / key / spec["project"]
    archive(spec["repo"], tag, pdir)
    install_packages(pdir, profiles_dir, work / "pkg-cache")
    return pdir


def db_path(key: str, work: Path) -> Path:
    spec = PROJECTS[key]
    return work / key / spec["data_dir"] / spec["db_file"]
