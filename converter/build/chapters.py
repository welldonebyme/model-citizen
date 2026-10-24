"""Pass 2: render every chapter (intro, lessons/steps, quiz sections, summary), quizzes, mocks and traps."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from ..render.blocks import BlockRenderer, flatten_block_groups
from ..render.context import Ctx, anchor_of
from ..render.inline import is_blocks, plain, trim
from ..tex.nodes import Cmd, ConvertError, Env, Par, Space
from .mocks import attach_mock_answers, split_mockkeys
from .questions import Draft, QuestionBuilder, walk_blocks
from .structure import ChapterSeg, SectionSeg, lesson_id


@dataclass
class BookState:
    """Things that cross chapter boundaries."""
    mock_drafts: dict[int, list[Draft]] = field(default_factory=dict)
    mock_where: dict[int, dict] = field(default_factory=dict)
    traps: list[dict] = field(default_factory=list)


@dataclass
class ChapterResult:
    seg: ChapterSeg
    chapter: dict
    drafts: list[Draft]
    ctx: Ctx


def round5(x: float) -> int:
    return max(5, int(5 * math.floor(x / 5 + 0.5)))


def count_words(blocks: list) -> tuple[int, int, int]:
    words = code_lines = labs = 0

    def inl(items):
        nonlocal words
        for it in items:
            if isinstance(it, str):
                words += len(re.findall(r"[\w'’-]+", it))
            elif isinstance(it, dict):
                if it.get("t") == "code":
                    words += len(it["v"].split())
                elif it.get("t") == "term":
                    inl(it["en"])
                elif isinstance(it.get("c"), list):
                    inl(it["c"])

    for b in walk_blocks(blocks):
        t = b.get("t")
        if t == "code":
            code_lines += len(b["text"].split("\n"))
        elif t in ("p", "h"):
            inl(b["c"])
        elif t == "lab":
            labs += 1
            inl(b["title"])
        elif t == "callout" and b.get("title"):
            inl(b["title"])
        elif t == "objectives":
            for it in b["items"]:
                inl(it["c"])
        elif t == "list":
            for it in b["items"]:
                if it.get("term"):
                    inl(it["term"])
        elif t == "table":
            for row in (b.get("head") or []) + b["rows"]:
                for c in row:
                    cc = c["c"]
                    if not (is_blocks(cc)):
                        inl(cc)
        elif t == "figure" and b.get("caption"):
            inl(b["caption"])
    return words, code_lines, labs


def minutes_of(blocks: list) -> int:
    w, c, l = count_words(blocks)
    return round5(w / 180 + c / 12 + l * 10)


class ChapterBuilder:
    def __init__(self, seg: ChapterSeg, ctx: Ctx, state: BookState):
        self.seg = seg
        self.ctx = ctx
        self.state = state
        self.r = BlockRenderer(ctx)
        self.q = QuestionBuilder(self.r)
        self.summary: list = []
        self.drafts: list[Draft] = []
        self.quiz_sections: list[dict] = []
        self.topic: str | None = None
        self.n_quizboxes = 0

    # ------------------------------------------------------------------ sequences with special envs
    def render_seq(self, nodes: list) -> list:
        nodes = flatten_block_groups(nodes, self.ctx)
        out: list = []
        run: list = []
        pending_drafts: list[Draft] | None = None

        def flush():
            nonlocal run
            if run:
                out.extend(self.r.render(run))
                run = []

        for n in nodes:
            if isinstance(n, Env) and n.name == "summarybox":
                flush()
                if self.summary:
                    self.ctx.error(n, "two summary boxes in one chapter")
                self.ctx.stats["box:summarybox"] += 1
                if n.args and n.args[0].present:
                    self.ctx.error(n, "summarybox with options")
                saved = (self.ctx.lesson, self.ctx.step)
                self.ctx.lesson, self.ctx.step = None, "summary"
                self.summary = self.r.render(n.children)
                self.ctx.lesson, self.ctx.step = saved
            elif isinstance(n, Env) and n.name == "quizbox" and _has(n, "questions"):
                flush()
                self.ctx.stats["box:quizbox"] += 1
                env = _only(n, "questions", self.ctx)
                if n.args and n.args[0].present:
                    self.ctx.error(n, "quiz box with options")
                pending_drafts = self.q.build(env)
                self.n_quizboxes += 1
                for k, d in enumerate(pending_drafts):
                    d.part, d.printed = self.n_quizboxes, k + 1
                start = len(self.drafts)
                self.drafts.extend(pending_drafts)
                ids = [self.qid(start + k + 1) for k in range(len(pending_drafts))]
                out.append({"t": "quiz", "ids": ids})
            elif isinstance(n, Env) and n.name == "answerbox" and _has(n, "answers"):
                flush()
                self.ctx.stats["box:answerbox"] += 1
                if pending_drafts is None:
                    self.ctx.error(n, "answer box without a preceding quiz")
                env = _only(n, "answers", self.ctx)
                self.q.attach_answers(pending_drafts, env)
                pending_drafts = None
            elif isinstance(n, Env) and n.name == "questions":
                flush()
                if self.seg.kind != "mock":
                    self.ctx.error(n, "questions list outside a quiz box")
                drafts = self.q.build(n)
                for k, d in enumerate(drafts):
                    d.part, d.printed = 1, k + 1
                self.state.mock_drafts[self.seg.mock] = drafts
                out.append({"t": "quiz", "ids": [f"m{self.seg.mock}-q{k + 1:02d}" for k in range(len(drafts))]})
            elif isinstance(n, Env) and n.name == "enumerate" and any(
                    isinstance(c, Cmd) and c.name == "cxxviitrap" for c in n.children):
                flush()
                out.append(self.trap_list(n))
            else:
                run.append(n)
        flush()
        if pending_drafts is not None:
            self.ctx.error(None, "quiz without its answer box")
        return out

    def qid(self, n: int) -> str:
        return f"q-{self.seg.id}-{n:02d}"

    # ------------------------------------------------------------------ traps (Chapter 27)
    def trap_list(self, e: Env) -> dict:
        ctx = self.ctx
        if self.seg.number != 27:
            ctx.error(e, "\\cxxviitrap outside Chapter 27")
        marker, start = self.r.list_options(e)
        ids = []
        traps = [c for c in e.children if not isinstance(c, (Space, Par))]
        expected_start = len(self.state.traps) + 1
        if (start or 1) != expected_start:
            ctx.error(e, f"trap numbering: list starts at {start or 1}, expected {expected_start}")
        for c in traps:
            if not (isinstance(c, Cmd) and c.name == "cxxviitrap"):
                ctx.error(c, "only \\cxxviitrap items are allowed in a trap list")
            n = len(self.state.traps) + 1
            where = trim(self.r.inl.render(c.args[2].nodes))
            wtext = plain(where)
            if not re.fullmatch(r"(Chapter \d+|Chapters \d+(?:, \d+)*,? and \d+|Appendix [A-C])", wtext):
                ctx.error(c, f"trap 'where' not in a regular form: {wtext!r}")
            trap = {
                "id": f"trap-{n:03d}", "n": n, "topic": self.topic,
                "confusion": trim(self.r.inl.render(c.args[0].nodes)),
                "truth": trim(self.r.inl.render(c.args[1].nodes)),
                "where": where, "chapters": [int(x) for x in re.findall(r"\d+", wtext)],
                "lesson": ctx.lesson,
            }
            self.state.traps.append(trap)
            ids.append(trap["id"])
        # keep the enumitem series counter in step with the printed numbering
        if e.args and e.args[0].present:
            from ..render.options import keyvals
            for k, v in keyvals(e.args[0].raw, e.where()):
                if k in ("series", "resume*"):
                    ctx.series[v]["count"] = len(self.state.traps)
        ctx.stats["env:enumerate"] += 1
        ctx.stats["traps"] += len(ids)
        return {"t": "traps", "ids": ids}

    # ------------------------------------------------------------------ chapter
    def build(self) -> dict:
        seg, ctx = self.seg, self.ctx
        for n in seg.pre:
            if isinstance(n, Cmd) and n.name in ("newcommand", "renewcommand", "tcbset", "setlength", "tikzset"):
                self.r.render([n])
            elif not isinstance(n, (Space, Par)) and not (isinstance(n, Cmd) and n.name in ("begingroup", "endgroup",
                                                                                            "raggedright")):
                ctx.error(n, "content before \\chapter")
        title = plain(trim(self.r.inl.render(seg.cmd.args[1].nodes)))
        ctx.lesson, ctx.step = None, "intro"
        intro = self.render_seq(seg.intro)
        lessons = []
        for sec in seg.sections:
            if sec.kind == "lesson":
                lessons.append(self.lesson(sec))
            elif sec.kind == "quiz":
                self.quiz_section(sec)
            else:
                self.mock_answers_section(sec)
        ch: dict = {
            "id": seg.id, "number": seg.number, "printed": seg.printed, "kind": seg.kind,
            "part": seg.part.number, "partTitle": seg.part.title, "partLabel": seg.part.label,
            "title": title, "label": seg.label, "intro": intro, "lessons": lessons,
            "quiz": [self.qid(k + 1) for k in range(len(self.drafts))],
            "quizSections": self.quiz_sections, "summary": self.summary,
        }
        if seg.mock:
            ch["mock"] = seg.mock
        ch["objectives"] = sorted(set(ctx.obj_tags), key=_obj_sort)
        ch["minutes"] = sum(l["minutes"] for l in lessons) + round5(len(self.drafts) * 1.5) * (1 if self.drafts else 0)
        return ch

    def lesson(self, sec: SectionSeg) -> dict:
        seg, ctx = self.seg, self.ctx
        lid = lesson_id(seg, sec)
        ctx.lesson = lid
        lab_start = len(ctx.lab_records)
        obj_start = len(ctx.obj_tags)
        title = trim(self.r.inl.render(sec.cmd.args[1].nodes))
        steps = []
        ctx.step = f"{lid}-0"
        pre = self.render_seq(sec.pre)
        if pre:
            steps.append({"id": f"{lid}-0", "title": title, "titleText": plain(title), "blocks": pre})
        anchors = [anchor_of(sec.label)] if sec.label else []
        for sub in sec.subs:
            sid = f"{lid}-{sub.index}"
            ctx.step = sid
            stitle = trim(self.r.inl.render(sub.cmd.args[1].nodes))
            self.topic = plain(stitle)
            blocks = self.render_seq(sub.nodes)
            step = {"id": sid, "title": stitle, "titleText": plain(stitle), "blocks": blocks}
            if sub.number:
                step["number"] = sub.number
            if sub.label:
                step["anchor"] = anchor_of(sub.label)
                anchors.append(step["anchor"])
            steps.append(step)
        self.topic = None
        all_blocks = [b for s in steps for b in s["blocks"]]
        for b in walk_blocks(all_blocks):
            if b.get("anchor") and b["anchor"] not in anchors:
                anchors.append(b["anchor"])
        labs = [r["id"] for r in ctx.lab_records[lab_start:]]
        objs = set(ctx.obj_tags[obj_start:])
        for r in ctx.lab_records[lab_start:]:
            objs.update(r["objectives"])
        lesson = {
            "id": lid, "number": sec.number or "", "title": title, "titleText": plain(title),
            "anchors": anchors, "steps": steps, "minutes": minutes_of(all_blocks), "labs": labs,
            "objectives": sorted(objs, key=_obj_sort), "checkpoints": [],
        }
        if sec.label:
            lesson["label"] = sec.label
        ctx.lesson = None
        return lesson

    def quiz_section(self, sec: SectionSeg) -> None:
        ctx = self.ctx
        if sec.subs:
            ctx.error(sec.cmd, "subsections inside a quiz section")
        ctx.lesson, ctx.step = None, "quiz"
        title = trim(self.r.inl.render(sec.cmd.args[1].nodes))
        blocks = self.render_seq(sec.pre)
        qs = {"number": sec.number or "", "title": title, "titleText": plain(title), "blocks": blocks,
              "ids": [i for b in blocks if b.get("t") == "quiz" for i in b["ids"]]}
        if sec.label:
            qs["label"] = sec.label
            qs["anchor"] = anchor_of(sec.label)
        self.quiz_sections.append(qs)

    def mock_answers_section(self, sec: SectionSeg) -> None:
        ctx = self.ctx
        if sec.subs:
            ctx.error(sec.cmd, "subsections inside a mock answers section")
        ctx.lesson, ctx.step = None, "answers"
        mock = self.seg.mock
        drafts = self.state.mock_drafts.get(mock)
        if drafts is None:
            ctx.error(sec.cmd, f"answers of mock {mock} before its questions")
        before, segs = split_mockkeys(sec.pre, ctx)
        intro = self.render_seq(before)
        attach_mock_answers(self.r, segs, drafts)
        title = trim(self.r.inl.render(sec.cmd.args[1].nodes))
        ids = [f"m{mock}-q{k + 1:02d}" for k in range(len(drafts))]
        qs = {"number": sec.number or "", "title": title, "titleText": plain(title),
              "blocks": intro + [{"t": "quiz", "ids": ids}], "ids": ids, "kind": "mock-answers"}
        if sec.label:
            qs["label"] = sec.label
        self.quiz_sections.append(qs)
        ctx.stats["mockkeys"] += len(segs)


def _has(env: Env, name: str) -> bool:
    return any(isinstance(c, Env) and c.name == name for c in env.children)


def _only(env: Env, name: str, ctx) -> Env:
    from ..tex.macros import MACROS
    sig = [c for c in env.children if not isinstance(c, (Space, Par))
           and not (isinstance(c, Cmd) and MACROS[c.name][1] in ("layout", "decl"))]
    if len(sig) != 1 or not (isinstance(sig[0], Env) and sig[0].name == name):
        ctx.error(env, f"{env.name} must contain only the {name} list (other content would be lost)")
    return sig[0]


def _obj_sort(o: str):
    if o.startswith("CP0"):
        return (0, 0, o)
    if o[0].isdigit():
        a, b = o.split(".")
        return (1, int(a) * 100 + int(b), o)
    return (2, 0, o)
