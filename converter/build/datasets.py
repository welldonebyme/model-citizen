"""Datasets derived from the rendered book: glossary, objectives + coverage, plan, cheat sheets, traps."""
from __future__ import annotations

import re
from collections import defaultdict

from ..render.context import Ctx
from ..render.inline import InlineRenderer, plain, trim
from ..tex.nodes import ConvertError
from ..tex.parser import parse_string
from .objectives import EXTRA_PREREQUISITES, META, kind_of, topic_of

# ---------------------------------------------------------------------------------------------- glossary
PROPER = {"Git", "Jinja", "DuckDB", "Homebrew", "DataFrame", "JSON", "YAML", "NULL", "GitHub", "Python"}


def display(en: str) -> str:
    """make_glossary.py display(): lower-case a capital that only came from the start of a sentence."""
    first = en.split()[0]
    if first in PROPER or len(first) < 2 or first[1].isupper():
        return en
    return en[0].lower() + en[1:]


def latex_to_text(raw: str, ctx: Ctx) -> str:
    return plain(trim(InlineRenderer(ctx).render(parse_string(raw, "<glossary>"))))


def python_text(raw: str, ctx: Ctx) -> str:
    """Strings of the book's Python tools (make_coverage.OBJECTIVES): resolve LaTeX escapes such as \\_ but apply
    no TeX ligature (they are plain text, e.g. "--empty")."""
    return plain(trim(InlineRenderer(ctx).render(parse_string(raw, "<make_coverage.py>"), mono=True)))


def build_glossary(occurrences: list[dict], ctx: Ctx) -> list[dict]:
    """Same logic as dbt-bible/tools/make_glossary.py: first definition wins, chapter of first appearance."""
    terms: dict[str, dict] = {}
    slugs: dict[str, str] = {}
    for occ in occurrences:
        key = occ["key"]
        if not key:
            continue
        if occ["id"] in slugs and slugs[occ["id"]] != key:
            raise ConvertError(f"{occ['where']}: term id {occ['id']} used for two terms ({slugs[occ['id']]!r}, {key!r})")
        slugs[occ["id"]] = key
        if key not in terms:
            en_raw = display(occ["rawEn"])
            terms[key] = {"id": occ["id"], "key": key, "enRaw": en_raw, "frRaw": occ["rawFr"],
                          "chapter": occ["chapter"], "occurrences": []}
        terms[key]["occurrences"].append({"chapter": occ["chapterId"], "lesson": occ["lesson"], "anchor": occ["anchor"]})
    out = []
    for key in sorted(terms):
        t = terms[key]
        out.append({"id": t["id"], "en": latex_to_text(t["enRaw"], ctx), "fr": latex_to_text(t["frRaw"], ctx),
                    "chapter": t["chapter"], "occurrences": t["occurrences"],
                    "_enRaw": t["enRaw"], "_frRaw": t["frRaw"]})
    return out


def check_glossary_appendix(glossary: list[dict], appc: dict) -> list[str]:
    """Compare with the printed appendix C table (en, fr, chapter)."""
    problems = []
    tables = [b for les in [appc["intro"]] for b in les if b.get("t") == "table"]
    if len(tables) != 1:
        return [f"appendix C: expected one table, found {len(tables)}"]
    rows = [r for i, r in enumerate(tables[0]["rows"]) if i not in set(tables[0].get("groupRows", []))]
    printed = [(plain(r[0]["c"]), plain(r[1]["c"]), plain(r[2]["c"])) for r in rows]
    mine = [(g["en"], g["fr"], str(g["chapter"])) for g in glossary]
    if len(printed) != len(mine):
        problems.append(f"glossary: {len(mine)} terms computed, {len(printed)} printed in Appendix C")
    for a, b in zip(mine, printed):
        if a != b:
            problems.append(f"glossary differs from Appendix C: computed {a} / printed {b}")
    return problems


# ---------------------------------------------------------------------------------------------- objectives / coverage
def build_coverage(results, objectives: list[tuple[str, str]], mock_questions: dict[int, list[dict]], title_ctx: Ctx):
    """make_coverage.py logic: \\objective tags and \\labtag in chapters (not Part 0, not mocks, not appendices)
    -> chapters and labs; \\mockkey objectives -> mock questions. Lessons come from the same tags."""
    ids = [o for o, _ in objectives]
    chapters = defaultdict(set)
    labs = defaultdict(list)
    lessons = defaultdict(list)
    for r in results:
        seg = r.seg
        if seg.unit.appendix or seg.kind in ("mock", "mock-answers") or seg.number == 0:
            continue
        for oid in r.ctx.obj_tags:
            if oid in ids:
                chapters[oid].add(seg.number)
        for les in r.chapter["lessons"]:
            for oid in les["objectives"]:
                if oid in ids and les["id"] not in lessons[oid]:
                    lessons[oid].append(les["id"])
        for lab in r.ctx.lab_records:
            for oid in lab["objectives"]:
                if oid in ids:
                    labs[oid].append(lab["id"])
                    chapters[oid].add(seg.number)
    mocks = defaultdict(list)
    for m in sorted(mock_questions):
        for q in mock_questions[m]:
            if q.get("objective") in ids:
                mocks[q["objective"]].append(q["id"])
    objs = []
    cov = {}
    for oid, title in objectives:
        entry = {"id": oid, "kind": kind_of(oid), "topic": topic_of(oid), "title": python_text(title, title_ctx),
                 "chapters": sorted(chapters[oid]), "labs": labs[oid], "mockQuestions": mocks[oid]}
        objs.append(entry)
        cov[oid] = {"chapters": sorted(chapters[oid]), "lessons": lessons[oid], "labs": labs[oid],
                    "mockQuestions": mocks[oid], "chapterQuestions": []}
    for oid in EXTRA_PREREQUISITES + META:
        ch = sorted({r.seg.number for r in results if oid in r.ctx.obj_tags}
                    | {r.seg.number for r in results for lab in r.ctx.lab_records if oid in lab["objectives"]})
        objs.append({"id": oid, "kind": kind_of(oid), "topic": topic_of(oid), "title": None, "chapters": ch,
                     "labs": [lab["id"] for r in results for lab in r.ctx.lab_records if oid in lab["objectives"]],
                     "mockQuestions": []})
    gaps = []
    for oid, _ in objectives:
        c = cov[oid]
        probs = []
        if not c["chapters"]:
            probs.append("no chapter")
        if not c["lessons"]:
            probs.append("no lesson")
        if not c["labs"]:
            probs.append("no lab")
        if not oid.startswith("CP0") and len(c["mockQuestions"]) < 3:
            probs.append(f"only {len(c['mockQuestions'])} mock questions")
        if probs:
            gaps.append({"objective": oid, "problems": probs})
    return objs, {"objectives": cov, "gaps": gaps}


