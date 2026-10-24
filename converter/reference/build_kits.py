"""Build the two downloadable kits (deterministic zips: fixed dates, sorted entries).

    converter/.venv/bin/python converter/reference/build_kits.py     (needs pyyaml: the converter's venv)

  site/public/kits/dbt-course-kit.zip          practice kit (data, setup.sql, updates, bugs, jaffle_dbt.bundle,
                                               READMEs, setup.sh / setup.ps1, tools, check project)
  site/public/kits/shopflow-capstone-kit.zip   capstone kit (data, seeds, setup.sql, updates, shopflow_dbt.bundle
                                               = the SOLUTION, README, setup.sh / setup.ps1, tools)

Inputs: the book's labs folder and its two git repositories (read only: they are cloned into a temporary folder
before anything is committed), and the templates in converter/reference/kit and converter/reference/kit-capstone.
Every text file copied from the book (README/.md, .sql, .yml, .sh, .ps1, .py, .txt) goes through the book path
rules of converter/rules/paths.yaml (~/Documents/Adnane/dbt-bible/labs/... -> the kit's paths, /Users/mac ->
/Users/you), then through the few explicit rewrites below (a rewrite that no longer matches stops the build).
The reference repository's README on `main` names the author's folders: the bundle gets one extra commit on top
of `main` with the same rules (fixed author and date, so the bundle stays byte-identical); the tags are unchanged.
converter/tools/check_shipped.py (part of `converter check`) fails if a shipped file still names them.
"""
from __future__ import annotations

import io
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ACADEMY = HERE.parents[1]
sys.path.insert(0, str(ACADEMY))
from converter.rewrite import DETECT, PathRewriter  # noqa: E402

PATHS = PathRewriter(ACADEMY / "converter" / "rules" / "paths.yaml")
TEXT_SUFFIXES = {".md", ".sql", ".yml", ".yaml", ".sh", ".ps1", ".py", ".txt"}
# before the general rules: the reference README's "cd <the repository>" = the kit's clone of the bundle
README_FIRST = [   # the READMEs of the repositories, before the path rules
    ("cd ~/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt", "cd ~/dbt-course/reference/jaffle_dbt"),
    ("in Parts II to VII of the bible (Chapters 6 to 25)", "in Parts II to VII of the course (Chapters 6 to 25)"),
]


def book_text(text: str, first: list | None = None) -> str:
    for old, new in first or []:
        text = text.replace(old, new)
    return PATHS.apply(text)[0]
BIBLE = ACADEMY.parent / "dbt-bible"
LABS = BIBLE / "labs"
OUT = ACADEMY / "site" / "public" / "kits"
JAFFLE = LABS / "practice-project" / "jaffle_dbt"
SHOPFLOW = LABS / "capstone" / "shopflow_dbt"
ZIP_DATE = (2026, 10, 21, 0, 0, 0)
DUCKDB_VERSION = "1.5.6"

WIN_UPDATES = """
## On Windows (PowerShell)

PowerShell has no `<` redirection. From `$HOME\\dbt-course\\practice`:

```powershell
duckdb practice.duckdb -c ".read updates/day2.sql"          # with the DuckDB CLI
python ..\\kit\\tools\\duck.py practice.duckdb -f updates\\day2.sql   # without it (venv active)
duckdb practice.duckdb -c ".read setup.sql"                 # reset to day 1
```
"""

WIN_BUGS = """
## On Windows (PowerShell)

```powershell
cd $HOME\\dbt-course\\jaffle_dbt
git status
git apply $HOME\\dbt-course\\kit\\bugs\\01-jinja-missing-endif.patch
dbt parse
git apply -R $HOME\\dbt-course\\kit\\bugs\\01-jinja-missing-endif.patch
```

If `git apply` says "patch does not apply" although your file is the same as the reference, the cause is
usually Windows line endings (CRLF): add `--ignore-whitespace` to both commands. With
`git config --global core.autocrlf true` (recommended on Windows) the plain command works.
"""

# (file inside the kit, old text, new text): every rule must match the book's text at least once
REWRITES = [   # applied AFTER the book path rules
    ("updates/README.md",
     "Copy the folder next to your database once, then run a script with the DuckDB CLI",
     "The kit's setup already copied this folder next to your database (`~/dbt-course/practice/updates`;\n"
     "the `cp` line below does it again). Run a script with the DuckDB CLI"),
    ("updates/README.md",
     "python tools/build_practice_db.py ~/dbt-course/practice/practice.duckdb --sql updates/day2.sql",
     "cd ~/dbt-course/practice\npython ../kit/tools/duck.py practice.duckdb -f updates/day2.sql      # venv active"),
    ("tools/run_sql.py",
     'DEFAULT_DB = Path(__file__).resolve().parent.parent / "labs" / "practice.duckdb"',
     'DEFAULT_DB = Path.home() / "dbt-course" / "practice" / "practice.duckdb"  # kit: ~/dbt-course'),
]
APPEND = {"updates/README.md": WIN_UPDATES, "bugs/README.md": WIN_BUGS}


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


