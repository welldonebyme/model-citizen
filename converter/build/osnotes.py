"""OS notes: short callouts shown only for one OS (Windows or WSL) where the book's prose is macOS-specific.

overrides/os-notes.yaml:
    notes:
      - id: win-ch02-terminal          # stable id
        os: [win]                      # win | wsl | mac (the site shows the callout only for these)
        step: ch02-s1-0                # the lesson step that contains the anchor paragraph
        starts: "The terminal is the window application."   # the anchor paragraph starts with this text
        hash: 1a2b3c4d5e6f             # sha1 (12 hex) of the anchor paragraph's plain text: stale notes fail the build
        title: On Windows
        text: "Press the Windows key, type `PowerShell` ..."  # simple text; `...` = inline code

The note becomes {t: "callout", kind: "tip", os: [...], title, blocks: [{t: "p"}]} right after the anchor paragraph
(in the same list: a lab step, a callout, a list item...).
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import yaml

from ..render.inline import plain
from ..tex.nodes import ConvertError


def block_text(block: dict) -> str:
    """Plain text of an anchor: a paragraph, or a table (every cell, row by row)."""
    if block.get("t") == "p":
        return plain(block["c"])
    out: list[str] = []

    def walk(o):
        if isinstance(o, str):
            out.append(o)
        elif isinstance(o, dict):
            if o.get("t") in ("code", "key") and "v" in o:
                out.append(o["v"])
            for k, v in o.items():
                if k not in ("t", "v", "align", "header", "colspan", "rowspan", "groupRows"):
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk({"head": block.get("head"), "rows": block.get("rows")})
    return " ".join(" ".join(out).split())


def para_hash(block: dict) -> str:
    return hashlib.sha1(block_text(block).encode("utf-8")).hexdigest()[:12]


def inline(text: str) -> list:
    """'Run `dbt build` now' -> ['Run ', {t: code, v: 'dbt build'}, ' now']"""
    out: list = []
    for i, part in enumerate(re.split(r"`([^`]*)`", " ".join(text.split()))):
        if not part:
            continue
        out.append({"t": "code", "v": part} if i % 2 else part)
    return out


def _find(blocks: list, starts: str):
    """(list, index) of the first paragraph or table (searched depth-first) whose plain text starts with `starts`."""
    for i, b in enumerate(blocks):
        if b.get("t") in ("p", "table") and block_text(b).startswith(starts):
            return blocks, i
        for key in ("blocks",):
            if isinstance(b.get(key), list):
                hit = _find(b[key], starts)
                if hit:
                    return hit
        if b.get("t") == "list":
            for it in b["items"]:
                hit = _find(it["blocks"], starts)
                if hit:
                    return hit
    return None


def load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return (yaml.safe_load(path.read_text()) or {}).get("notes") or []


def apply(files: dict, path: Path) -> dict:
    notes = load(path)
    steps = {}
    for name, doc in files.items():
        if name.startswith("chapters/"):
            for lesson in doc["lessons"]:
                for st in lesson["steps"]:
                    steps[st["id"]] = st
    seen = set()
    applied = []
    for n in notes:
        if n["id"] in seen:
            raise ConvertError(f"os-notes.yaml: duplicate id {n['id']}")
        seen.add(n["id"])
        st = steps.get(n["step"])
        if st is None:
            raise ConvertError(f"os-notes.yaml: {n['id']}: unknown step {n['step']}")
        hit = _find(st["blocks"], n["starts"])
        if not hit:
            raise ConvertError(f"os-notes.yaml: {n['id']}: no paragraph of {n['step']} starts with {n['starts']!r}")
        lst, i = hit
        h = para_hash(lst[i])
        if n.get("hash") != h:
            raise ConvertError(f"os-notes.yaml: {n['id']}: the anchor paragraph changed (hash {n.get('hash')} != {h}); "
                               f"re-check the note, then set hash: {h}")
        bad = [o for o in n["os"] if o not in ("mac", "win", "wsl")]
        if bad:
            raise ConvertError(f"os-notes.yaml: {n['id']}: unknown os {bad}")
        j = i + 1
        while j < len(lst) and lst[j].get("t") == "callout" and lst[j].get("osNote"):
            j += 1                                   # several notes on one paragraph keep the file order
        lst.insert(j, {"t": "callout", "kind": "tip", "os": list(n["os"]), "osNote": n["id"],
                       "title": inline(n.get("title") or "On Windows"),
                       "blocks": [{"t": "p", "c": inline(n["text"])}]})
        applied.append({"id": n["id"], "step": n["step"], "os": n["os"]})
    return {"file": "converter/overrides/os-notes.yaml", "notes": len(applied),
            "win": sum(1 for a in applied if "win" in a["os"]), "wsl": sum(1 for a in applied if "wsl" in a["os"])}
