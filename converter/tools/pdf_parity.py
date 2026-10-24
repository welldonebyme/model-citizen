"""Text parity with the PDF: find runs of words printed in the PDF that are missing from the generated JSON.

    converter/.venv/bin/python -m converter.tools.pdf_parity [--min 8] [chNN ...]

Uses `pdftotext` (poppler). The PDF also prints things that are not content (running heads, page numbers, box
titles, figure labels, "(FR: ...)" term translations, option letters), so every reported run is reviewed by a
human; the tool exists to make silent losses visible, not to pass/fail.
"""
from __future__ import annotations

import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

from ..config import OUT, PDF
from ..render.inline import plain

WORD = re.compile(r"[A-Za-z0-9]+")


def pdf_text() -> str:
    return subprocess.run(["pdftotext", str(PDF), "-"], check=True, capture_output=True, text=True).stdout


def split_chapters(text: str, chapters: list[dict]) -> dict[str, str]:
    lines = text.split("\n")
    starts = []
    for ch in chapters:
        head = f"Chapter {ch['number']}" if ch["kind"] != "appendix" else f"Appendix {ch['printed']}"
        title = ch["title"]
        for i, l in enumerate(lines):
            if l.strip() == head and any(x.strip() and title.startswith(x.strip()) for x in lines[i + 1:i + 4]):
                starts.append((i, ch["id"]))
                break
        else:
            print(f"warning: start of {ch['id']} not found in the PDF text", file=sys.stderr)
    starts.sort()
    out = {}
    for k, (i, cid) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(lines)
        out[cid] = "\n".join(lines[i:end])
    return out


def strip_running_heads(text: str, ch: dict) -> str:
    """Remove page furniture: page numbers, the book title footer, chapter / section running heads."""
    heads = {"The dbt Analytics Engineering Bible", f"{ch['printed']}. {ch['title']}"}
    for l in ch["lessons"]:
        if l["number"]:
            heads.add(f"{l['number']} {l['titleText']}")
    for q in ch["quizSections"]:
        if q["number"]:
            heads.add(f"{q['number']} {q['titleText']}")
    out = []
    for line in text.split("\n"):
        s = line.strip()
        if re.fullmatch(r"[0-9]+|[ivxlc]+", s) or s in heads:
            continue
        out.append(line)
    return "\n".join(out)


def blocks_text(blocks, out: list) -> None:
    for b in blocks or []:
        t = b.get("t")
        if t == "p":
            out.append(plain(b["c"]))
        elif t == "h":
            out.append(plain(b["c"]))
        elif t == "code":
            if b.get("title"):
                out.append(b.get("titleBook", b["title"]))
            out.append(b.get("textBook", b["text"]))
        elif t == "callout":
            if b.get("title"):
                out.append(plain(b["title"]))
            blocks_text(b["blocks"], out)
        elif t == "lab":
            out.append(plain(b["title"]))
            out.append(", ".join(b["objectives"]))
            blocks_text(b["blocks"], out)
        elif t == "objectives":
            for it in b["items"]:
                out.append((it["id"] or "") + " " + plain(it["c"]))
            blocks_text(b.get("blocks"), out)
        elif t == "list":
            for it in b["items"]:
                if it.get("term"):
                    out.append(plain(it["term"]))
                blocks_text(it["blocks"], out)
        elif t == "table":
            for row in (b.get("head") or []) + b["rows"]:
                for c in row:
                    cc = c["c"]
                    if cc and isinstance(cc[0], dict) and (cc[0].get("t") in ("p", "list", "table", "callout")
                                                           or (cc[0].get("t") == "code" and "text" in cc[0])):
                        blocks_text(cc, out)
                    else:
                        out.append(plain(cc))
            if b.get("caption"):
                out.append(plain(b["caption"]))
        elif t == "figure":
            if b.get("caption"):
                out.append(plain(b["caption"]))
        elif t in ("quiz", "traps", "hr"):
            out.append(f"[[{t}:{','.join(b.get('ids', []))}]]")


def question_text(q: dict, out: list) -> None:
    out.append(q["formatLabel"])
    blocks_text(q["stem"], out)
    for o in q.get("options") or []:
        out.append(plain(o["c"]))
        blocks_text(o.get("blocks"), out)
    m = q.get("match")
    if m:
        for x in m["left"]:
            out.append(plain(x["c"]))
        for x in m["right"]:
            out.append(plain(x["c"]))


