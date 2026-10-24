"""Path rewrites for the web (rules/paths.yaml), applied to the generated JSON trees."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

# fields that are identifiers, links or audit copies: never rewritten
SKIP_KEYS = {"id", "href", "src", "label", "keyRaw", "textBook", "titleBook", "anchor", "lesson", "chapter", "codeId",
             "key", "ids", "labs", "objectives", "checkpoints", "anchors", "quiz", "objective", "lang", "kind", "t",
             "format", "keyStatus", "name", "marker", "partLabel", "chapterId"}


@dataclass
class Rule:
    id: str
    rx: re.Pattern
    replace: str


class PathRewriter:
    def __init__(self, rules_file: Path):
        data = yaml.safe_load(rules_file.read_text())
        self.rules = [Rule(r["id"], re.compile(r["pattern"]), r["replace"]) for r in data["rules"]]

    def apply(self, s: str) -> tuple[str, list[str]]:
        used = []
        for r in self.rules:
            new = r.rx.sub(r.replace, s)
            if new != s:
                used.append(r.id)
                s = new
        return s, used

    def tree(self, obj, log: list, where: str):
        """Rewrite a JSON-like tree in place; returns the (possibly new) object."""
        if isinstance(obj, dict):
            if obj.get("t") == "code" and "text" in obj:           # code block
                new, used = self.apply(obj["text"])
                if used:
                    obj["textBook"] = obj["text"]
                    obj["text"] = new
                    log.append({"where": f"{where}#{obj.get('id')}", "field": "text", "rules": used})
                if "title" in obj:
                    new, used = self.apply(obj["title"])
                    if used:
                        obj["titleBook"] = obj["title"]
                        obj["title"] = new
                        log.append({"where": f"{where}#{obj.get('id')}", "field": "title", "rules": used})
                return obj
            if obj.get("t") == "code" and "v" in obj:              # inline code
                new, used = self.apply(obj["v"])
                if used:
                    obj["textBook"] = obj["v"]
                    obj["v"] = new
                    log.append({"where": where, "field": "inline code", "rules": used, "before": obj["textBook"]})
                return obj
            for k in list(obj):
                if k in SKIP_KEYS or k.startswith("_"):
                    continue
                obj[k] = self.tree(obj[k], log, where)
            return obj
        if isinstance(obj, list):
            return [self.tree(x, log, where) for x in obj]
        if isinstance(obj, str):
            new, used = self.apply(obj)
            if used:
                log.append({"where": where, "field": "text", "rules": used, "before": obj})
            return new
        return obj


def scan_book(book: Path, rules_file: Path) -> list[dict]:
    """Every occurrence of a rewritten path in the book sources (file:line), for the report."""
    rw = PathRewriter(rules_file)
    out = []
    files = sorted(list((book / "parts").glob("*/*.tex")) + list((book / "appendices").glob("*.tex")))
    for f in files:
        for i, line in enumerate(f.read_text().splitlines(), 1):
            norm = line.replace("\\textasciitilde{}", "~").replace("\\textasciitilde", "~").replace("\\_", "_")
            _, used = rw.apply(norm)
            if used:
                out.append({"where": f"{f.relative_to(book)}:{i}", "rules": used, "text": line.strip()[:200]})
    return out
