"""Cross-check every parsed answer key with the answer printed in the PDF (pdftotext).

    converter/.venv/bin/python -m converter.tools.verify_keys_pdf

Chapter quizzes: the PDF prints "Q7. B. Because ..." in the answers box; mocks print "Q7 Answer: B". For each
question the structured key is re-printed in the book's style and must match the start of the printed answer.
This checks the key parser and the question <-> answer alignment independently of the LaTeX source.
"""
from __future__ import annotations

import json
import re
import sys

from ..config import OUT
from .pdf_parity import pdf_text, split_chapters


def norm(s: str) -> str:
    s = s.replace("–", "-").replace("—", "-").replace("’", "'").replace("“", '"').replace("”", '"')
    s = s.replace("ﬀ", "ff").replace("ﬁ", "fi").replace("ﬂ", "fl").replace("ﬃ", "ffi").replace("ﬄ", "ffl")
    return re.sub(r"\s+", " ", s).strip()


def chapter_answers(text: str) -> list[list[str]]:
    """Answer lines grouped by quiz box (a new group starts when numbering restarts at Q1)."""
    groups: list[list[str]] = []
    lines = text.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^Q(\d+)\. (.*)$", line)
        if not m or m.group(2).startswith("["):
            continue
        n = int(m.group(1))
        body = m.group(2)
        # join the continuation line (keys can wrap)
        if i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r"^Q\d+\.", lines[i + 1]):
            body += " " + lines[i + 1]
        if n == 1:
            groups.append([])
        if groups:
            groups[-1].append(norm(body))
    return groups


def expected_ok(q: dict, printed: str) -> tuple[bool, str]:
    f, k = q["format"], q["key"]
    p = printed
    if f == "mc":
        return bool(re.match(rf"^{k}(\.| \(|$)", p)), f"{k}"
    if f == "ms":
        head = p.split(".")[0]
        letters = re.findall(r"\b[A-Z]\b", head)
        return sorted(letters) == sorted(k), f"{k}"
    if f == "order":
        if q["options"] and all(len(o["c"]) and True for o in q["options"]):
            head = p.split(".")[0] if not q.get("unlabelled") else p
            letters = [x.upper() for x in re.findall(r"\b[A-Za-z]\b", head)]
            if letters and letters == k:
                return True, str(k)
            # word lists: compare option texts in order
            texts = []
            for kid in k:
                o = next(o for o in q["options"] if o["id"] == kid)
                texts.append(norm(flat(o["c"])).lower())
            pos = 0
            low = p.lower()
            for t in texts:
                j = low.find(t, pos)
                if j < 0:
                    return False, str(texts)
                pos = j + len(t)
            return True, str(texts)
        return False, "no options"
    if f == "match":
        pairs = dict(re.findall(r"(\d+)\s*-+\s*\(?([A-Za-z])\)?", p.split(". ")[0] if ". " in p else p))
        want = {a: b.lower() for a, b in k.items()}
        got = {a: b.lower() for a, b in pairs.items()}
        return got == want, str(k)
    if f == "domc":
        vals = re.findall(r"\b(YES|NO|Y|N)\b", p)
        want = ["YES" if k[o] else "NO" for o in sorted(k)]
        got = ["YES" if v in ("YES", "Y") else "NO" for v in vals[:len(want)]]
        return got == want, str(want)
    if f == "hotspot":
        return bool(re.match(rf"^Line {k}\b", p)), f"Line {k}"
    if f == "fill":
        if "accepted" in k:
            # hand-decided keys (overrides) add alternatives: the book's printed answer must be the first value
            vals = k["accepted"][:1] if q.get("keyStatus") == "override" else k["accepted"]
        else:
            vals = [b[0] for b in k["blanks"]]
            # "both blanks take the same word": the book prints the word once
            vals = [v for i, v in enumerate(vals) if i == 0 or v != vals[i - 1]]
        pos = 0
        for v in vals:
            j = p.find(norm(v), pos)
            if j < 0 or j > 60 + pos:
                return False, str(vals)
            pos = j + len(norm(v))
        return True, str(vals)
    return False, "?"


def flat(c) -> str:
    out = []
    for x in c:
        if isinstance(x, str):
            out.append(x)
        elif x.get("t") in ("code", "key"):
            out.append(x["v"])
        elif "c" in x:
            out.append(flat(x["c"]))
    return "".join(out)


def mock_answers(text: str) -> list[str]:
    return [norm(m.group(1)) for m in re.finditer(r"Answer: (.*)", text)]


def main() -> int:
    book = json.loads((OUT / "book.json").read_text())
    chs = [c for p in book["parts"] for c in p["chapters"]] + book["appendices"]
    full = {c["id"]: json.loads((OUT / "chapters" / f"{c['id']}.json").read_text()) for c in chs}
    pdf = split_chapters(pdf_text(), [full[c["id"]] for c in chs])
    ok = bad = skipped = 0
    for c in chs:
        cid = c["id"]
        qpath = OUT / "questions" / f"{cid}.json"
        if qpath.exists():
            qs = json.loads(qpath.read_text())
            groups = chapter_answers(pdf[cid])
            flat_answers = [a for g in groups for a in g]
            if len(flat_answers) != len(qs):
                print(f"{cid}: {len(flat_answers)} printed answers for {len(qs)} questions")
            for q, a in zip(qs, flat_answers):
                if q["keyStatus"] not in ("ok", "override"):
                    skipped += 1
                    continue
                good, want = expected_ok(q, a)
                if good:
                    ok += 1
                else:
                    bad += 1
                    print(f"MISMATCH {q['id']} [{q['format']}] key {want} vs printed {a[:100]!r}")
        if c.get("mock") and c["kind"] == "mock-answers":
            m = json.loads((OUT / "mocks" / f"mock{c['mock']}.json").read_text())
            printed = mock_answers(pdf[cid])
            if len(printed) != len(m["questions"]):
                print(f"{cid}: {len(printed)} printed answers for {len(m['questions'])} questions")
            for q, a in zip(m["questions"], printed):
                if q["keyStatus"] not in ("ok", "override"):
                    skipped += 1
                    continue
                good, want = expected_ok(q, a)
                if good:
                    ok += 1
                else:
                    bad += 1
                    print(f"MISMATCH {q['id']} [{q['format']}] key {want} vs printed {a[:100]!r}")
    print(f"keys checked against the PDF: {ok} match, {bad} mismatch, {skipped} flagged (not checked)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