KIT_COMMIT_ENV = {"GIT_AUTHOR_NAME": "Model Citizen kit", "GIT_AUTHOR_EMAIL": "kit@example.com",
                  "GIT_COMMITTER_NAME": "Model Citizen kit", "GIT_COMMITTER_EMAIL": "kit@example.com",
                  "GIT_AUTHOR_DATE": "2026-10-21T00:00:00+00:00", "GIT_COMMITTER_DATE": "2026-10-21T00:00:00+00:00"}


def bundle(repo: Path, prefix: str) -> bytes:
    """git bundle of HEAD, main and the tags. Text files of `main` that name the author's folders get the book
    path rules in one extra commit (in a temporary clone: the book's repository is never written)."""
    tags = sorted(t for t in git(repo, "tag", "-l", f"{prefix}*").decode().split() if t)
    with tempfile.TemporaryDirectory() as td:
        clone = Path(td) / "repo"
        subprocess.run(["git", "clone", "-q", str(repo), str(clone)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(clone), "checkout", "-q", "main"], check=True, capture_output=True)
        changed = []
        for f in git(clone, "ls-files").decode().split("\n"):
            p = clone / f
            if not f or Path(f).suffix not in TEXT_SUFFIXES or not p.is_file():
                continue
            text = p.read_text(encoding="utf-8")
            if DETECT.search(text):
                new = book_text(text, README_FIRST)
                if DETECT.search(new):
                    raise SystemExit(f"{repo.name}:{f}: a path of the author's computer is left after the rules")
                p.write_text(new, encoding="utf-8")
                changed.append(f)
        if changed:
            env = {**os.environ, **KIT_COMMIT_ENV}
            subprocess.run(["git", "-C", str(clone), "add", *changed], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(clone), "commit", "-q", "-m",
                            "Practice kit: paths of the kit in " + ", ".join(changed)], check=True,
                           capture_output=True, env=env)
        out = Path(td) / "x.bundle"
        subprocess.run(["git", "-C", str(clone), "-c", "pack.threads=1", "bundle", "create", str(out),
                        "HEAD", "main", *tags], check=True, capture_output=True)
        return out.read_bytes()


def rel_files(base: Path) -> list[Path]:
    return sorted(p for p in base.rglob("*") if p.is_file() and p.name != ".DS_Store"
                  and "__pycache__" not in p.parts)


