"""LaTeX nodes -> Block[] (see SCHEMA.md "Block nodes")."""
from __future__ import annotations

import hashlib
import re

from ..tex.definitions import check_definition
from ..tex.macros import BOXES, CODE_ENVS, MACROS
from ..tex.nodes import Cmd, Env, Group, Par, Source, Space, Text
from ..tex.parser import Parser
from .context import Ctx, anchor_of
from .inline import InlineRenderer, plain, trim
from .options import keyvals, strip_braces
from .tables import TableRenderer

LIST_KINDS = {"itemize": "ul", "enumerate": "ol", "description": "dl", "choices": "ol",
              "questions": "ol", "answers": "ol"}
LIST_DEFAULT_MARKER = {"enumerate": "1.", "choices": "A.", "questions": "Q1.", "answers": "Q1."}
ENUMITEM_LAYOUT = {"before", "leftmargin", "itemsep", "nosep", "style", "font", "topsep"}
BLOCK_GROUP_TRIGGERS = (Par, Env)

# commands that are handled by a dedicated builder and must not reach the generic renderer
HANDLED_ELSEWHERE = {"labtag", "mockkey", "mockreview", "cxxviitrap", "cxxviiwhere", "item", "caption",
                     "chapter", "section", "subsection", "subsubsection", "part", "input", "appendix"}


def _sig_children(nodes):
    return [n for n in nodes if not isinstance(n, (Space, Par))]


def is_block_group(g: Group) -> bool:
    for n in g.children:
        if isinstance(n, BLOCK_GROUP_TRIGGERS):
            return True
        if isinstance(n, Cmd) and n.name in ("par", "paragraph", "resizebox", "section", "subsection", "label"):
            return True
        if isinstance(n, Group) and is_block_group(n):
            return True
    return False


def flatten_block_groups(nodes: list, ctx: Ctx) -> list:
    out = []
    for n in nodes:
        if isinstance(n, Group) and is_block_group(n):
            for m in n.children:
                if isinstance(m, Cmd) and m.name in ("bfseries", "itshape", "ttfamily"):
                    ctx.error(m, f"\\{m.name} spanning block content is not supported")
            out.extend(flatten_block_groups(n.children, ctx))
        else:
            out.append(n)
    return out


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


