"""Apply the book path rules (converter/rules/paths.yaml) to text files copied from the book.

    echo '{"updates/README.md": "..."}' | converter/.venv/bin/python -m converter.tools.book_paths

Reads a JSON object {name: text} on stdin and writes {name: text} with the rules applied. Exits 1 (and writes
nothing) when a text still names the author's folders after the rules. Used by site/scripts/dbt/build-presets.mjs;
converter/reference/build_kits.py applies the same rules to the kits.
"""
from __future__ import annotations

import json
import sys

from ..config import CONVERTER
from ..rewrite import DETECT, PathRewriter


def main() -> int:
    rules = PathRewriter(CONVERTER / "rules" / "paths.yaml")
    files = json.load(sys.stdin)
    out, bad = {}, []
    for name, text in files.items():
        new, _ = rules.apply(text)
        for i, line in enumerate(new.splitlines(), 1):
            if DETECT.search(line):
                bad.append(f"{name}:{i}: {line.strip()[:120]}")
        out[name] = new
    if bad:
        print("book paths left after the rules (add a rule to converter/rules/paths.yaml):", *bad, sep="\n  ",
              file=sys.stderr)
        return 1
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
