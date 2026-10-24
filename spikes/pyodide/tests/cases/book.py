"""Read code blocks straight out of the book's LaTeX (read-only), by line number.

Every case in yaml_cases.py / jinja_cases.py points at the line of a \\begin{...} so the
expected text is the book's text, not a transcription.
"""
import os
import re
from pathlib import Path

BIBLE = Path(os.environ.get("DBT_BIBLE", "/Users/mac/Documents/Adnane/dbt-bible"))
CH05 = "parts/part1/ch05-yaml-jinja-python.tex"
CH11 = "parts/part2/ch11-jinja-macros-packages.tex"
CH22 = "parts/part6/ch22-debugging.tex"

_cache = {}


def _lines(relpath):
    if relpath not in _cache:
        _cache[relpath] = (BIBLE / relpath).read_text(encoding="utf-8").split("\n")
    return _cache[relpath]


def block(relpath, begin_line):
    """Content of the listing environment whose \\begin is on `begin_line` (1-based)."""
    lines = _lines(relpath)
    head = lines[begin_line - 1]
    m = re.match(r"\s*\\begin\{(\w+)\}", head)
    if not m:
        raise ValueError(f"{relpath}:{begin_line} is not a \\begin line: {head!r}")
    env = m.group(1)
    out = []
    for line in lines[begin_line:]:
        if line.strip().startswith("\\end{%s}" % env):
            return "\n".join(out)
        out.append(line)
    raise ValueError(f"no \\end{{{env}}} after {relpath}:{begin_line}")


def ref(relpath, begin_line):
    ch = re.search(r"ch(\d+)", relpath).group(1)
    return f"ch{ch}:{begin_line}"