class Kit:
    def __init__(self, root: str):
        self.root = root
        self.files: dict[str, tuple[bytes, int]] = {}

    def add(self, path: str, data: bytes | str, mode: int = 0o644, book: bool = False) -> None:
        if isinstance(data, str):
            data = data.encode("utf-8")
        if book and Path(path).suffix in TEXT_SUFFIXES:
            data = book_text(data.decode("utf-8")).encode("utf-8")
        self.files[path] = (data, mode)

    def add_dir(self, src: Path, dest: str, pattern: str = "*", book: bool = False) -> None:
        for p in rel_files(src):
            if p.match(pattern):
                self.add(f"{dest}/{p.relative_to(src).as_posix()}" if dest else p.relative_to(src).as_posix(),
                         p.read_bytes(), 0o755 if p.suffix == ".sh" else 0o644, book=book)

    def rewrite(self) -> None:
        for path, old, new in REWRITES:
            if path not in self.files:
                continue
            data, mode = self.files[path]
            text = data.decode("utf-8")
            if old not in text:
                raise SystemExit(f"rewrite rule no longer matches {path}: {old[:60]!r}")
            self.files[path] = (text.replace(old, new).encode("utf-8"), mode)
        for path, extra in APPEND.items():
            if path in self.files:
                data, mode = self.files[path]
                self.files[path] = (data.decode("utf-8").rstrip("\n").encode() + b"\n" + extra.encode(), mode)

    def write_zip(self, target: Path) -> int:
        buf = io.BytesIO()
        dirs = set()
        for path in self.files:
            parts = path.split("/")[:-1]
            for i in range(1, len(parts) + 1):
                dirs.add("/".join(parts[:i]))
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            entries = [(f"{self.root}/", None, 0o755)] + \
                      [(f"{self.root}/{d}/", None, 0o755) for d in sorted(dirs)] + \
                      [(f"{self.root}/{p}", self.files[p][0], self.files[p][1]) for p in sorted(self.files)]
            for name, data, mode in entries:
                zi = zipfile.ZipInfo(name, date_time=ZIP_DATE)
                zi.create_system = 3
                if data is None:
                    zi.external_attr = ((0o040000 | mode) << 16) | 0x10
                    zf.writestr(zi, b"")
                else:
                    zi.external_attr = (0o100000 | mode) << 16
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    zf.writestr(zi, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        data = buf.getvalue()
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != data:
            target.write_bytes(data)
        return len(data)


def version_note(kind: str, repo: Path, tags: str) -> str:
    head = git(repo, "rev-parse", "HEAD").decode().strip()
    return (f"{kind}\n"
            f"reference repository: {repo.name} (book HEAD {head[:12]}, tags {tags}; the bundle's main may have one "
            f"more commit with the kit's paths)\n"
            f"pinned for the course: Python 3.12, dbt-core~=1.11.0, dbt-duckdb~=1.11.0, duckdb=={DUCKDB_VERSION}\n"
            f"verified with: dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb {DUCKDB_VERSION}\n")


def practice_kit() -> Kit:
    k = Kit("dbt-course-kit")
    tpl = HERE / "kit"
    k.add("README.md", (tpl / "README.md").read_bytes())
    k.add("README-windows.md", (tpl / "README-windows.md").read_bytes())
    k.add("setup.sh", (tpl / "setup.sh").read_bytes(), 0o755)
    k.add("setup.ps1", (tpl / "setup.ps1").read_bytes())
    k.add_dir(tpl / "tools", "tools")
    k.add_dir(tpl / "check", "check")
    k.add("tools/run_sql.py", (BIBLE / "tools" / "run_sql.py").read_bytes(), book=True)
    k.add_dir(LABS / "data", "data", "*.csv")
    k.add("setup.sql", (LABS / "setup.sql").read_bytes(), book=True)
    k.add_dir(LABS / "updates", "updates", book=True)
    k.add_dir(LABS / "practice-project" / "bugs", "bugs", book=True)
    k.add("profiles/profiles.yml", git(JAFFLE, "show", "main:profiles.example.yml"), book=True)
    k.add("jaffle_dbt.bundle", bundle(JAFFLE, "ch"))
    k.add("KIT-VERSION.txt", version_note("dbt course practice kit", JAFFLE, "ch06..ch25 + main"))
    k.rewrite()
    return k


def capstone_kit() -> Kit:
    k = Kit("shopflow-capstone-kit")
    tpl = HERE / "kit-capstone"
    cap = LABS / "capstone"
    k.add("README.md", (tpl / "README.md").read_bytes())
    k.add("setup.sh", (tpl / "setup.sh").read_bytes(), 0o755)
    k.add("setup.ps1", (tpl / "setup.ps1").read_bytes())
    k.add("tools/duck.py", (HERE / "kit" / "tools" / "duck.py").read_bytes())
    k.add_dir(cap / "data", "data", "*.csv")
    k.add_dir(cap / "seeds", "seeds", "*.csv")
    k.add("setup.sql", (cap / "setup.sql").read_bytes(), book=True)
    k.add_dir(cap / "updates", "updates", "*.sql", book=True)
    k.add("profiles/profiles.yml", git(SHOPFLOW, "show", "m14:profiles.example.yml"), book=True)
    k.add("shopflow_dbt.bundle", bundle(SHOPFLOW, "m"))
    k.add("KIT-VERSION.txt", version_note("ShopFlow capstone kit (contains the SOLUTION in shopflow_dbt.bundle)",
                                          SHOPFLOW, "m00..m14 + main"))
    k.rewrite()
    return k


def main() -> int:
    for path in (HERE / "kit" / "setup.ps1", HERE / "kit" / "setup.sh", HERE / "kit-capstone" / "setup.ps1",
                 HERE / "kit-capstone" / "setup.sh", HERE / "kit" / "tools" / "duck.py"):
        raw = path.read_bytes()
        if any(b > 127 for b in raw):
            raise SystemExit(f"{path.name}: non-ASCII characters (Windows PowerShell 5.1 reads .ps1 files as ANSI)")
    sizes = {}
    for name, kit in (("dbt-course-kit.zip", practice_kit()), ("shopflow-capstone-kit.zip", capstone_kit())):
        sizes[name] = kit.write_zip(OUT / name)
        print(f"{name}: {len(kit.files)} files, {sizes[name] / 1024:.1f} KiB")
    print(f"total: {sum(sizes.values()) / 1024 / 1024:.2f} MiB -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
