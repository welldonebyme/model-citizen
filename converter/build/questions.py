"""Quiz questions (chapter quizzes and mock exams) -> Question objects (SCHEMA.md "Questions")."""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field

from ..render.blocks import BlockRenderer
from ..render.inline import append, is_blocks, plain, trim
from ..tex.definitions import check_definition
from ..tex.macros import MACROS
from ..tex.nodes import Cmd, Env, Group, Par, Space
from . import keys as K

FORMATS = [
    (re.compile(r"Multiple choice"), "mc"),
    (re.compile(r"Multiple select — choose (\d+)"), "ms"),
    (re.compile(r"Fill in the blank"), "fill"),
    (re.compile(r"Matching"), "match"),
    (re.compile(r"Hotspot — which (?:line|part)"), "hotspot"),
    (re.compile(r"Build list — put in order"), "order"),
    (re.compile(r"DOMC — judge each option YES/NO(?: independently)?"), "domc"),
]
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


@dataclass
class Draft:
    where: str
    format: str
    format_label: str
    choose: int | None
    stem: list
    options: list | None = None
    match: dict | None = None
    hotspot: dict | None = None
    blanks: int = 0
    notes: list = field(default_factory=list)      # extraction problems (-> todo)
    explanation: list = field(default_factory=list)
    key: object = None
    key_raw: str = ""
    key_status: str = "todo"
    key_reason: str = ""
    key_proposal: object = None
    why_wrong: list | None = None
    review: list | None = None
    objective: str | None = None
    unlabelled: bool = False
    part: int = 0          # 1-based index of the quiz box in the chapter
    printed: int = 0       # number printed in the book (Q1 restarts in each quiz box)


def sig(nodes):
    return [n for n in nodes if not isinstance(n, (Space, Par))]


def split_items(env: Env, ctx) -> list[tuple[Cmd, list]]:
    items: list[tuple[Cmd, list]] = []
    for n in env.children:
        if isinstance(n, Cmd) and n.name == "item":
            if n.args[0].present:
                ctx.error(n, "\\item[..] in a quiz list")
            items.append((n, []))
        elif items:
            items[-1][1].append(n)
        elif isinstance(n, Cmd) and MACROS[n.name][1] == "define":
            check_definition(n)
        elif not isinstance(n, (Space, Par)) and not (isinstance(n, Cmd) and MACROS[n.name][1] in ("layout", "decl")):
            ctx.error(n, f"content before the first \\item of {env.name}")
    return items


# ---------------------------------------------------------------------------------------------- stems
def format_label(content: list, renderer: BlockRenderer):
    s = sig(content)
    if not s:
        renderer.ctx.error(None, "empty question")
    first = s[0]
    text = None
    if isinstance(first, (Group, Cmd)) and (isinstance(first, Group) or first.name in ("textbf", "textsf")):
        text = plain(trim(renderer.inl.render([first]))).strip()
    if not text or not re.fullmatch(r"\[[^\]]+\]", text):
        renderer.ctx.error(first, "question does not start with a [Format] label")
    label = text[1:-1].replace(" ", " ")
    for rx, fmt in FORMATS:
        m = rx.fullmatch(label)
        if m:
            choose = int(m.group(1)) if fmt == "ms" else None
            i = content.index(first) + 1
            # an \enspace after the label is layout
            while i < len(content) and (isinstance(content[i], Space) or
                                        (isinstance(content[i], Cmd) and content[i].name == "enspace")):
                i += 1
            return fmt, label, choose, content[i:]
    renderer.ctx.error(first, f"unknown question format label [{label}]")


def strip_marker(inl: list, rx: str) -> tuple[str | None, list]:
    """Remove a leading marker ("1.", "(a)", "a.") from an Inline[]; return (marker id, rest)."""
    if not inl or not isinstance(inl[0], str):
        return None, inl
    s = inl[0].replace(" ", " ")
    m = re.match(rx, s)
    if not m:
        return None, inl
    rest = [s[m.end():].lstrip(" ")] + inl[1:]
    return m.group(1), trim(rest)


def cell_inlines(cell) -> list:
    c = cell.get("c", [])
    if is_blocks(c):
        return None
    return c


