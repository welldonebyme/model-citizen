"""Site edits: the book's text changed for the website (overrides/site-edits.yaml).

The book is its author's personal edition ("Welcome, Adnane", "Your Mac", a dbt Learn account he already has...)
and has a few mistakes the website corrects. Every edit names where it applies and the sha1 (12 hex) of the book
text it changes, so a changed book stops the build until the edit is re-checked (like os-notes.yaml).

    text:          # replace a string
      - id: welcome-title
        in: ch00-s1                 # a lesson id (title, steps, every block), a step id, or a question id
        find: "Welcome, Adnane"
        replace: "Welcome"
        count: 4                    # number of strings that contain `find` (default 1); each is replaced
        hash: 0123456789ab          # sha1 of those strings (in document order, joined with a newline)
    objectives:    # a lesson's exam objectives (the header tags), when the book's tags are only examples
      - lesson: ch00-s3
        objectives: []
        hash: ...                   # sha1 of the book's list, comma-joined
    not_labs:      # a lab box of the book that is not a lab (the chapter-anatomy example)
      - lab: ch00-lab1
        title: "..."                # the title of the sample box
        hash: ...                   # sha1 of the lab's plain text (title + blocks)

Applied right after the chapters are built (before book.json, the plan, coverage and the path rules). Code blocks
and inline code keep the book's text in textBook. A sample lab becomes a callout {kind: tip, sample: {t: lab, id,
title, objectives}}: it leaves the lesson's labs, its lab minutes and every lab count, so the site (labs hub,
planner, progress) does not count it. converter/check.py turns it back into a lab to compare with the book.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import yaml

from ..render.inline import plain
from ..rewrite import SKIP_KEYS
from ..tex.nodes import ConvertError
from .osnotes import inline

FIX: dict | None = None        # tools: collect the hashes of changed book text instead of failing (never in a build)


def sha(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def load(path: Path) -> dict:
    return (yaml.safe_load(path.read_text()) or {}) if path.exists() else {}


def _strings(obj, find: str, out: list, parent=None, key=None):
    """(container, key) of every string that contains `find` (identifiers and audit copies skipped)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in SKIP_KEYS:
                continue
            if isinstance(v, str):
                if find in v:
                    out.append((obj, k))
            else:
                _strings(v, find, out)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, str):
                if find in v:
                    out.append((obj, i))
            else:
                _strings(v, find, out)


def _scopes(chapters: dict, questions: dict) -> dict:
    sc = {}
    for ch in chapters.values():
        for lesson in ch["lessons"]:
            sc[lesson["id"]] = lesson
            for st in lesson["steps"]:
                sc[st["id"]] = st
    sc.update(questions)
    return sc


def apply_text(chapters: dict, questions: dict, edits: list) -> list:
    scopes = _scopes(chapters, questions)
    done = []
    for e in edits:
        scope = scopes.get(e["in"])
        if scope is None:
            raise ConvertError(f"site-edits.yaml: {e['id']}: unknown place {e['in']}")
        hits: list = []
        _strings(scope, e["find"], hits)
        texts = [c[k] for c, k in hits]
        if len(hits) != e.get("count", 1):
            raise ConvertError(f"site-edits.yaml: {e['id']}: {len(hits)} strings of {e['in']} contain {e['find']!r} "
                               f"(expected {e.get('count', 1)}): {texts[:5]}")
        h = sha("\n".join(texts))
        if e.get("hash") != h and FIX is not None:
            FIX[e["id"]] = h
        elif e.get("hash") != h:
            raise ConvertError(f"site-edits.yaml: {e['id']}: the book text changed (hash {e.get('hash')} != {h}); "
                               f"re-check the edit, then set hash: {h}")
        for c, k in hits:
            if isinstance(c, dict) and c.get("t") == "code" and k in ("text", "v"):
                c.setdefault("textBook", c[k])
            c[k] = c[k].replace(e["find"], e["replace"])
        done.append({"id": e["id"], "in": e["in"], "strings": len(hits)})
    return done


def apply_objectives(chapters: dict, edits: list) -> list:
    lessons = {l["id"]: (ch, l) for ch in chapters.values() for l in ch["lessons"]}
    done = []
    for e in edits:
        if e["lesson"] not in lessons:
            raise ConvertError(f"site-edits.yaml: objectives: unknown lesson {e['lesson']}")
        ch, lesson = lessons[e["lesson"]]
        h = sha(",".join(lesson["objectives"]))
        if e.get("hash") != h:
            raise ConvertError(f"site-edits.yaml: objectives of {e['lesson']}: the book's tags changed "
                               f"({lesson['objectives']}, hash {h}); re-check, then set hash: {h}")
        removed = [o for o in lesson["objectives"] if o not in e["objectives"]]
        lesson["objectivesBook"] = lesson["objectives"]
        lesson["objectives"] = list(e["objectives"])
        still = {o for l in ch["lessons"] for o in l["objectives"]}
        ch["objectives"] = [o for o in ch["objectives"] if o not in removed or o in still]
        done.append({"lesson": e["lesson"], "removed": removed})
    return done


def lab_text(lab: dict) -> str:
    from .output import block_text
    return plain(lab["title"]) + "\n" + "\n".join(block_text(b) for b in lab["blocks"])


def _labs_in(blocks: list):
    for i, b in enumerate(blocks):
        if b.get("t") == "lab":
            yield blocks, i
        for key in ("blocks",):
            if isinstance(b.get(key), list):
                yield from _labs_in(b[key])
        if b.get("t") == "list":
            for it in b["items"]:
                yield from _labs_in(it["blocks"])


def apply_not_labs(chapters: dict, edits: list) -> list:
    from .chapters import lab_minutes_of
    done = []
    for e in edits:
        hit = None
        for ch in chapters.values():
            for lesson in ch["lessons"]:
                for st in lesson["steps"]:
                    for lst, i in _labs_in(st["blocks"]):
                        if lst[i]["id"] == e["lab"]:
                            hit = (ch, lesson, lst, i)
        if hit is None:
            raise ConvertError(f"site-edits.yaml: not_labs: unknown lab {e['lab']}")
        ch, lesson, lst, i = hit
        lab = lst[i]
        h = sha(lab_text(lab))
        if e.get("hash") != h:
            raise ConvertError(f"site-edits.yaml: not_labs {e['lab']}: the lab changed (hash {h}); re-check it")
        lst[i] = {"t": "callout", "kind": "tip", "title": inline(e["title"]), "blocks": lab["blocks"],
                  "sample": {"t": "lab", "id": lab["id"], "title": lab["title"], "objectives": lab["objectives"],
                             **({"anchor": lab["anchor"]} if lab.get("anchor") else {})}}
        lesson["labs"] = [x for x in lesson["labs"] if x != lab["id"]]
        lesson["labMinutes"] = lab_minutes_of([b for s in lesson["steps"] for b in s["blocks"]])
        ch["labMinutes"] = sum(l["labMinutes"] for l in ch["lessons"])
        done.append({"lab": lab["id"], "lesson": lesson["id"]})
    return done


def apply(chapters: dict, questions: dict, path: Path) -> dict:
    data = load(path)
    return {"file": "converter/overrides/site-edits.yaml",
            "text": apply_text(chapters, questions, data.get("text") or []),
            "objectives": apply_objectives(chapters, data.get("objectives") or []),
            "notLabs": apply_not_labs(chapters, data.get("not_labs") or [])}

