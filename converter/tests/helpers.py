"""Small helpers to render LaTeX snippets in tests."""
from __future__ import annotations

from converter.render.blocks import BlockRenderer
from converter.render.context import Ctx, LabelInfo
from converter.render.inline import InlineRenderer, trim
from converter.tex.nodes import Source
from converter.tex.parser import Parser

OBJECTIVES = {"1.1", "1.4", "1.11", "1.14", "CP0-SQL", "CP0-YAML", "EXAM"}


def make_ctx(**kw) -> Ctx:
    labels = {
        "ch:sql": LabelInfo("ch:sql", "ch", "4", "/learn/ch04/", "ch04"),
        "sec:sql-null": LabelInfo("sec:sql-null", "sec", "4.4", "/learn/ch04/ch04-s4/", "ch04", "ch04-s4",
                                  "sec-sql-null"),
        "sec:sub": LabelInfo("sec:sub", "subsec", "7.3.2", "/learn/ch07/ch07-s3/#sec-sub", "ch07", "ch07-s3",
                             "sec-sub"),
    }
    base = dict(chapter_id="ch99", chapter_number=99, chapter_label="99", labels=labels,
                objective_ids=set(OBJECTIVES), term_ids={})
    base.update(kw)
    return Ctx(**base)


def parse(tex: str, path: str = "test.tex"):
    return Parser(Source(path, tex)).parse_seq()


def inline(tex: str, ctx: Ctx | None = None, mono: bool = False) -> list:
    ctx = ctx or make_ctx()
    return trim(InlineRenderer(ctx).render(parse(tex), mono=mono))


def blocks(tex: str, ctx: Ctx | None = None) -> list:
    ctx = ctx or make_ctx()
    return BlockRenderer(ctx).render(parse(tex))