def list_items_inline(lst: dict) -> list | None:
    out = []
    for it in lst["items"]:
        b = it["blocks"]
        if not b:
            out.append([])
        elif len(b) == 1 and b[0]["t"] == "p":
            out.append(b[0]["c"])
        else:
            return None
    return out


def right_ids_from_marker(marker: str | None, n: int) -> list[str] | None:
    if marker in ("a.", "(a)"):
        return list(LETTERS.lower()[:n])
    if marker == "A.":
        return list(LETTERS[:n])
    return None


def find_markers(inl: list, markers: list[str]):
    """Split Inline[] at the literal markers (in order). Returns segments or None."""
    segs: list[list] = [[]]
    mi = 0
    for it in inl:
        if isinstance(it, str):
            s = it
            while mi < len(markers):
                idx = _marker_pos(s, markers[mi])
                if idx < 0:
                    break
                append(segs[-1], s[:idx])
                s = s[idx + len(markers[mi]):]
                segs.append([])
                mi += 1
            append(segs[-1], s)
        else:
            segs[-1].append(it)
    if mi != len(markers):
        return None
    return segs


def _marker_pos(s: str, marker: str) -> int:
    start = 0
    while True:
        i = s.find(marker, start)
        if i < 0:
            return -1
        before = s[i - 1] if i > 0 else " "
        if before in "  (;,:—–\n" or i == 0:
            return i
        start = i + 1


def unlabelled_list(c: list):
    """'Put these ... in order: X, Y, Z.' -> (stem up to the colon, [X, Y, Z]); None if not regular."""
    # find the last colon in a top-level string
    pos = None
    for k in range(len(c) - 1, -1, -1):
        if isinstance(c[k], str) and ":" in c[k]:
            pos = (k, c[k].rindex(":"))
            break
    if pos is None:
        return None
    k, j = pos
    head = trim(c[:k] + [c[k][:j + 1]])
    tail = [c[k][j + 1:]] + c[k + 1:]
    sep = ";" if any(isinstance(x, str) and ";" in x for x in tail) else ","
    parts: list[list] = [[]]
    for x in tail:
        if isinstance(x, str):
            pieces = x.split(sep)
            append(parts[-1], pieces[0])
            for p in pieces[1:]:
                parts.append([])
                append(parts[-1], p)
        else:
            parts[-1].append(x)
    items = [clean_segment(p) for p in parts]
    if len(items) < 3 or any(not it for it in items):
        return None
    return head, items


def clean_segment(seg: list) -> list:
    seg = trim(seg)
    while seg and isinstance(seg[-1], str):
        s = re.sub(r"[\s ,;.—–]+$", "", seg[-1])
        s = re.sub(r"\s+(?:and|or)$", "", s)
        if s == seg[-1]:
            break
        seg = seg[:-1] + ([s] if s else [])
    return trim(seg)


def sequential_markers(text: str, kind: str) -> list[str]:
    seq = []
    for i in range(26):
        mk = f"({i + 1})" if kind == "num" else f"({LETTERS.lower()[i]})"
        if mk in text:
            seq.append(mk)
        else:
            break
    return seq