class BlockRenderer:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.inl = InlineRenderer(ctx)
        self.tables = TableRenderer(self)

    # ------------------------------------------------------------------ sequences
    def render(self, nodes: list, mono: bool = False) -> list:
        ctx = self.ctx
        nodes = flatten_block_groups(nodes, ctx)
        blocks: list = []
        pending: list = []

        def flush():
            nonlocal pending
            if pending:
                c = self.inl.render(pending, mono=mono)
                if mono:
                    c = self.inl.to_code(c, None)
                c = trim(c)
                if c:
                    blocks.append({"t": "p", "c": c})
                pending = []

        for n in nodes:
            if isinstance(n, Par):
                flush()
            elif isinstance(n, Env):
                flush()
                blocks.extend(self.env(n))
            elif isinstance(n, Cmd):
                name = n.name
                cat = MACROS[name][1]
                if name == "par":
                    flush()
                elif name == "paragraph":
                    flush()
                    blocks.append({"t": "h", "level": 4, "c": trim(self.inl.render(n.args[1].nodes))})
                elif name == "resizebox":
                    flush()
                    blocks.extend(self.render(n.args[2].nodes))
                elif cat == "define":
                    action, sname = check_definition(n)
                    if action == "codestyle":
                        ctx.local_styles[sname] = "small"
                elif name in HANDLED_ELSEWHERE or cat in ("struct", "table"):
                    ctx.error(n, f"\\{name} is not allowed here")
                else:
                    pending.append(n)
            else:
                pending.append(n)
        flush()
        self.link_expected(blocks)
        return blocks

    def link_expected(self, blocks: list) -> None:
        for a, b in zip(blocks, blocks[1:]):
            if a.get("t") == "code" and a["lang"] in ("sql", "dbt") and b.get("t") == "code" and b["lang"] == "output":
                a["expected"] = b["id"]

    def cell(self, nodes: list, mono: bool):
        blocks = self.render(nodes, mono=mono)
        if not blocks:
            return []
        if len(blocks) == 1 and blocks[0]["t"] == "p":
            return blocks[0]["c"]
        return blocks

    def inline_only(self, nodes: list, where) -> list:
        """Render content that must be inline (list item of an exambox, lab titles...)."""
        blocks = self.render(nodes)
        if not blocks:
            return []
        if len(blocks) == 1 and blocks[0]["t"] == "p":
            return blocks[0]["c"]
        self.ctx.error(where, "block content where only inline content is allowed")
        return []

    # ------------------------------------------------------------------ environments
    def env(self, e: Env) -> list:
        ctx = self.ctx
        name = e.name
        if name in CODE_ENVS:
            return [self.code(e)]
        if name == "tikzpicture":
            return [self.tikz(e)]
        if name in ("center", "minipage", "multicols"):
            ctx.stats["env:" + name] += 1
            return self.render([n for n in e.children if not (isinstance(n, Cmd) and n.name == "columnbreak")])
        if name in ("figure", "table"):
            return self.float_env(e)
        if name in ("tabularx", "tabular", "longtable"):
            return [self.tables.render(e)]
        if name in ("questions", "answers"):
            ctx.error(e, f"{name} environment outside a quiz")
        if name in LIST_KINDS:
            return [self.list_env(e)]
        if name in BOXES:
            return [self.box(e)]
        ctx.error(e, f"unhandled environment {name}")
        return []

    # ------------------------------------------------------------------ lists
    def list_options(self, e: Env) -> tuple[str | None, int | None]:
        ctx = self.ctx
        marker = LIST_DEFAULT_MARKER.get(e.name)
        start = None
        series_name = None
        if e.args and e.args[0].present:
            for k, v in keyvals(e.args[0].raw, e.where()):
                if k == "label":
                    marker = self.marker_from_label(strip_braces(v or ""), e)
                elif k == "series":
                    series_name = v
                elif k == "resume*":
                    s = ctx.series.get(v)
                    if s is None:
                        ctx.error(e, f"resume*={v}: unknown series")
                    marker = s["marker"]
                    start = s["count"] + 1
                    series_name = v
                elif k in ENUMITEM_LAYOUT:
                    pass
                else:
                    ctx.error(e, f"unsupported list option {k!r}")
        if series_name and series_name not in ctx.series:
            ctx.series[series_name] = {"marker": marker, "count": 0}
        return marker, start

    def marker_from_label(self, raw: str, e: Env) -> str:
        if raw.strip() == "\\checkbox":
            return "checkbox"
        t = re.sub(r"\\(sffamily|bfseries|small|footnotesize|textbf)(?![a-zA-Z])", "", raw)
        t = re.sub(r"\\color\{[^}]*\}", "", t)
        t = t.replace("{", "").replace("}", "")
        t = t.replace("\\arabic*", "1").replace("\\alph*", "a").replace("\\Alph*", "A").replace("\\roman*", "i")
        t = t.strip()
        if "\\" in t or not t:
            self.ctx.error(e, f"unsupported enumitem label {raw!r}")
        return t

    def split_items(self, e: Env) -> list[tuple[Cmd, list]]:
        items: list[tuple[Cmd, list]] = []
        for n in e.children:
            if isinstance(n, Cmd) and n.name == "item":
                items.append((n, []))
            elif not items:
                if isinstance(n, (Space, Par)) or (isinstance(n, Cmd) and MACROS[n.name][1] in ("layout", "decl")):
                    continue
                self.ctx.error(n, f"content before the first \\item in {e.name}")
            else:
                items[-1][1].append(n)
        return items

    def list_env(self, e: Env) -> dict:
        ctx = self.ctx
        kind = LIST_KINDS[e.name]
        ctx.stats["env:" + e.name] += 1
        if any(isinstance(n, Cmd) and n.name == "cxxviitrap" for n in e.children):
            ctx.error(e, "trap list outside Chapter 27 builder")
        marker, start = self.list_options(e)
        items = []
        for item, content in self.split_items(e):
            it: dict = {}
            if kind == "dl":
                if not item.args[0].present:
                    ctx.error(item, "description item without [term]")
                it["term"] = trim(self.inl.render(item.args[0].nodes))
            elif item.args[0].present:
                ctx.error(item, "\\item[..] label in a non-description list")
            it["blocks"] = self.render(content)
            items.append(it)
        out: dict = {"t": "list", "kind": kind, "items": items, "_env": e.name}
        if kind == "ol" and marker and marker != "1.":
            out["marker"] = marker
        if kind == "ul" and marker == "checkbox":
            out["marker"] = "checkbox"
        if start is not None and start != 1:
            out["start"] = start
        # series bookkeeping
        if e.args and e.args[0].present:
            for k, v in keyvals(e.args[0].raw, e.where()):
                if k in ("series", "resume*"):
                    ctx.series[v]["count"] = (start or 1) - 1 + len(items)
        return out

    # ------------------------------------------------------------------ code
    def code(self, e: Env) -> dict:
        ctx = self.ctx
        lang = CODE_ENVS[e.name]
        title = None
        line_numbers = False
        first_line = None
        small = False
        if e.args and e.args[0].present:
            for k, v in keyvals(e.args[0].raw, e.where()):
                if k == "title":
                    title = self.code_title(strip_braces(v or ""), e)
                elif k == "listing options":
                    for k2, v2 in keyvals(strip_braces(v or ""), e.where()):
                        v2 = strip_braces(v2 or "")
                        if k2 == "language":
                            continue
                        if k2 == "basicstyle":
                            sizes = set(re.findall(r"\\(scriptsize|tiny|footnotesize|small)", v2))
                            default = "footnotesize" if lang == "output" else "small"
                            if sizes and sizes != {default}:
                                small = small or bool(sizes & {"scriptsize", "tiny"}) or (
                                    default == "small" and "footnotesize" in sizes)
                        elif k2 == "numbers":
                            if v2 == "left":
                                line_numbers = True
                            elif v2 != "none":
                                ctx.error(e, f"unsupported numbers={v2}")
                        elif k2 == "firstnumber":
                            first_line = int(v2)
                        elif k2 in ("numberstyle", "numbersep", "keywordstyle", "stringstyle", "commentstyle"):
                            continue
                        else:
                            ctx.error(e, f"unsupported listing option {k2!r}")
                elif k in ("left", "right"):
                    continue
                elif v is None and k in ctx.local_styles:
                    small = True
                else:
                    ctx.error(e, f"unsupported code option {k!r}")
        text = e.body or ""
        if "\t" in text:
            # listings prints a tab up to the next multiple of tabsize=2 (preamble \lstset)
            ctx.stats["code:tabs-expanded"] += text.count("\t")
            text = "\n".join(line.expandtabs(2) for line in text.split("\n"))
        lines = text.split("\n")
        while lines and not lines[-1].strip():
            lines.pop()          # listings does not print trailing empty lines
        text = "\n".join(lines)
        block: dict = {"t": "code", "id": ctx.next_code_id(), "lang": lang, "text": text}
        if title is not None:
            block["title"] = title
        if line_numbers:
            block["lineNumbers"] = True
        if first_line is not None:
            block["firstLine"] = first_line
        if small:
            block["small"] = True
        ctx.stats["code:" + e.name] += 1
        return block

    def code_title(self, raw: str, e: Env) -> str:
        src = Source(f"{e.where()} (title)", raw)
        nodes = Parser(src, state="M").parse_seq()
        return plain(trim(self.inl.render(nodes, mono=True)))

    # ------------------------------------------------------------------ figures
    def tikz(self, e: Env) -> dict:
        ctx = self.ctx
        fid, k = ctx.next_fig_id()
        raw = e.body or ""
        digest = sha1(raw)
        rec = {"id": fid, "chapter": ctx.chapter_number, "k": k, "file": e.src.path,
               "line": e.src.line(e.pos), "endLine": e.src.line(e.end - 1), "sha1": digest}
        ctx.figures.append(rec)
        block: dict = {"t": "figure", "id": fid, "src": f"figures/{fid}.svg", "alt": ""}
        alt = ctx.figure_alts.get(fid)
        if alt:
            if not alt.get("sha1") or not digest.startswith(alt["sha1"]):
                ctx.error(e, f"{fid}: figures.yaml alt text was written for another version of the figure "
                             f"(sha1 {alt['sha1']} != {digest[:12]})")
            block["alt"] = " ".join(str(alt["alt"]).split())
            if alt.get("description"):
                block["description"] = " ".join(str(alt["description"]).split())
        else:
            ctx.stats["figure:alt-missing"] += 1
        ctx.stats["tikz"] += 1
        return block

    def float_env(self, e: Env) -> list:
        ctx = self.ctx
        ctx.stats["env:" + e.name] += 1
        caption = None
        label = None
        rest = []
        seen_caption = False
        for n in e.children:
            if isinstance(n, Cmd) and n.name == "caption":
                caption = trim(self.inl.render(n.args[1].nodes))
                seen_caption = True
            elif isinstance(n, Cmd) and n.name == "label" and seen_caption:
                label = n.args[0].raw.strip()
            else:
                rest.append(n)
        blocks = self.render(rest)
        want = "figure" if e.name == "figure" else "table"
        targets = [b for b in blocks if b.get("t") == want]
        if len(targets) != 1:
            ctx.error(e, f"{e.name} environment must contain exactly one {want} (found {len(targets)})")
        if caption:
            targets[0]["caption"] = caption
        if label:
            targets[0]["anchor"] = anchor_of(label)
        return blocks

    # ------------------------------------------------------------------ boxes
    def box_title(self, e: Env):
        if not (e.args and e.args[0].present):
            return None
        title = None
        for k, v in keyvals(e.args[0].raw, e.where()):
            if k == "title":
                src = Source(f"{e.where()} (title)", strip_braces(v or ""))
                title = trim(self.inl.render(Parser(src, state="M").parse_seq()))
            else:
                self.ctx.error(e, f"unsupported box option {k!r}")
        return title

    def box(self, e: Env) -> dict:
        ctx = self.ctx
        kind = BOXES[e.name]
        ctx.stats["box:" + e.name] += 1
        title = self.box_title(e)
        if kind == "lab":
            return self.lab(e, title)
        if kind == "objectives":
            return self.objectives(e, title)
        out: dict = {"t": "callout", "kind": kind, "blocks": self.render(e.children)}
        if title is not None:
            out["title"] = title
        return out

    def lab(self, e: Env, opt_title) -> dict:
        ctx = self.ctx
        if opt_title is not None:
            ctx.error(e, "labbox with a [title=] option")
        lab_id = ctx.next_lab_id()
        children = list(e.children)
        sig = _sig_children(children)
        anchor = None
        objectives: list[str] = []
        consumed = set()
        for n in sig[:2]:
            if isinstance(n, Cmd) and n.name == "label":
                anchor = anchor_of(n.args[0].raw.strip())
                consumed.add(id(n))
            elif isinstance(n, Cmd) and n.name == "labtag":
                objectives = [x.strip() for x in n.args[0].raw.split(",") if x.strip()]
                for o in objectives:
                    if o not in ctx.objective_ids:
                        ctx.error(n, f"unknown objective id {o!r} in \\labtag")
                consumed.add(id(n))
        for n in children:
            if isinstance(n, Cmd) and n.name == "labtag" and id(n) not in consumed:
                ctx.error(n, "\\labtag must be the first line of the labbox")
        rest = [n for n in children if id(n) not in consumed]
        title = trim(self.inl.render(e.args[1].nodes))
        out = {"t": "lab", "id": lab_id, "title": title, "objectives": objectives, "blocks": self.render(rest)}
        if anchor:
            out["anchor"] = anchor
        ctx.stats["labs"] += 1
        ctx.stats["labtags"] += len(objectives)
        ctx.lab_records.append({"id": lab_id, "title": plain(title), "objectives": objectives,
                                "lesson": ctx.lesson, "rawTitle": e.args[1].raw})
        return out

    def objectives(self, e: Env, title) -> dict:
        ctx = self.ctx
        lists = [n for n in _sig_children(e.children) if isinstance(n, Env)]
        if not lists or lists[0].name != "itemize":
            ctx.error(e, "exambox must start with an itemize of \\objective items")
        lst = lists[0]
        items = []
        for item, content in self.split_items(lst):
            sig = _sig_children(content)
            ids = []
            k = 0
            while k < len(sig) and isinstance(sig[k], Cmd) and sig[k].name == "objective":
                ids.append(sig[k].args[0].raw.strip())
                k += 1
            for oid in ids:
                if oid not in ctx.objective_ids:
                    ctx.error(item, f"unknown objective id {oid!r}")
                ctx.obj_tags.append(oid)
            first_non_obj = sig[k] if k < len(sig) else None
            idx = content.index(first_non_obj) if first_non_obj is not None else len(content)
            c = self.inline_only(content[idx:], item)
            entry: dict = {"id": ids[0] if ids else None, "c": c}
            if len(ids) > 1:
                entry["ids"] = ids
            items.append(entry)
        # content around the list (rare: Part 0 example) is kept as blocks
        before, after = [], []
        seen = False
        for n in e.children:
            if n is lst:
                seen = True
            elif not seen:
                before.append(n)
            else:
                after.append(n)
        if _sig_children(before) and not all(isinstance(n, Cmd) and MACROS[n.name][1] == "layout"
                                             for n in _sig_children(before)):
            ctx.error(e, "content before the objectives list in an exambox")
        out: dict = {"t": "objectives", "items": items}
        if title is not None:
            out["title"] = title
        extra = self.render(after)
        if extra:
            out["blocks"] = extra
        ctx.stats["env:itemize"] += 1
        return out
