"""LaTeX nodes -> Inline[] (see SCHEMA.md "Inline nodes")."""
from __future__ import annotations

import re

from ..tex.definitions import check_definition
from ..tex.macros import ICONS, MACROS, MATH_SYMBOLS, SYMBOLS
from ..tex.nodes import Cmd, Env, Group, Math, Par, Space, Special, Text
from .context import REF_WORDS, Ctx

NBSP = " "

# TeX ligatures active in the serif and sans fonts (fontspec Ligatures=TeX); the mono font has none.
# Quotes follow SCHEMA.md: `` and '' become a plain double quote.
_LIGS = [("---", "—"), ("--", "–"), ("``", '"'), ("''", '"'), ("`", "'")]


def lig(s: str) -> str:
    for a, b in _LIGS:
        s = s.replace(a, b)
    return s


def glossary_key(raw_en: str) -> str:
    """Same normalisation as dbt-bible/tools/make_glossary.py (sort_key)."""
    en = " ".join(raw_en.split())
    plain = re.sub(r"\\[a-zA-Z]+|[{}\\]", "", en).lower().lstrip(".-_ ")
    if plain.endswith("s") and not plain.endswith("ss") and len(plain) > 4:
        plain = plain[:-1]
    return plain


def term_slug(key: str) -> str:
    return "term-" + re.sub(r"[^a-z0-9]+", "-", key).strip("-")


# ---------------------------------------------------------------------------- list helpers
def append(out: list, item) -> None:
    if isinstance(item, str):
        if not item:
            return
        if out and isinstance(out[-1], str):
            out[-1] = out[-1] + item
        else:
            out.append(item)
    else:
        out.append(item)


def extend(out: list, items: list) -> None:
    for it in items:
        append(out, it)


def collapse_spaces(items: list) -> list:
    out: list = []
    for it in items:
        if isinstance(it, str):
            it = re.sub(r" {2,}", " ", it)
            if out and isinstance(out[-1], str):
                out[-1] = re.sub(r" {2,}", " ", out[-1] + it)
                continue
        out.append(it)
    return out


def trim(items: list) -> list:
    items = collapse_spaces(items)
    while items and isinstance(items[0], str) and not items[0].strip(" \n"):
        items = items[1:]
    while items and isinstance(items[-1], str) and not items[-1].strip(" \n"):
        items = items[:-1]
    if items and isinstance(items[0], str):
        items = [items[0].lstrip(" ")] + items[1:]
    if items and isinstance(items[-1], str):
        items = items[:-1] + [items[-1].rstrip(" ")]
    # a trailing line break at the end of a paragraph or cell is layout
    while items and isinstance(items[-1], dict) and items[-1].get("t") == "br":
        items = trim(items[:-1])
    return items


def plain(items) -> str:
    """Flatten Inline[] to text (used for titles, keys, glossary strings)."""
    if isinstance(items, str):
        return items
    out = []
    for it in items:
        if isinstance(it, str):
            out.append(it)
        else:
            t = it.get("t")
            if t in ("code", "key"):
                out.append(it["v"])
            elif t == "term":
                out.append(plain(it["en"]))
            elif t == "ref":
                out.append(it["text"])
            elif t == "obj":
                out.append(it["id"])
            elif t == "br":
                out.append(" ")
            elif t == "blank":
                out.append("____")
            elif t == "icon":
                out.append("")
            elif "c" in it:
                out.append(plain(it["c"]))
    return "".join(out)


BLOCK_TYPES = {"p", "h", "list", "table", "callout", "lab", "objectives", "figure", "quiz", "hr", "traps"}


def is_blocks(lst) -> bool:
    """True when a cell/option content is Block[] rather than Inline[] (both can start with a "code" dict)."""
    if not lst or not isinstance(lst[0], dict):
        return False
    t = lst[0].get("t")
    return t in BLOCK_TYPES or (t == "code" and "text" in lst[0])


def has_structure(items: list) -> bool:
    return any(not isinstance(i, str) for i in items)