class QuestionBuilder:
    def __init__(self, renderer: BlockRenderer):
        self.r = renderer
        self.ctx = renderer.ctx

    # ------------------------------------------------------------------ question items
    def build(self, env: Env) -> list[Draft]:
        drafts = []
        self.ctx.stats["env:" + env.name] += 1
        for item, content in split_items(env, self.ctx):
            fmt, label, choose, rest = format_label(content, self.r)
            stem = self.r.render(rest)
            d = Draft(item.where(), fmt, label, choose, stem)
            self.extract(d)
            drafts.append(d)
        return drafts

    def take_choices(self, d: Draft, required: bool) -> None:
        idx = [i for i, b in enumerate(d.stem) if b.get("t") == "list" and b.get("_env") == "choices"]
        if len(idx) != 1:
            if required:
                d.notes.append(f"expected one choices list, found {len(idx)}")
            return
        lst = d.stem.pop(idx[0])
        opts = []
        for i, it in enumerate(lst["items"]):
            b = it["blocks"]
            if len(b) == 1 and b[0]["t"] == "p":
                opts.append({"id": LETTERS[i], "c": b[0]["c"]})
            elif not b:
                opts.append({"id": LETTERS[i], "c": []})
            else:
                opts.append({"id": LETTERS[i], "c": [], "blocks": b})
        d.options = opts

    def extract(self, d: Draft) -> None:
        f = d.format
        if f in ("mc", "ms", "domc"):
            self.take_choices(d, required=True)
        elif f == "order":
            self.take_choices(d, required=False)
            if d.options is None:
                self.inline_options(d)
        elif f == "match":
            self.extract_match(d)
        elif f == "hotspot":
            self.extract_hotspot(d)
        elif f == "fill":
            d.blanks = count_blanks(d.stem)
        # nested choices lists left in the stem would be lost options
        for b in walk_blocks(d.stem):
            if b.get("_env") == "choices" and f not in ("match",):
                d.notes.append("a choices list remains inside the stem")

    def inline_options(self, d: Draft) -> None:
        """Build list written in the stem: '(a) step; (b) step; ...' at the end of the last paragraph."""
        paras = [i for i, b in enumerate(d.stem) if b.get("t") == "p"]
        for i in reversed(paras):
            text = plain(d.stem[i]["c"])
            marks = sequential_markers(text, "alpha")
            if len(marks) >= 2:
                segs = find_markers(d.stem[i]["c"], marks)
                if segs is None:
                    break
                items = [clean_segment(s) for s in segs[1:]]
                if any(not it for it in items):
                    d.notes.append("empty inline build-list item")
                    return
                d.stem[i]["c"] = trim(segs[0])
                if not d.stem[i]["c"]:
                    d.stem.pop(i)
                d.options = [{"id": LETTERS[k], "c": it} for k, it in enumerate(items)]
                return
        # unlabelled list after a colon: "Order ...: Test, Do, Review, Read." / "...: a; b; c."
        for i in reversed(paras):
            c = d.stem[i]["c"]
            items = unlabelled_list(c)
            if items:
                head, opts = items
                d.stem[i]["c"] = head
                d.options = [{"id": LETTERS[k], "c": it} for k, it in enumerate(opts)]
                d.unlabelled = True
                return
            break
        d.notes.append("build-list options not found (no choices list, no (a) (b) ... in the stem)")

    # ------------------------------------------------------------------ matching
    def extract_match(self, d: Draft) -> None:
        stem = d.stem
        # A. a table of "1. left & a. right" rows (possibly with a header row)
        for i, b in enumerate(stem):
            if b.get("t") != "table":
                continue
            rows = b["rows"]
            # B'. one row with two lists (Mock 2)
            if len(rows) == 1 and len(rows[0]) == 2 and all(isinstance(c.get("c"), list) and len(c["c"]) == 1 and
                                                             isinstance(c["c"][0], dict) and c["c"][0].get("t") == "list"
                                                             for c in rows[0]):
                if self.two_lists(d, rows[0][0]["c"][0], rows[0][1]["c"][0]):
                    stem.pop(i)
                    return
                continue
            left, right = [], []
            okrows = True
            for row in rows:
                if len(row) != 2:
                    okrows = False
                    break
                lc, rc = cell_inlines(row[0]), cell_inlines(row[1])
                if lc is None or rc is None:
                    okrows = False
                    break
                if lc:
                    lid, lrest = strip_marker(lc, r"^\(?(\d+)[.)]\s*")
                    if lid is None:
                        okrows = False
                        break
                    left.append({"id": lid, "c": lrest})
                if rc:
                    rid, rrest = strip_marker(rc, r"^\(?([a-zA-Z])[.)]\s*")
                    if rid is None:
                        okrows = False
                        break
                    right.append({"id": rid, "c": rrest})
            if okrows and left and right:
                if not self.check_sequence(d, left, right):
                    return
                d.match = {"left": left, "right": right}
                if b.get("head"):
                    h = b["head"][0]
                    if len(h) == 2:
                        d.match["titles"] = {"left": h[0]["c"], "right": h[1]["c"]}
                stem.pop(i)
                return
        # B. two consecutive lists (enumerate 1. + enumerate a./A. or choices)
        lists = [i for i, b in enumerate(stem) if b.get("t") == "list"]
        for a, bidx in zip(lists, lists[1:]):
            if bidx == a + 1 and self.two_lists(d, stem[a], stem[bidx]):
                del stem[a:bidx + 1]
                return
        # C. inline "(1) ... (2) ... (a) ... (b) ..." in a paragraph
        for i, b in enumerate(stem):
            if b.get("t") != "p":
                continue
            text = plain(b["c"])
            nums = sequential_markers(text, "num")
            lets = sequential_markers(text, "alpha")
            if len(nums) >= 2 and len(lets) >= 2:
                segs = find_markers(b["c"], nums + lets)
                if segs is None:
                    continue
                left = [{"id": m[1:-1], "c": clean_segment(s)} for m, s in zip(nums, segs[1:1 + len(nums)])]
                right = [{"id": m[1:-1], "c": clean_segment(s)} for m, s in zip(lets, segs[1 + len(nums):])]
                if any(not x["c"] for x in left + right):
                    d.notes.append("empty inline matching item")
                    return
                d.match = {"left": left, "right": right, "inline": True}
                b["c"] = trim(segs[0])
                if not b["c"]:
                    stem.pop(i)
                return
        d.notes.append("matching structure not recognised")

    def two_lists(self, d: Draft, l1: dict, l2: dict) -> bool:
        if l1.get("kind") != "ol" or l1.get("marker", "1.") != "1.":
            return False
        rmarker = "A." if l2.get("_env") == "choices" else l2.get("marker")
        rids = right_ids_from_marker(rmarker, len(l2["items"]))
        if l2.get("kind") != "ol" or rids is None:
            return False
        li, ri = list_items_inline(l1), list_items_inline(l2)
        if li is None or ri is None:
            d.notes.append("matching list item with block content")
            return False
        left = [{"id": str(k + 1), "c": c} for k, c in enumerate(li)]
        right = [{"id": rid, "c": c} for rid, c in zip(rids, ri)]
        d.match = {"left": left, "right": right}
        return True

    def check_sequence(self, d: Draft, left: list, right: list) -> bool:
        if [x["id"] for x in left] != [str(k + 1) for k in range(len(left))]:
            d.notes.append(f"matching left items are not numbered 1..n: {[x['id'] for x in left]}")
            return False
        ids = [x["id"] for x in right]
        if [i.lower() for i in ids] != list(LETTERS.lower()[:len(ids)]):
            d.notes.append(f"matching right items are not lettered a..: {ids}")
            return False
        return True

    # ------------------------------------------------------------------ hotspot
    def extract_hotspot(self, d: Draft) -> None:
        codes = [b for b in d.stem if b.get("t") == "code"]
        listed = [b for b in codes if b.get("lineNumbers")]
        if len(listed) == 1:
            b = listed[0]
            h = {"codeId": b["id"], "lines": len(b["text"].split("\n")), "numbering": "listing"}
            if b.get("firstLine"):
                h["firstLine"] = b["firstLine"]
            d.hotspot = h
            return
        if len(listed) > 1:
            d.notes.append("several line-numbered code blocks in a hotspot stem")
            return
        numbered = []
        for b in codes:
            nums = embedded_numbers(b["text"])
            if nums:
                numbered.append((b, nums))
        if not numbered:
            d.notes.append("hotspot without line numbers (listing or embedded)")
            return
        expect = numbered[0][1][0]
        parts = []
        for b, nums in numbered:
            if nums[0] != expect:
                d.notes.append("embedded line numbers are not continuous across code blocks")
                return
            parts.append({"codeId": b["id"], "from": nums[0], "to": nums[-1]})
            expect = nums[-1] + 1
        h = {"codeId": parts[0]["codeId"], "lines": parts[-1]["to"] - parts[0]["from"] + 1, "numbering": "text"}
        if parts[0]["from"] != 1:
            h["firstLine"] = parts[0]["from"]
        if len(parts) > 1:
            h["parts"] = parts
        d.hotspot = h

    # ------------------------------------------------------------------ answers
    def attach_answers(self, drafts: list[Draft], env: Env) -> None:
        self.ctx.stats["env:" + env.name] += 1
        items = split_items(env, self.ctx)
        if len(items) != len(drafts):
            self.ctx.error(env, f"{len(items)} answers for {len(drafts)} questions")
        for d, (item, content) in zip(drafts, items):
            d.explanation = self.r.render(content)
            s = sig(content)
            first = s[0] if s else None
            if isinstance(first, Cmd) and first.name == "textbf":
                d.key_raw = first.raw()
            else:
                # the first paragraph, raw
                raw = []
                for n in content:
                    if isinstance(n, Par):
                        break
                    raw.append(n.raw())
                d.key_raw = "".join(raw).strip()
            self.parse_chapter_key(d)

    def parse_chapter_key(self, d: Draft) -> None:
        if d.notes:
            d.key_status, d.key_reason = "todo", "; ".join(d.notes)
            return
        par = K.first_paragraph(d.explanation)
        ld, rest = K.lead(par)
        lead_text = K.norm(K.text_of(ld)) if ld else ""
        opts = [o["id"] for o in d.options or []]
        f = d.format
        if f == "fill":
            res = K.parse_fill(par, d.blanks)
        elif f == "order" and d.unlabelled:
            res = K.parse_order_words(par, d.options)
        elif ld is None:
            res = K.todo("the answer does not start with a bold key")
        elif f == "mc":
            res = K.parse_mc(lead_text, opts)
        elif f == "ms":
            res = K.parse_ms(lead_text, opts, d.choose)
        elif f == "order":
            res = K.parse_order(lead_text, opts)
        elif f == "hotspot":
            res = K.parse_hotspot(lead_text)
        elif f == "match":
            res = K.parse_match(lead_text, [x["id"] for x in d.match["left"]], [x["id"] for x in d.match["right"]])
        elif f == "domc":
            res = K.parse_domc_text(lead_text, opts)
            if res.status != "ok":
                res2 = K.parse_domc_bolds(par, opts)
                if res2.status == "ok":
                    res = res2
        else:
            res = K.todo(f"unknown format {f}")
        self.apply(d, res)

    def apply(self, d: Draft, res: K.KeyResult) -> None:
        d.key_status = res.status
        d.key_reason = res.reason
        d.key_proposal = res.proposal
        d.key = res.key
        if d.format == "match" and d.match is not None:
            if len(d.match["right"]) < len(d.match["left"]):
                d.match["reuse"] = True
        if res.status == "ok" and d.format == "match" and isinstance(res.key, dict):
            pass


