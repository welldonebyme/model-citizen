"""OS notes: short callouts shown only for some systems (macOS, Windows, WSL) where the book's prose or output is
macOS-specific, and site boxes shown on every system (os: [mac, win, wsl]) such as "Get the course files".

overrides/os-notes.yaml:
    notes:
      - id: win-ch02-terminal          # stable id
        os: [win]                      # win | wsl | mac (the site shows the callout only for these)
        step: ch02-s1-0                # the lesson step that contains the anchor (or question: q-ch02-14)
        starts: "The terminal is the window application."   # anchor: the paragraph / table that starts so
        # code: ch02-c3                # ... or anchor: the code block with this id (lab: ch01-lab1: a lab box,
                                       #     hash of its title)
        hash: 1a2b3c4d5e6f             # sha1 (12 hex) of the anchor's plain text (code: of its text): a changed
                                       # anchor stops the build
        title: On Windows
        text: "Press the Windows key, type `PowerShell` ..."  # `...` = inline code, [text](/kits/x.zip) = a link
        # optional:
        where: before                  # insert before the anchor (default: after it)
        level: callout                 # the anchor is the callout that contains the paragraph
        hide: [win]                    # with level: callout, the book's callout is not shown on these systems
        anchor: get-the-course-files   # id of the box (added to the lesson's anchors)
        kind: tip                      # callout kind (default tip)
        covers: [ch02-c3]              # code blocks whose macOS output this note explains (see output notes)
        blocks:                        # more content after `text`
          - p: "a paragraph"
          - ul: ["item", "item"]       # (or ol:)
          - code: {id: ch01-kit-c1, text: "$ ls", win: "PS> Get-ChildItem", wsl: "$ ls"}
          - table: {head: [a, b], rows: [[x, y]]}

The note becomes {t: "callout", kind, os, osNote: id, title, blocks} next to the anchor (in the same list: a lab
step, a callout, a list item...). Code blocks of a note carry osNote too (their variants are written by hand).

Output notes (automatic): a Windows variant keeps the output that the book recorded on macOS (no Windows output is
invented). When that output (or the Result block right after it) shows a macOS home path, a Windows-only note
says so after it, unless an explicit note is anchored on that block. Other macOS-only output (ls -l columns,
/bin/zsh, Homebrew paths, .venv/bin, a wc total) needs an explicit note: the build stops and names the block.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import yaml

from ..render.inline import plain
from ..tex.nodes import ConvertError

OSES = ("mac", "win", "wsl")
FIX: dict | None = None        # tools: collect the hashes of changed anchors instead of failing (never in a build)
AUTO_PREFIX = "auto-win-out-"
PROMPT = re.compile(r"^\s*(?:\([^)]*\)\s*)?(?:\$|PS>|PS [^>]*>)\s")
MARKERS = {
    "home": re.compile(r"/Users/(?!<)"),
    "ls -l columns": re.compile(r"^[d-][rwx-]{9}[@+]?\s|\bstaff\b|\bwheel\b"),
    "zsh": re.compile(r"/bin/zsh|\bzsh:"),
    "Unix program folder": re.compile(r"(?<![\w.~])/(?:opt|usr|bin)/"),
    ".venv/bin": re.compile(r"\.venv/bin\b|source \.venv"),
    "wc total": re.compile(r"^\s*\d+ total$"),
}


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


def code_hash(block: dict) -> str:
    return hashlib.sha1(block["text"].encode("utf-8")).hexdigest()[:12]


LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*")


def _rich(part: str) -> list:
    """Plain text with [text](href) links and **bold**: /site/paths become site refs (base-aware)."""
    out: list = []
    pos = 0
    for m in LINK.finditer(part):
        if m.start() > pos:
            out.append(part[pos:m.start()])
        if m.group(3) is not None:
            out.append({"t": "b", "c": [m.group(3)]})
        elif m.group(2).startswith("/"):
            out.append({"t": "ref", "href": m.group(2), "text": m.group(1), "site": True})
        else:
            out.append({"t": "link", "href": m.group(2), "c": [m.group(1)]})
        pos = m.end()
    if pos < len(part):
        out.append(part[pos:])
    return out


def inline(text: str) -> list:
    """'Run `dbt build` now, see [the kit](/kits/x.zip)' -> ['Run ', {t: code, v: 'dbt build'}, ' now, see ', ref]"""
    out: list = []
    for i, part in enumerate(re.split(r"`([^`]*)`", " ".join(text.split()))):
        if not part:
            continue
        if i % 2:
            out.append({"t": "code", "v": part})
        else:
            out.extend(_rich(part))
    return out


def note_blocks(n: dict) -> list:
    blocks: list = []
    if n.get("text"):
        blocks.append({"t": "p", "c": inline(n["text"])})
    for b in n.get("blocks") or []:
        if len(b) != 1:
            raise ConvertError(f"os-notes.yaml: {n['id']}: a block has one key (p, ul, ol, code, table): {b}")
        (k, v), = b.items()
        if k == "p":
            blocks.append({"t": "p", "c": inline(v)})
        elif k in ("ul", "ol"):
            blocks.append({"t": "list", "kind": k, "items": [{"blocks": [{"t": "p", "c": inline(x)}]} for x in v]})
        elif k == "code":
            c = {"t": "code", "lang": v.get("lang", "bash"), "id": v["id"], "text": v["text"].rstrip("\n"),
                 "osNote": n["id"]}
            var = {o: v[o].rstrip("\n") for o in ("win", "wsl") if v.get(o)}
            if var:
                c["variants"] = var
            blocks.append(c)
        elif k == "table":
            blocks.append({"t": "table", "head": [[{"c": inline(h)} for h in v["head"]]],
                           "rows": [[{"c": inline(x)} for x in r] for r in v["rows"]]})
        else:
            raise ConvertError(f"os-notes.yaml: {n['id']}: unknown block {k!r}")
    if not blocks:
        raise ConvertError(f"os-notes.yaml: {n['id']}: no text")
    return blocks


def _path(blocks: list, pred) -> list | None:
    """[(list, index), ...] from the outer list to the matching block (depth-first, first match)."""
    for i, b in enumerate(blocks):
        if pred(b):
            return [(blocks, i)]
        subs = []
        if isinstance(b.get("blocks"), list):
            subs.append(b["blocks"])
        if b.get("t") == "list":
            subs += [it["blocks"] for it in b["items"]]
        for sub in subs:
            hit = _path(sub, pred)
            if hit:
                return [(blocks, i)] + hit
    return None


def _find(blocks: list, starts: str):
    """(list, index) of the first paragraph or table (searched depth-first) whose plain text starts with `starts`."""
    p = _path(blocks, lambda b: b.get("t") in ("p", "table") and block_text(b).startswith(starts))
    return p[-1] if p else None


def load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return (yaml.safe_load(path.read_text()) or {}).get("notes") or []


def is_note(b) -> bool:
    return isinstance(b, dict) and bool(b.get("osNote"))


def _insert(lst: list, anchor: dict, note: dict, where: str) -> None:
    i = next(k for k, x in enumerate(lst) if x is anchor)
    if where == "before":
        lst.insert(i, note)
        return
    j = i + 1
    while j < len(lst) and is_note(lst[j]):
        j += 1                                   # several notes on one anchor keep the file order
    lst.insert(j, note)


def apply(files: dict, path: Path) -> dict:
    notes = load(path)
    steps, lesson_of = {}, {}
    for name, doc in files.items():
        if name.startswith("chapters/"):
            for lesson in doc["lessons"]:
                for st in lesson["steps"]:
                    steps[st["id"]] = st
                    lesson_of[st["id"]] = lesson
    questions = {q["id"]: q for name, doc in files.items() if name.startswith("questions/") for q in doc}
    seen, applied, covered = set(), [], set()
    for n in notes:
        nid = n["id"]
        if nid in seen:
            raise ConvertError(f"os-notes.yaml: duplicate id {nid}")
        seen.add(nid)
        if n.get("question"):
            q = questions.get(n["question"])
            if q is None:
                raise ConvertError(f"os-notes.yaml: {nid}: unknown question {n['question']}")
            root = q["explanation"]
        else:
            st = steps.get(n.get("step"))
            if st is None:
                raise ConvertError(f"os-notes.yaml: {nid}: unknown step {n.get('step')}")
            root = st["blocks"]
        if n.get("code"):
            hit = _path(root, lambda b: b.get("t") == "code" and b.get("id") == n["code"])
            h = code_hash(hit[-1][0][hit[-1][1]]) if hit else None
            covered.add(n["code"])
        elif n.get("lab"):
            hit = _path(root, lambda b: b.get("t") == "lab" and b.get("id") == n["lab"])
            h = hashlib.sha1(plain(hit[-1][0][hit[-1][1]]["title"]).encode("utf-8")).hexdigest()[:12] if hit else None
        else:
            hit = _path(root, lambda b: b.get("t") in ("p", "table") and block_text(b).startswith(n["starts"]))
            h = para_hash(hit[-1][0][hit[-1][1]]) if hit else None
        if not hit:
            raise ConvertError(f"os-notes.yaml: {nid}: anchor not found in {n.get('step') or n.get('question')} "
                               f"({n.get('code') or n.get('lab') or n.get('starts')!r})")
        covered.update(n.get("covers") or [])
        if n.get("hash") != h:
            if FIX is not None:
                FIX[nid] = h
            else:
                raise ConvertError(f"os-notes.yaml: {nid}: the anchor changed (hash {n.get('hash')} != {h}); "
                                   f"re-check the note, then set hash: {h}")
        bad = [o for o in n["os"] if o not in OSES]
        if bad:
            raise ConvertError(f"os-notes.yaml: {nid}: unknown os {bad}")
        lst, i = hit[-1]
        if n.get("level") == "callout":
            outer = [(l, k) for l, k in hit[:-1] if l[k].get("t") == "callout"]
            if not outer:
                raise ConvertError(f"os-notes.yaml: {nid}: level callout, but the anchor is not inside a callout")
            lst, i = outer[-1]
        anchor = lst[i]
        if n.get("hide"):
            if anchor.get("t") != "callout":
                raise ConvertError(f"os-notes.yaml: {nid}: hide needs level: callout")
            anchor["os"] = [o for o in OSES if o not in n["hide"]]
            anchor["osHiddenBy"] = nid
        callout = {"t": "callout", "kind": n.get("kind", "tip"), "os": list(n["os"]), "osNote": nid,
                   "title": inline(n.get("title") or "On Windows"), "blocks": note_blocks(n)}
        if n.get("anchor"):
            callout["anchor"] = n["anchor"]
            lesson = lesson_of.get(n.get("step"))
            if lesson is None:
                raise ConvertError(f"os-notes.yaml: {nid}: an anchor needs a lesson step")
            if n["anchor"] not in lesson["anchors"]:
                lesson["anchors"].append(n["anchor"])
        _insert(lst, anchor, callout, n.get("where", "after"))
        applied.append({"id": nid, "where": n.get("step") or n.get("question"), "os": n["os"]})
    auto = output_notes(files, covered)
    return {"file": "converter/overrides/os-notes.yaml", "notes": len(applied),
            "win": sum(1 for a in applied if "win" in a["os"]), "wsl": sum(1 for a in applied if "wsl" in a["os"]),
            "mac": sum(1 for a in applied if "mac" in a["os"]),
            "everyOs": sum(1 for a in applied if set(a["os"]) == set(OSES)), "autoOutputNotes": auto}


# ---------------------------------------------------------------------------------------------- output notes
def mac_markers(text: str, output_only: bool) -> set[str]:
    found = set()
    for line in text.split("\n"):
        if not line.strip() or (output_only and PROMPT.match(line)):
            continue
        found.update(k for k, rx in MARKERS.items() if rx.search(line))
    return found


def _lists(o):
    """Every list of blocks of a document (lesson steps, callouts, labs, list items, intro)."""
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ("blocks", "intro") and isinstance(v, list):
                yield v
            if isinstance(v, (dict, list)):
                yield from _lists(v)
    elif isinstance(o, list):
        for v in o:
            yield from _lists(v)


def _code_in_order(o, lst=None, out=None):
    """(list, block) of every code block of a document, in reading order."""
    out = [] if out is None else out
    if isinstance(o, dict):
        if o.get("t") == "code" and "lang" in o:
            out.append((lst, o))
            return out
        for k, v in o.items():
            if isinstance(v, list):
                _code_in_order(v, v if k in ("blocks", "intro") else None, out)
            elif isinstance(v, dict):
                _code_in_order(v, None, out)
    elif isinstance(o, list):
        for v in o:
            _code_in_order(v, lst, out)
    return out


def windows_outputs(doc) -> list[tuple[list, dict, dict | None, set]]:
    """(list of the last block, shell block, its Result block or None, macOS markers) for every Windows variant of a
    doc whose output, or the Result block that comes right after it (the next code block in reading order), was
    recorded on macOS with a macOS-only detail."""
    codes = [(l, b) for l, b in _code_in_order(doc) if not is_note(b)]
    out = []
    for k, (lst, b) in enumerate(codes):
        if not (b["lang"] == "bash" and (b.get("variants") or {}).get("win")):
            continue
        nxt = codes[k + 1] if k + 1 < len(codes) else None
        res = nxt if nxt and nxt[1]["lang"] == "output" else None
        marks = mac_markers(b["variants"]["win"], True) | (mac_markers(res[1]["text"], False) if res else set())
        if marks:
            where = res[0] if res else lst
            if where is None:
                raise ConvertError(f"os-notes: {b['id']}: code block outside a list of blocks")
            out.append((where, b, res[1] if res else None, marks))
    return out


def auto_note_text(b: dict, marks: set[str]) -> str:
    text = "The output above was recorded on macOS. On your computer the paths start with `C:\\Users\\<you>\\` " \
           "instead of `/Users/you/`."
    if re.search(r"^\s*(?:\([^)]*\)\s*)?PS> pwd\b", b["variants"]["win"], re.M):
        text += " PowerShell's `pwd` prints a small table: the word `Path`, a line of dashes, then the folder."
    return text


def output_notes(files: dict, covered: set[str]) -> dict:
    added, explicit, missing = [], 0, []
    for name in sorted(k for k in files if k.startswith("chapters/")):
        for lst, b, res, marks in windows_outputs(files[name]):
            if b["id"] in covered or (res and res["id"] in covered):
                explicit += 1
                continue
            if marks - {"home"}:
                missing.append(f"{b['id']} ({', '.join(sorted(marks))})")
                continue
            note = {"t": "callout", "kind": "tip", "os": ["win"], "osNote": AUTO_PREFIX + b["id"],
                    "title": ["On Windows"], "blocks": [{"t": "p", "c": inline(auto_note_text(b, marks))}]}
            _insert(lst, res or b, note, "after")
            added.append(b["id"])
    if missing:
        raise ConvertError("os-notes.yaml: Windows output recorded on macOS needs an explicit note (code: <id>) for: "
                           + "; ".join(missing))
    return {"auto": len(added), "explicit": explicit, "blocks": added}