# ---------------------------------------------------------------------------- renderer
class InlineRenderer:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx

    def render(self, nodes: list, mono: bool = False) -> list:
        out: list = []
        i = 0
        while i < len(nodes):
            n = nodes[i]
            if isinstance(n, Cmd) and MACROS[n.name][1] == "decl":
                rest = self.render(nodes[i + 1:], mono=mono or n.name == "ttfamily")
                if n.name == "bfseries":
                    rest = [{"t": "b", "c": rest}] if rest else []
                elif n.name == "itshape":
                    rest = [{"t": "i", "c": rest}] if rest else []
                elif n.name == "ttfamily" and not mono:
                    rest = self.to_code(rest, n)
                extend(out, rest)
                return out
            self.node(n, out, mono)
            i += 1
        return out

    def to_code(self, items: list, node) -> list:
        """Text rendered in a monospace declaration becomes code nodes."""
        out = []
        for it in items:
            if isinstance(it, str):
                if out and isinstance(out[-1], dict) and out[-1].get("t") == "code":
                    out[-1]["v"] += it
                else:
                    out.append({"t": "code", "v": it})
            elif isinstance(it, dict) and it.get("t") == "_rm":
                extend(out, it["c"])
            else:
                out.append(it)
        return out

    def code_text(self, nodes: list, node) -> str:
        items = self.render(nodes, mono=True)
        if has_structure(items):
            kinds = sorted({i.get("t") for i in items if not isinstance(i, str)})
            if set(kinds) - {"code"}:
                self.ctx.warn(node, f"formatting {kinds} inside \\{node.name} flattened to text")
        return plain(items)

    def node(self, n, out: list, mono: bool) -> None:
        ctx = self.ctx
        if isinstance(n, Text):
            append(out, n.s if mono else lig(n.s))
        elif isinstance(n, Space):
            append(out, " ")
        elif isinstance(n, Special):
            if n.ch == "~":
                append(out, NBSP)
            else:
                ctx.error(n, "'&' outside a table")
        elif isinstance(n, Par):
            ctx.error(n, "paragraph break inside inline content")
        elif isinstance(n, Group):
            extend(out, self.render(n.children, mono))
        elif isinstance(n, Math):
            append(out, self.math(n.children))
        elif isinstance(n, Env):
            ctx.error(n, f"environment {n.name} inside inline content")
        elif isinstance(n, Cmd):
            self.cmd(n, out, mono)
        else:
            ctx.error(None, f"unexpected node {n!r}")

    def math(self, nodes: list) -> str:
        out = []
        for n in nodes:
            if isinstance(n, Text):
                out.append(n.s.replace("-", "−"))
            elif isinstance(n, Space):
                out.append(" ")
            elif isinstance(n, Group):
                out.append(self.math(n.children))
            elif isinstance(n, Cmd) and n.name in MATH_SYMBOLS:
                out.append(MATH_SYMBOLS[n.name])
            elif isinstance(n, Cmd) and n.name in SYMBOLS:
                out.append(SYMBOLS[n.name])
            else:
                self.ctx.error(n, f"unsupported math content {n.raw()!r}")
        return re.sub(r" {2,}", " ", "".join(out))

    def cmd(self, n: Cmd, out: list, mono: bool) -> None:
        ctx = self.ctx
        name = n.name
        cat = MACROS[name][1]
        a = n.args
        if cat == "symbol":
            append(out, SYMBOLS[name])
        elif cat == "math":
            ctx.error(n, f"\\{name} outside math mode")
        elif cat == "layout":
            return
        elif cat == "define":
            check_definition(n)
        elif name in ("code", "texttt"):
            items = self.render(a[0].nodes, mono=True)
            if any(isinstance(i, dict) and i.get("t") == "blank" for i in items):
                # a fill-in blank inside code: code pieces around a {t:"blank"}
                buf: list = []
                for it in items:
                    if isinstance(it, dict) and it.get("t") == "blank":
                        if buf:
                            append(out, {"t": "code", "v": plain(buf)})
                            buf = []
                        append(out, {"t": "blank"})
                    else:
                        buf.append(it)
                if buf:
                    append(out, {"t": "code", "v": plain(buf)})
            else:
                append(out, {"t": "code", "v": self.code_text(a[0].nodes, n)})
        elif name == "textbf":
            c = self.render(a[0].nodes, mono)
            if c:
                append(out, {"t": "b", "c": c if not mono else self.to_code(c, n)})
        elif name in ("emph", "textit"):
            c = self.render(a[0].nodes, mono)
            if c:
                append(out, {"t": "i", "c": c})
        elif name == "textsf":
            c = self.render(a[0].nodes, mono)
            if c:
                append(out, {"t": "sf", "c": c})
        elif name == "underline":
            inner = [x for x in a[0].nodes if not isinstance(x, Space)]
            if inner and all(isinstance(x, Cmd) and x.name == "hspace" for x in inner):
                append(out, {"t": "blank"})
            else:
                append(out, {"t": "u", "c": self.render(a[0].nodes, mono)})
        elif name == "textrm":
            inner = self.render(a[0].nodes, False)
            if mono:
                append(out, {"t": "_rm", "c": inner})   # unwrapped by to_code()
            else:
                extend(out, inner)
        elif name == "mbox":
            extend(out, self.render(a[0].nodes, mono))
        elif name in ("textcolor", "colorbox"):
            extend(out, self.render(a[1].nodes, mono))
        elif name == "texorpdfstring":
            extend(out, self.render(a[0].nodes, mono))
        elif name == "url":
            url = a[0].raw.strip()
            append(out, {"t": "link", "href": url, "c": [url]})
        elif name == "href":
            append(out, {"t": "link", "href": a[0].raw.strip(), "c": self.render(a[1].nodes, mono)})
        elif name in ("newline", "\\"):
            append(out, {"t": "br"})
        elif name == "hspace":
            append(out, " ")
        elif name in ("rule", "hrulefill"):
            append(out, {"t": "blank"})
        elif name == "^":
            append(out, "^" + plain(self.render(a[0].nodes, True)))
        elif name == "term":
            self.term(n, out)
        elif name == "key":
            append(out, {"t": "key", "v": self.code_text(a[0].nodes, n)})
        elif name == "objective":
            oid = a[0].raw.strip()
            if oid not in ctx.objective_ids:
                ctx.error(n, f"unknown objective id {oid!r}")
            ctx.obj_tags.append(oid)
            append(out, {"t": "obj", "id": oid})
        elif name in ICONS:
            append(out, {"t": "icon", "name": ICONS[name]})
        elif name == "capscore":
            # \newcommand{\capscore}{\checkbox\,S\ \checkbox\,H\ \checkbox\,R} (checked in definitions.py)
            for letter, sep in (("S", " "), ("H", " "), ("R", "")):
                append(out, {"t": "icon", "name": "checkbox"})
                append(out, " " + letter + sep)
        elif name == "ref":
            self.ref(n, out)
        elif name == "label":
            return            # anchors are registered by the structure pass
        else:
            ctx.error(n, f"\\{name} is not allowed in inline content here")

    def term(self, n: Cmd, out: list) -> None:
        ctx = self.ctx
        raw_en = n.args[0].raw
        key = glossary_key(raw_en)
        tid = term_slug(key)
        fr = plain(self.render(n.args[1].nodes)).strip()
        en = self.render(n.args[0].nodes)
        ctx.term_occurrences.append({
            "key": key, "id": tid, "rawEn": " ".join(raw_en.split()), "rawFr": " ".join(n.args[1].raw.split()),
            "chapter": ctx.chapter_number, "chapterId": ctx.chapter_id, "lesson": ctx.lesson, "anchor": ctx.step,
            "where": n.where(),
        })
        append(out, {"t": "term", "en": trim(en), "fr": fr, "id": tid})

    def ref(self, n: Cmd, out: list) -> None:
        ctx = self.ctx
        label = n.args[0].raw.strip()
        info = ctx.labels.get(label)
        if info is None:
            ctx.error(n, f"\\ref{{{label}}}: unknown label")
        text = info.number
        if out and isinstance(out[-1], str):
            m = re.search(r"(?:^|(?<=[\s(\[{/]))(Chapters|Chapter|Sections|Section|Appendix|Lab|Figure|Table|Ch\.)" + NBSP + "$",
                          out[-1])
            if m and m.group(1) in REF_WORDS:
                text = f"{m.group(1)} {info.number}"
                out[-1] = out[-1][:m.start()]
                if not out[-1]:
                    out.pop()
        append(out, {"t": "ref", "label": label, "text": text, "href": info.href})