# ---------------------------------------------------------------------------------------------- helpers
def walk_blocks(blocks: list):
    for b in blocks:
        if not isinstance(b, dict):
            continue
        yield b
        for key in ("blocks",):
            if isinstance(b.get(key), list):
                yield from walk_blocks(b[key])
        if b.get("t") == "list":
            for it in b["items"]:
                yield from walk_blocks(it["blocks"])
        if b.get("t") == "table":
            for row in (b.get("head") or []) + b["rows"]:
                for c in row:
                    if is_blocks(c["c"]):
                        yield from walk_blocks(c["c"])


def walk_inlines(items, out: list):
    for it in items:
        if isinstance(it, str):
            out.append(("s", it))
        elif isinstance(it, dict):
            t = it.get("t")
            if t == "blank":
                out.append(("blank", None))
            elif t == "code":
                out.append(("code", it["v"]))
            elif t == "term":
                walk_inlines(it["en"], out)
            elif "c" in it and isinstance(it["c"], list):
                walk_inlines(it["c"], out)


def count_blanks(blocks: list) -> int:
    n = 0
    for b in walk_blocks(blocks):
        t = b.get("t")
        if t == "code":
            n += len(re.findall(r"_{3,}", b["text"]))
            continue
        pieces: list = []
        if t in ("p", "h"):
            walk_inlines(b["c"], pieces)
        elif t == "table":
            for row in (b.get("head") or []) + b["rows"]:
                for c in row:
                    if not (is_blocks(c["c"])):
                        walk_inlines(c["c"], pieces)
        for kind, v in pieces:
            if kind == "blank":
                n += 1
            elif v:
                n += len(re.findall(r"_{3,}", v))
    return n


def embedded_numbers(text: str) -> list[int] | None:
    nums = []
    for line in text.split("\n"):
        m = re.match(r"^\s*(\d+)(?:\||\s|$)", line)
        if not m:
            return None
        nums.append(int(m.group(1)))
    if not nums or nums != list(range(nums[0], nums[0] + len(nums))):
        return None
    return nums


def strip_private(obj):
    """Remove internal keys (prefixed with '_') before writing JSON."""
    if isinstance(obj, dict):
        return {k: strip_private(v) for k, v in obj.items() if not k.startswith("_")}
    if isinstance(obj, list):
        return [strip_private(x) for x in obj]
    return obj