def chapter_text(ch: dict, questions: dict, mocks: dict, traps: list) -> str:
    out: list[str] = [ch["title"]]
    blocks_text(ch["intro"], out)
    sections = [(int(l["id"].rsplit("-s", 1)[1]), "lesson", l) for l in ch["lessons"]]
    sections += [(q["index"], "quiz", q) for q in ch["quizSections"]]
    for _, kind, sec in sorted(sections, key=lambda x: x[0]):
        out.append(plain(sec["title"]))
        if kind == "quiz":
            blocks_text(sec["blocks"], out)
            continue
        for s in sec["steps"]:
            if s["id"].endswith("-0"):
                blocks_text(s["blocks"], out)
            else:
                out.append(plain(s["title"]))
                blocks_text(s["blocks"], out)
    text = "\n".join(out)
    # expand quiz / trap placeholders in reading order
    qmap = {q["id"]: q for qq in questions.values() for q in qq}
    for m in mocks.values():
        for q in m["questions"]:
            qmap[q["id"]] = q
    tmap = {t["id"]: t for t in traps}

    def expand(mt):
        kind, ids = mt.group(1), [i for i in mt.group(2).split(",") if i]
        parts: list[str] = []
        if kind == "traps":
            for i in ids:
                t = tmap[i]
                parts += [plain(t["confusion"]), plain(t["truth"]), plain(t["where"])]
            return "\n".join(parts)
        if kind == "quiz":
            if ch["kind"] != "mock-answers":
                for i in ids:
                    question_text(qmap[i], parts)
            if ch["kind"] != "mock":
                for i in ids:
                    q = qmap[i]
                    if q["source"]["kind"] == "mock":
                        parts.append(q["keyRaw"])
                    blocks_text(q["explanation"], parts)
                    if q.get("review"):
                        parts.append(plain(q["review"]))
            return "\n".join(parts)
        return ""

    text = re.sub(r"\[\[(quiz|traps|hr):([^\]]*)\]\]", expand, text)
    extra: list[str] = []
    blocks_text(ch["summary"], extra)
    return text + "\n" + "\n".join(extra)


def words(s: str) -> list[str]:
    s = s.replace("’", "'").replace("ﬁ", "fi").replace("ﬂ", "fl")
    return [w.lower() for w in WORD.findall(s)]


def main(argv: list[str]) -> int:
    min_run = 8
    only = []
    i = 0
    while i < len(argv):
        if argv[i] == "--min":
            min_run = int(argv[i + 1])
            i += 2
        else:
            only.append(argv[i])
            i += 1
    book = json.loads((OUT / "book.json").read_text())
    chapters = [c for p in book["parts"] for c in p["chapters"]] + book["appendices"]
    full = {c["id"]: json.loads((OUT / "chapters" / f"{c['id']}.json").read_text()) for c in chapters}
    questions = {p.stem: json.loads(p.read_text()) for p in (OUT / "questions").glob("*.json")}
    mocks = {p.stem: json.loads(p.read_text()) for p in (OUT / "mocks").glob("*.json")}
    traps = json.loads((OUT / "traps.json").read_text())
    pdf = split_chapters(pdf_text(), [full[c["id"]] for c in chapters])
    total_missing = 0
    for c in chapters:
        cid = c["id"]
        if only and cid not in only:
            continue
        if cid not in pdf:
            continue
        a = words(strip_running_heads(pdf[cid], full[cid]))
        b = words(chapter_text(full[cid], questions, mocks, traps))
        sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
        runs = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag in ("delete", "replace") and i2 - i1 >= min_run:
                runs.append(" ".join(a[i1:i2]))
        matched = sum(bl.size for bl in sm.get_matching_blocks())
        total_missing += sum(len(r.split()) for r in runs)
        print(f"== {cid}: pdf {len(a)} words, json {len(b)} words, matched {matched} "
              f"({100 * matched / max(1, len(a)):.1f}% of pdf), {len(runs)} unmatched runs >= {min_run}")
        for r in runs:
            print("   -", r[:300])
    print(f"total words in unmatched runs: {total_missing}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
