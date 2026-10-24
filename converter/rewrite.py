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


# Anything in the book that names the author's folders (checked after the rules: what is left is "unmapped").
DETECT = re.compile(r"Documents/Adnane|dbt-bible|/Users/mac(?![\w-])|(?<![\w/.~-])labs/(?:updates|practice-project|capstone"
                    r"|data|setup\.sql)|bible folder|of the bible(?=\s*(?:\(|$))|bible's read-only|helper of the bible"
                    r"|The bible contains")


class PathRewriter:
    def __init__(self, rules_file: Path):
        data = yaml.safe_load(rules_file.read_text())
        self.rules = [Rule(r["id"], re.compile(r["pattern"]), r["replace"]) for r in data["rules"]]
        self.allowed = [(re.compile(a["where"]), a["why"]) for a in data.get("unmapped_allowed", [])]
        self.created = data.get("created_by_labs", [])

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
                    obj.setdefault("textBook", obj["text"])   # keep the book text (site edits ran first)
                    obj["text"] = new
                    log.append({"where": f"{where}#{obj.get('id')}", "field": "text", "rules": used})
                if "title" in obj:
                    new, used = self.apply(obj["title"])
                    if used:
                        obj.setdefault("titleBook", obj["title"])
                        obj["title"] = new
                        log.append({"where": f"{where}#{obj.get('id')}", "field": "title", "rules": used})
                return obj
            if obj.get("t") == "code" and "v" in obj:              # inline code
                new, used = self.apply(obj["v"])
                if used:
                    obj.setdefault("textBook", obj["v"])
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
    """Every occurrence of the author's folders in the book sources (file:line), for the report: the rules that
    rewrite it, the text after the rules, and `unmapped` (+ `allowed`) when something is left."""
    rw = PathRewriter(rules_file)
    out = []
    files = sorted(list((book / "parts").glob("*/*.tex")) + list((book / "appendices").glob("*.tex")))
    for f in files:
        for i, line in enumerate(f.read_text().splitlines(), 1):
            norm = line.replace("\\textasciitilde{}", "~").replace("\\textasciitilde", "~").replace("\\_", "_")
            if not DETECT.search(norm):
                continue
            new, used = rw.apply(norm)
            where = f"{f.relative_to(book)}:{i}"
            occ = {"where": where, "rules": used, "text": line.strip()[:200]}
            if used:
                occ["after"] = new.strip()[:200]
            left = DETECT.search(new)
            if left:
                occ["unmapped"] = left.group(0)
                why = next((w for rx, w in rw.allowed if rx.search(where)), None)
                if why:
                    occ["allowed"] = why
            out.append(occ)
    return out
