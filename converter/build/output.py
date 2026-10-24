"""Assemble every output document (in memory) from the build result."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import yaml

from ..render.context import Ctx
from ..render.inline import plain
from ..rewrite import PathRewriter, scan_book
from ..tex.nodes import ConvertError
from . import keys as K
from .book import BuildResult
from .datasets import (build_cheatsheets, build_coverage, build_glossary, build_plan, check_coverage_appendix,
                       check_glossary_appendix)
from .objectives import all_ids, topic_of
from .questions import Draft, strip_private

LABEL_WORD = {"ch": "Chapter", "app": "Appendix", "sec": "Section", "subsec": "Section", "lab": "Lab",
              "fig": "Figure", "tab": "Table", "quiz": "Section"}


def qhash(d: Draft) -> str:
    """Hash of the book text an override applies to (stem + options + key as written)."""
    payload = json.dumps([d.key_raw, d.stem, d.options, d.match], sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]


def question_json(d: Draft, qid: str, source: dict) -> dict:
    q: dict = {"id": qid, "source": source, "format": d.format, "formatLabel": d.format_label, "stem": d.stem,
               "key": d.key, "keyRaw": d.key_raw, "keyStatus": d.key_status, "explanation": d.explanation}
    if d.choose is not None:
        q["choose"] = d.choose
    if d.options is not None:
        q["options"] = d.options
    if d.match is not None:
        q["match"] = d.match
    if d.hotspot is not None:
        q["hotspot"] = d.hotspot
    if d.format == "fill":
        q["blanks"] = d.blanks
    if d.objective:
        q["objective"] = d.objective
        t = topic_of(d.objective)
        if t:
            q["topic"] = t
    if d.why_wrong:
        q["whyWrong"] = d.why_wrong
    if d.review is not None:
        q["review"] = d.review
    if d.key_status != "ok":
        q["keyNote"] = d.key_reason
    return q


def apply_overrides(drafts_by_id: dict[str, Draft], overrides: Path) -> list[str]:
    p = overrides / "keys.yaml"
    applied = []
    if not p.exists():
        return applied
    data = yaml.safe_load(p.read_text()) or {}
    for qid, ov in (data.get("keys") or {}).items():
        d = drafts_by_id.get(qid)
        if d is None:
            raise ConvertError(f"overrides/keys.yaml: unknown question {qid}")
        if ov.get("hash") != qhash(d):
            raise ConvertError(f"overrides/keys.yaml: {qid} was written for another version of the question "
                               f"(hash {ov.get('hash')} != {qhash(d)}); re-check it against the book")
        d.key = ov["key"]
        d.key_status = "override"
        d.key_reason = ov.get("note", "")
        applied.append(qid)
    return applied


def todo_entry(qid: str, d: Draft) -> dict:
    e = {"id": qid, "where": d.where, "format": d.format, "formatLabel": d.format_label, "hash": qhash(d),
         "reason": d.key_reason, "keyRaw": d.key_raw,
         "stem": "\n\n".join(block_text(b) for b in d.stem)}
    if d.options:
        e["options"] = {o["id"]: plain(o["c"]) for o in d.options}
    if d.match:
        e["match"] = {"left": {x["id"]: plain(x["c"]) for x in d.match["left"]},
                      "right": {x["id"]: plain(x["c"]) for x in d.match["right"]}}
    if d.hotspot:
        e["hotspot"] = d.hotspot
    if d.format == "fill":
        e["blanks"] = d.blanks
    if d.key_proposal is not None:
        e["proposal"] = d.key_proposal
    if d.key is not None:
        e["currentKey"] = d.key
    e["explanation"] = "\n\n".join(block_text(b) for b in d.explanation)
    return e


def block_text(b: dict) -> str:
    t = b.get("t")
    if t == "p":
        return plain(b["c"])
    if t == "code":
        return f"[code {b['lang']}{' ' + b['title'] if b.get('title') else ''}]\n{b['text']}"
    if t == "list":
        return "\n".join("- " + " ".join(block_text(x) for x in it["blocks"]) for it in b["items"])
    if t == "table":
        rows = (b.get("head") or []) + b["rows"]
        return "\n".join(" | ".join(plain(c["c"]) if not isinstance(c["c"], list) or not c["c"] or
                                    not isinstance(c["c"][0], dict) or "c" in c["c"][0] or "v" in c["c"][0]
                                    else " ".join(block_text(x) for x in c["c"]) for c in r) for r in rows)
    if t in ("callout",):
        return " ".join(block_text(x) for x in b["blocks"])
    return f"[{t}]"


def check_mock_tables(res: BuildResult, mocks_json: dict[int, list[dict]]) -> list[str]:
    """The answer chapters print a score table (topic -> question numbers) and Mock 3 a quick answer key:
    both must agree with the \\mockkey data."""
    import re
    problems = []
    for r in res.chapters:
        if r.seg.kind != "mock-answers":
            continue
        m = r.seg.mock
        qs = mocks_json[m]
        by_topic: dict[int, set] = {}
        for q in qs:
            by_topic.setdefault(q.get("topic"), set()).add(q["source"]["n"])
        tables = [b for l in r.chapter["lessons"] for s in l["steps"] for b in s["blocks"] if b.get("t") == "table"]
        score = [t for t in tables if t.get("head") and plain(t["head"][0][1]["c"]) == "Questions"]
        if len(score) != 1:
            problems.append(f"{r.seg.id}: score table not found")
        else:
            for row in score[0]["rows"]:
                mt = re.match(r"(\d)\.", plain(row[0]["c"]))
                if not mt:
                    continue
                printed = {int(x) for x in re.findall(r"\d+", plain(row[1]["c"]))}
                topic = int(mt.group(1))
                if printed != by_topic.get(topic, set()):
                    problems.append(f"{r.seg.id} score table, topic {topic}: printed {sorted(printed)} "
                                    f"but \\mockkey objectives give {sorted(by_topic.get(topic, set()))}")
        quick = [t for t in tables if t.get("head") and plain(t["head"][0][0]["c"]) == "Q"]
        for t in quick:
            pairs = []
            for row in t["rows"]:
                for i in range(0, len(row) - 1, 2):
                    n = plain(row[i]["c"]).strip()
                    if n.isdigit():
                        pairs.append((int(n), " ".join(plain(row[i + 1]["c"]).split())))
            for n, printed in pairs:
                raw = qs[n - 1]["keyRaw"]
                from ..tex.parser import parse_string
                from ..render.inline import InlineRenderer
                tctx = Ctx(chapter_id="x", chapter_number=-1, chapter_label="", labels=res.labels,
                           objective_ids=all_ids(res.objectives), term_ids={})
                mine = " ".join(plain(InlineRenderer(tctx).render(parse_string(raw))).split())
                if mine != printed:
                    problems.append(f"{r.seg.id} quick answer key Q{n}: printed {printed!r}, \\mockkey says {mine!r}")
            if len(pairs) != len(qs):
                problems.append(f"{r.seg.id} quick answer key lists {len(pairs)} answers for {len(qs)} questions")
    return problems


def assemble(res: BuildResult, book: Path, rules: Path, overrides: Path) -> tuple[dict[str, object], dict]:
    files: dict[str, object] = {}
    info: dict = {"todo": [], "overrides": [], "problems": [], "rewrites": []}
    chapters = {r.seg.id: r for r in res.chapters}

    # ------------------------------------------------------------------ questions
    drafts_by_id: dict[str, Draft] = {}
    q_sources: dict[str, dict] = {}
    for r in res.chapters:
        nparts = max([d.part for d in r.drafts], default=0)
        for i, d in enumerate(r.drafts, 1):
            qid = f"q-{r.seg.id}-{i:02d}"
            src = {"kind": "chapter", "chapter": r.seg.number, "n": i}
            if nparts > 1:
                src["quiz"] = d.part
                src["printed"] = d.printed
            drafts_by_id[qid] = d
            q_sources[qid] = src
    mock_ids: dict[int, list[str]] = {}
    for m, drafts in sorted(res.state.mock_drafts.items()):
        mock_ids[m] = []
        for i, d in enumerate(drafts, 1):
            qid = f"m{m}-q{i:02d}"
            drafts_by_id[qid] = d
            q_sources[qid] = {"kind": "mock", "mock": m, "n": i}
            mock_ids[m].append(qid)
    info["overrides"] = apply_overrides(drafts_by_id, overrides)
    for qid, d in drafts_by_id.items():
        q = question_json(d, qid, q_sources[qid])
        if d.key_status in ("ok", "override"):
            err = K.validate(strip_private(q))
            if err:
                raise ConvertError(f"{d.where}: {qid}: {err}")
        else:
            info["todo"].append(todo_entry(qid, d))
    for r in res.chapters:
        if r.drafts:
            files[f"questions/{r.seg.id}.json"] = [
                question_json(d, f"q-{r.seg.id}-{i:02d}", q_sources[f"q-{r.seg.id}-{i:02d}"])
                for i, d in enumerate(r.drafts, 1)]
    mocks_json: dict[int, list[dict]] = {}
    for m, qids in mock_ids.items():
        qs = [question_json(drafts_by_id[qid], qid, q_sources[qid]) for qid in qids]
        mocks_json[m] = qs
        qch = next(r for r in res.chapters if r.seg.kind == "mock" and r.seg.mock == m)
        ach = next(r for r in res.chapters if r.seg.kind == "mock-answers" and r.seg.mock == m)
        files[f"mocks/mock{m}.json"] = {
            "id": f"mock{m}", "mock": m, "title": qch.chapter["title"], "chapter": qch.seg.id,
            "answersChapter": ach.seg.id, "minutes": 120, "questions": qs,
            "formats": dict(sorted(Counter(q["format"] for q in qs).items())),
            "topics": {str(k): v for k, v in sorted(Counter(q.get("topic") for q in qs if q.get("topic")).items())},
        }

    # ------------------------------------------------------------------ chapters + book
    book_parts: list[dict] = []
    appendices: list[dict] = []
    for r in res.chapters:
        ch = r.chapter
        files[f"chapters/{r.seg.id}.json"] = ch
        summary = {"id": ch["id"], "number": ch["number"], "printed": ch["printed"], "kind": ch["kind"],
                   "title": ch["title"], "label": ch["label"], "minutes": ch["minutes"],
                   "lessons": [{"id": l["id"], "number": l["number"], "title": l["titleText"], "label": l.get("label"),
                                "minutes": l["minutes"], "steps": len(l["steps"]), "labs": len(l["labs"])}
                               for l in ch["lessons"]],
                   "quizQuestions": len(ch["quiz"]), "labs": len(r.ctx.lab_records), "objectives": ch["objectives"]}
        if ch.get("mock"):
            summary["mock"] = ch["mock"]
        if r.seg.unit.appendix:
            appendices.append(summary)
            continue
        if not book_parts or book_parts[-1]["number"] != r.seg.part.number:
            book_parts.append({"number": r.seg.part.number, "label": r.seg.part.label, "title": r.seg.part.title,
                               "chapters": []})
        book_parts[-1]["chapters"].append(summary)
    files["book.json"] = {"title": "The dbt Analytics Engineering Bible", "parts": book_parts, "appendices": appendices}

    # ------------------------------------------------------------------ labels
    files["labels.json"] = {lab: {"href": i.href, "text": f"{LABEL_WORD[i.kind]} {i.number}", "kind": i.kind,
                                  "chapter": i.chapter, **({"lesson": i.lesson} if i.lesson else {})}
                            for lab, i in sorted(res.labels.items())}

    # ------------------------------------------------------------------ datasets
    tctx = Ctx(chapter_id="data", chapter_number=-1, chapter_label="", labels=res.labels,
               objective_ids=all_ids(res.objectives), term_ids={})
    occurrences = [o for r in res.chapters for o in r.ctx.term_occurrences]
    glossary = build_glossary(occurrences, tctx)
    info["problems"] += check_glossary_appendix(glossary, chapters["appC"].chapter)
    files["glossary.json"] = glossary
    objs, cov = build_coverage(res.chapters, res.objectives, mocks_json, tctx)
    info["problems"] += check_coverage_appendix(objs, chapters["appB"].chapter)
    files["objectives.json"] = objs
    files["coverage.json"] = cov
    info["problems"] += check_mock_tables(res, mocks_json)
    files["traps.json"] = [{k: v for k, v in t.items() if k != "lesson"} for t in res.state.traps]
    files["plan.json"] = build_plan(chapters["ch00"].chapter)
    files["cheatsheets.json"] = build_cheatsheets(chapters["appA"].chapter)

    # ------------------------------------------------------------------ private keys out, path rewrites
    files = {k: strip_private(v) for k, v in files.items()}
    rw = PathRewriter(rules / "paths.yaml")
    log: list = []
    for k in sorted(files):
        files[k] = rw.tree(files[k], log, k)
    info["rewrites"] = log
    info["pathOccurrences"] = scan_book(book, rules / "paths.yaml")
    return files, info
