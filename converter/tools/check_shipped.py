"""No file that the learner downloads names the author's folders.

    converter/.venv/bin/python -m converter.tools.check_shipped        (also part of `python -m converter check`)

Shipped files: the two kit zips (every member; the git bundles inside are cloned and every branch, tag and commit
message is searched), and everything under site/public/presets, site/public/reference and site/public/data.
A hit is `/Users/mac`, `Documents/Adnane` or `dbt-bible/` (as a path). The book's title is not a path and may
appear (e.g. on the about page, which is not a shipped download).
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from ..config import ACADEMY

PUBLIC = ACADEMY / "site" / "public"
PRIVATE = re.compile(r"/Users/mac(?![\w-])|Documents/Adnane|dbt-bible/")
SCANNED_DIRS = ("presets", "reference", "data")


def _hits_in_text(text: str, where: str, out: list) -> None:
    for i, line in enumerate(text.splitlines(), 1):
        m = PRIVATE.search(line)
        if m:
            out.append(f"{where}:{i}: {m.group(0)!r} in {line.strip()[:120]!r}")


def _scan_bundle(data: bytes, where: str, out: list) -> None:
    with tempfile.TemporaryDirectory() as td:
        b = Path(td) / "x.bundle"
        b.write_bytes(data)
        clone = Path(td) / "c"
        subprocess.run(["git", "clone", "-q", "--mirror", str(b), str(clone)], check=True, capture_output=True)
        refs = subprocess.run(["git", "-C", str(clone), "for-each-ref", "--format=%(refname)"], check=True,
                              capture_output=True, text=True).stdout.split()
        for ref in refs:
            r = subprocess.run(["git", "-C", str(clone), "grep", "-I", "-n", "-E",
                                r"/Users/mac([^A-Za-z0-9_-]|$)|Documents/Adnane|dbt-bible/", ref, "--"],
                               capture_output=True, text=True)
            for line in r.stdout.splitlines():
                out.append(f"{where} [{ref}] {line[:160]}")
        msgs = subprocess.run(["git", "-C", str(clone), "log", "--all", "--format=%h %B"], check=True,
                              capture_output=True, text=True).stdout
        _hits_in_text(msgs, f"{where} [commit messages]", out)


def scan() -> tuple[list[str], dict]:
    hits: list[str] = []
    counts = {"zip_members": 0, "bundles": 0, "files": 0}
    for z in sorted((PUBLIC / "kits").glob("*.zip")):
        with zipfile.ZipFile(z) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                counts["zip_members"] += 1
                data = zf.read(info)
                where = f"{z.name}/{info.filename}"
                if info.filename.endswith(".bundle"):
                    counts["bundles"] += 1
                    _scan_bundle(data, where, hits)
                    continue
                try:
                    _hits_in_text(data.decode("utf-8"), where, hits)
                except UnicodeDecodeError:
                    if PRIVATE.search(data.decode("latin-1")):
                        hits.append(f"{where}: binary file names the author's folders")
    for d in SCANNED_DIRS:
        for p in sorted((PUBLIC / d).rglob("*")):
            if not p.is_file():
                continue
            counts["files"] += 1
            raw = p.read_bytes()
            try:
                _hits_in_text(raw.decode("utf-8"), str(p.relative_to(PUBLIC)), hits)
            except UnicodeDecodeError:
                if PRIVATE.search(raw.decode("latin-1")):
                    hits.append(f"{p.relative_to(PUBLIC)}: binary file names the author's folders")
    return hits, counts


def main() -> int:
    hits, counts = scan()
    print(f"scanned {counts['zip_members']} zip members ({counts['bundles']} git bundles, every ref and commit) "
          f"and {counts['files']} files under site/public/{{{','.join(SCANNED_DIRS)}}}: {len(hits)} hit(s)")
    for h in hits[:50]:
        print("  " + h)
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