def check_coverage_appendix(objs: list[dict], appb: dict) -> list[str]:
    tables = [b for b in appb["intro"] if b.get("t") == "table"]
    if len(tables) != 1:
        return [f"appendix B: expected one table, found {len(tables)}"]
    problems = []
    by_id = {o["id"]: o for o in objs}
    for row in tables[0]["rows"]:
        oid = plain(row[0]["c"]).strip()
        o = by_id.get(oid)
        if o is None:
            problems.append(f"appendix B lists unknown objective {oid}")
            continue
        ch = plain(row[2]["c"]).strip()
        mine = ", ".join(str(c) for c in o["chapters"]) or "--"
        if ch.replace("–", "--") != mine:
            problems.append(f"appendix B {oid}: chapters printed {ch!r}, computed {mine!r}")
        mk = plain(row[4]["c"])
        if not oid.startswith("CP0"):
            printed = {(int(m), int(q)) for m, qs in re.findall(r"M(\d): ([\d, ]+)", mk) for q in re.findall(r"\d+", qs)}
            computed = {(int(q[1]), int(q.split("-q")[1])) for q in o["mockQuestions"]}
            if printed != computed:
                problems.append(f"appendix B {oid}: mock questions printed {sorted(printed)}, computed {sorted(computed)}")
    return problems


# ---------------------------------------------------------------------------------------------- plan (Part 0)
def table_rows(block: dict) -> list[list]:
    return [[c["c"] for c in row] for row in block["rows"]]


def build_plan(ch00: dict) -> dict:
    lesson = next((l for l in ch00["lessons"] if l.get("label") == "sec:start-plan"), None)
    if lesson is None:
        raise ConvertError("Part 0: section sec:start-plan not found")
    step0 = lesson["steps"][0]
    t0 = [b for b in step0["blocks"] if b["t"] == "table"]
    if len(t0) != 1:
        raise ConvertError("Part 0 plan: expected one table (the 14-week plan)")
    weeks = []
    for row in table_rows(t0[0]):
        if len(row) != 4:
            raise ConvertError("Part 0 plan: week row without 4 cells")
        weeks.append({"week": int(plain(row[0])), "bible": row[1], "official": row[2], "checkpoint": row[3]})
    if [w["week"] for w in weeks] != list(range(1, 15)):
        raise ConvertError(f"Part 0 plan: weeks {[w['week'] for w in weeks]} are not 1..14")
    head = [plain(c["c"]) for c in t0[0]["head"][0]]
    steps = {s["titleText"]: s for s in lesson["steps"][1:]}

    def only_table(title: str) -> dict:
        s = steps.get(title)
        if s is None:
            raise ConvertError(f"Part 0 plan: subsection {title!r} not found")
        tb = [b for b in s["blocks"] if b["t"] == "table"]
        if len(tb) != 1:
            raise ConvertError(f"Part 0 plan: {title!r} must contain one table")
        return tb[0]

    rhythms = [{"rhythm": r[0], "how": r[1]} for r in table_rows(only_table("Other rhythms"))]
    session = [{"minutes": plain(r[0]), "activity": r[1]} for r in table_rows(only_table("A typical 2-hour study session"))]
    ready = steps.get("When are you ready to book the exam?")
    if ready is None:
        raise ConvertError("Part 0 plan: readiness subsection not found")
    lists = [b for b in ready["blocks"] if b["t"] == "list" and b["kind"] == "ol"]
    if len(lists) != 1 or len(lists[0]["items"]) != 4:
        raise ConvertError("Part 0 plan: expected 4 readiness conditions")
    conditions = [it["blocks"] for it in lists[0]["items"]]
    return {
        "source": lesson["id"], "intro": [b for b in step0["blocks"] if b["t"] != "table"],
        "columns": head, "weeks": weeks, "rhythms": rhythms, "session": session,
        "readiness": {"intro": [b for b in ready["blocks"] if b["t"] != "list"], "conditions": conditions},
    }


# ---------------------------------------------------------------------------------------------- cheat sheets
def build_cheatsheets(appa: dict) -> dict:
    return {"id": appa["id"], "title": appa["title"], "intro": appa["intro"],
            "sections": [{"id": l["id"], "number": l["number"], "title": l["title"], "titleText": l["titleText"],
                          "anchor": l["anchors"][0] if l["anchors"] else None, "steps": l["steps"]}
                         for l in appa["lessons"]]}
