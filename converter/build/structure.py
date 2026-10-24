"""Pass 1: split the book into chapters / sections / subsections and register every \\label.

Ids follow SCHEMA.md: chapter "ch07" (appendices appA/appB/appC), lesson "ch07-s3" = 3rd \\section of the chapter
(\\section* included; the quiz section keeps its number, so lesson numbers equal printed section numbers).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..render.context import LabelInfo, anchor_of
from ..tex.nodes import Cmd, ConvertError, Env, Group, Par, Space, walk
from ..tex.source import PartInfo, Unit, load_units

APPENDIX_IDS = ["appA", "appB", "appC"]


@dataclass
class SubSeg:
    cmd: Cmd
    index: int                 # 1-based ordinal of the \subsection(*) in its section
    number: str | None         # printed number "7.3.2" (None for \subsection*)
    label: str | None
    nodes: list


@dataclass
class SectionSeg:
    cmd: Cmd
    index: int                 # 1-based ordinal of the \section(*) in the chapter
    number: str | None         # printed "7.3" / "A.3" (None for \section*)
    label: str | None
    pre: list                  # nodes before the first \subsection (step 0)
    subs: list[SubSeg]
    kind: str = "lesson"       # lesson | quiz | mock-answers

    @property
    def all_nodes(self) -> list:
        out = list(self.pre)
        for s in self.subs:
            out.extend(s.nodes)
        return out


@dataclass
class ChapterSeg:
    unit: Unit
    number: int                # inventory numbering 0..36
    id: str                    # ch07 / appA
    printed: str               # "7" / "A"
    cmd: Cmd                   # \chapter
    label: str | None
    kind: str                  # start | chapter | strategy | mock | mock-answers | appendix
    mock: int | None
    pre: list                  # definitions before \chapter (must be definitions/layout only)
    intro: list
    sections: list[SectionSeg] = field(default_factory=list)

    @property
    def part(self) -> PartInfo:
        return self.unit.part


def _skip_label(nodes: list, i: int) -> tuple[str | None, int]:
    """If the next significant node after index i is \\label, return (label, index after it)."""
    j = i
    while j < len(nodes) and isinstance(nodes[j], (Space, Par)):
        j += 1
    if j < len(nodes) and isinstance(nodes[j], Cmd) and nodes[j].name == "label":
        return nodes[j].args[0].raw.strip(), j + 1
    return None, i


def _nested_struct(nodes: list, names: set) -> None:
    for n in nodes:
        if isinstance(n, (Group, Env)):
            for m in walk(n.children if isinstance(n, Group) else n.children):
                if isinstance(m, Cmd) and m.name in names:
                    raise ConvertError(f"{m.where()}: \\{m.name} nested inside a group or environment")


def chapter_kind(number: int, appendix: bool) -> tuple[str, int | None]:
    if appendix:
        return "appendix", None
    if number == 0:
        return "start", None
    if number == 27:
        return "strategy", None
    if number in (28, 30, 32):
        return "mock", (number - 26) // 2
    if number in (29, 31, 33):
        return "mock-answers", (number - 27) // 2
    return "chapter", None


def section_kind(nodes: list) -> str:
    for n in nodes:
        if isinstance(n, Env) and n.name == "quizbox" and any(
                isinstance(c, Env) and c.name == "questions" for c in n.children):
            return "quiz"
        if isinstance(n, Cmd) and n.name == "mockkey":
            return "mock-answers"
    return "lesson"


class _Err:
    def error(self, node, msg):
        raise ConvertError(f"{node.where() if node is not None else '?'}: {msg}")


def segment(book: Path) -> list[ChapterSeg]:
    from ..render.blocks import flatten_block_groups
    units = load_units(book)
    chapters: list[ChapterSeg] = []
    n_app = 0
    for i, unit in enumerate(units):
        # a {\raggedright ... \par} group may span headings: groups with block content are transparent
        nodes = flatten_block_groups(unit.nodes, _Err())
        unit.nodes = nodes
        _nested_struct(nodes, {"chapter", "section", "subsection", "subsubsection"})
        idx = [k for k, n in enumerate(nodes) if isinstance(n, Cmd) and n.name == "chapter"]
        if len(idx) != 1:
            raise ConvertError(f"{unit.path}: expected exactly one \\chapter, found {len(idx)}")
        k = idx[0]
        number = i
        if unit.appendix:
            cid, printed = APPENDIX_IDS[n_app], "ABC"[n_app]
            n_app += 1
        else:
            cid, printed = f"ch{number:02d}", str(number)
        kind, mock = chapter_kind(number, unit.appendix)
        label, after = _skip_label(nodes, k + 1)
        seg = ChapterSeg(unit, number, cid, printed, nodes[k], label, kind, mock, nodes[:k], [], [])
        rest = nodes[after:]
        # sections
        sec_idx = [j for j, n in enumerate(rest) if isinstance(n, Cmd) and n.name == "section"]
        seg.intro = rest[:sec_idx[0]] if sec_idx else rest
        for s_i, j in enumerate(sec_idx):
            end = sec_idx[s_i + 1] if s_i + 1 < len(sec_idx) else len(rest)
            cmd = rest[j]
            slabel, body_start = _skip_label(rest, j + 1)
            body = rest[body_start:end]
            sub_idx = [q for q, n in enumerate(body) if isinstance(n, Cmd) and n.name == "subsection"]
            pre = body[:sub_idx[0]] if sub_idx else body
            subs = []
            for t_i, q in enumerate(sub_idx):
                qend = sub_idx[t_i + 1] if t_i + 1 < len(sub_idx) else len(body)
                sl, sb = _skip_label(body, q + 1)
                subs.append(SubSeg(body[q], t_i + 1, None, sl, body[sb:qend]))
            sec = SectionSeg(cmd, s_i + 1, None, slabel, pre, subs)
            sec.kind = section_kind(sec.all_nodes)
            seg.sections.append(sec)
        number_sections(seg)
        chapters.append(seg)
    return chapters


def number_sections(seg: ChapterSeg) -> None:
    n_sec = 0
    for sec in seg.sections:
        if not sec.cmd.star:
            n_sec += 1
            sec.number = f"{seg.printed}.{n_sec}"
        n_sub = 0
        for sub in sec.subs:
            if not sub.cmd.star:
                n_sub += 1
                if sec.number is None:
                    raise ConvertError(f"{sub.cmd.where()}: numbered subsection in an unnumbered section")
                sub.number = f"{sec.number}.{n_sub}"


# ---------------------------------------------------------------------------------------------- labels
def lesson_id(seg: ChapterSeg, sec: SectionSeg) -> str:
    return f"{seg.id}-s{sec.index}"


def quiz_route(seg: ChapterSeg, sec: SectionSeg) -> str:
    quiz_secs = [s for s in seg.sections if s.kind == "quiz"]
    base = f"/learn/{seg.id}/quiz/"
    if len(quiz_secs) > 1 and sec.label:
        return base + "#" + anchor_of(sec.label)
    return base


def register_labels(chapters: list[ChapterSeg]) -> dict[str, LabelInfo]:
    labels: dict[str, LabelInfo] = {}

    def add(info: LabelInfo, node) -> None:
        if info.label in labels:
            raise ConvertError(f"{node.where()}: duplicate \\label{{{info.label}}}")
        labels[info.label] = info

    for seg in chapters:
        ch_href = f"/learn/{seg.id}/"
        if seg.label:
            kind = "app" if seg.unit.appendix else "ch"
            add(LabelInfo(seg.label, kind, seg.printed, ch_href, seg.id), seg.cmd)
        lab_n = fig_n = tab_n = 0

        def scan(nodes: list, lesson: str | None, base_href: str):
            nonlocal lab_n, fig_n, tab_n
            for n in walk(nodes):
                if isinstance(n, Env) and n.name == "labbox":
                    lab_n += 1
                    for c in n.children:
                        if isinstance(c, (Space, Par)):
                            continue
                        if isinstance(c, Cmd) and c.name == "label":
                            lab = c.args[0].raw.strip()
                            a = anchor_of(lab)
                            add(LabelInfo(lab, "lab", f"{seg.printed}.{lab_n}", base_href + "#" + a,
                                          seg.id, lesson, a), c)
                        break
                elif isinstance(n, Env) and n.name in ("figure", "table"):
                    has_caption = any(isinstance(c, Cmd) and c.name == "caption" for c in n.children)
                    if not has_caption:
                        continue
                    if n.name == "figure":
                        fig_n += 1
                        num = f"{seg.printed}.{fig_n}"
                    else:
                        tab_n += 1
                        num = f"{seg.printed}.{tab_n}"
                    seen = False
                    for c in n.children:
                        if isinstance(c, Cmd) and c.name == "caption":
                            seen = True
                        elif isinstance(c, Cmd) and c.name == "label" and seen:
                            lab = c.args[0].raw.strip()
                            a = anchor_of(lab)
                            add(LabelInfo(lab, "fig" if n.name == "figure" else "tab", num,
                                          base_href + "#" + a, seg.id, lesson, a), c)

        scan(seg.intro, None, ch_href)
        for sec in seg.sections:
            if sec.kind == "lesson":
                lid = lesson_id(seg, sec)
                href = f"/learn/{seg.id}/{lid}/"
            elif sec.kind == "quiz":
                lid = None
                href = quiz_route(seg, sec)
            else:
                lid = None
                href = f"/learn/{seg.id}/answers/"
            if sec.label:
                number = sec.number or ""
                add(LabelInfo(sec.label, "sec" if sec.kind == "lesson" else "quiz", number, href, seg.id, lid,
                              anchor_of(sec.label)), sec.cmd)
            scan(sec.pre, lid, href.split("#")[0])
            for sub in sec.subs:
                if sub.label:
                    a = anchor_of(sub.label)
                    add(LabelInfo(sub.label, "subsec", sub.number or "", href.split("#")[0] + "#" + a, seg.id, lid,
                                  a), sub.cmd)
                scan(sub.nodes, lid, href.split("#")[0])
    for info in labels.values():
        if not info.number:
            raise ConvertError(f"label {info.label}: points to an unnumbered heading (no printable number)")
    return labels
