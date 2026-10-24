"""The objective ids. The 33 objectives with titles are read from dbt-bible/tools/make_coverage.py (OBJECTIVES),
without executing it (ast.literal_eval), so the website uses exactly the book's list."""
from __future__ import annotations

import ast
from pathlib import Path

from ..tex.nodes import ConvertError

# Tags used in the book that are not in make_coverage.OBJECTIVES.
EXTRA_PREREQUISITES = ["CP0-CLI", "CP0-DATA", "CP0-YAML", "CP0-JINJA", "CP0-PY"]
META = ["EXAM", "PLAN", "ALL"]


def load_objectives(book: Path) -> list[tuple[str, str]]:
    path = book / "tools" / "make_coverage.py"
    tree = ast.parse(path.read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "OBJECTIVES" for t in node.targets):
            value = ast.literal_eval(node.value)
            return [(str(a), str(b)) for a, b in value]
    raise ConvertError(f"{path}: OBJECTIVES not found")


def all_ids(objectives: list[tuple[str, str]]) -> set[str]:
    return {o for o, _ in objectives} | set(EXTRA_PREREQUISITES) | set(META)


def kind_of(oid: str) -> str:
    if oid in META:
        return "meta"
    if oid.startswith("CP0"):
        return "prerequisite"
    return "official"


def topic_of(oid: str) -> int | None:
    if oid.startswith("CP0"):
        return 0
    if oid[0].isdigit():
        return int(oid.split(".")[0])
    return None
