"""Mock exam answers: \\mockkey{n}{objective}{answer} + explanation + \\mockreview{...} (Chapters 29, 31, 33)."""
from __future__ import annotations

import re

from ..render.blocks import BlockRenderer, flatten_block_groups
from ..render.inline import plain, trim
from ..tex.nodes import Cmd, Par, Space
from . import keys as K
from .questions import Draft

WHY_WRONG = re.compile(r"^Why the other(?:s| options)? (?:are|is) wrong\.?$")


def split_mockkeys(nodes: list, ctx) -> tuple[list, list[tuple[Cmd, list]]]:
    nodes = flatten_block_groups(nodes, ctx)
    before: list = []
    segs: list[tuple[Cmd, list]] = []
    for n in nodes:
        if isinstance(n, Cmd) and n.name == "mockkey":
            segs.append((n, []))
        elif segs:
            segs[-1][1].append(n)
        else:
            before.append(n)
    return before, segs


def why_wrong(blocks: list) -> list | None:
    """Lift the 'Why the others are wrong.' list into [{option, c}] (the explanation keeps the full text)."""
    for i, b in enumerate(blocks):
        if b.get("t") == "p" and WHY_WRONG.match(K.norm(plain(b["c"]))) and i + 1 < len(blocks) \
                and blocks[i + 1].get("t") == "list":
            out = []
            for it in blocks[i + 1]["items"]:
                bl = it["blocks"]
                if len(bl) != 1 or bl[0]["t"] != "p":
                    return None
                c = bl[0]["c"]
                if not (c and isinstance(c[0], dict) and c[0].get("t") == "b"):
                    return None
                opt = K.norm(plain(c[0]["c"]))
                if not re.fullmatch(r"[A-Z]", opt):
                    return None
                rest = c[1:]
                if rest and isinstance(rest[0], str):
                    rest = [re.sub(r"^[\s ]*[—–-]+[\s ]*", "", rest[0])] + rest[1:]
                out.append({"option": opt, "c": trim(rest)})
            return out
    return None


def attach_mock_answers(renderer: BlockRenderer, segs: list[tuple[Cmd, list]], drafts: list[Draft]) -> None:
    ctx = renderer.ctx
    if len(segs) != len(drafts):
        ctx.error(segs[0][0] if segs else None, f"{len(segs)} mock answers for {len(drafts)} questions")
    for i, (mk, content) in enumerate(segs):
        n = int(mk.args[0].raw.strip())
        if n != i + 1:
            ctx.error(mk, f"\\mockkey numbers out of order: expected {i + 1}, found {n}")
        d = drafts[i]
        obj = mk.args[1].raw.strip()
        if obj not in ctx.objective_ids:
            ctx.error(mk, f"unknown objective {obj!r}")
        d.objective = obj
        reviews = [k for k, x in enumerate(content) if isinstance(x, Cmd) and x.name == "mockreview"]
        if len(reviews) != 1:
            ctx.error(mk, f"expected one \\mockreview after \\mockkey{{{n}}}, found {len(reviews)}")
        r = reviews[0]
        tail = [x for x in content[r + 1:] if not isinstance(x, (Space, Par))]
        if tail and not all(isinstance(x, Cmd) and x.name in ("medskip", "newpage", "clearpage", "endgroup")
                            for x in tail):
            ctx.error(tail[0], "content after \\mockreview (it would be lost)")
        d.review = trim(renderer.inl.render(content[r].args[0].nodes))
        d.explanation = renderer.render(content[:r])
        ww = why_wrong(d.explanation)
        if ww:
            d.why_wrong = ww
        key_inl = trim(renderer.inl.render(mk.args[2].nodes))
        d.key_raw = mk.args[2].raw
        parse_mock_key(d, key_inl)


def parse_mock_key(d: Draft, key_inl: list) -> None:
    if d.notes:
        d.key_status, d.key_reason = "todo", "; ".join(d.notes)
        return
    text = K.norm(plain(key_inl))
    opts = [o["id"] for o in d.options or []]
    f = d.format
    t = text if text.endswith(".") else text + "."
    if f == "mc":
        res = K.parse_mc(t, opts)
    elif f == "ms":
        res = K.parse_ms(t, opts, d.choose)
    elif f == "order":
        res = K.parse_order(t, opts)
    elif f == "hotspot":
        res = K.parse_hotspot(t)
    elif f == "match":
        res = K.parse_match(text, [x["id"] for x in d.match["left"]], [x["id"] for x in d.match["right"]])
    elif f == "domc":
        res = K.parse_domc_text(text, opts)
    elif f == "fill":
        res = K.parse_mock_fill(key_inl, d.blanks)
    else:
        res = K.todo(f"unknown format {f}")
    d.key_status, d.key_reason, d.key_proposal, d.key = res.status, res.reason, res.proposal, res.key
    if f == "match" and d.match is not None and len(d.match["right"]) < len(d.match["left"]):
        d.match["reuse"] = True
