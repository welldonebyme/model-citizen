"""Acceptance tests (docs/05 section 7, docs/07 sections 1-2, SCHEMA.md).

They read the generated documents only (plus reference/content-inventory.json, the mock blueprint and, for the
raw-LaTeX accounting, the book sources through the parser) and never trust converter internals.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from .build import keys as K
from .config import BOOK, INVENTORY, OUT, RULES
from .tex.macros import CODE_ENVS
from .tex.nodes import Cmd, Env, walk
from .tex.parser import Parser
from .tex.source import load_units

BOX_KIND = {"why": "whybox", "idea": "ideabox", "analogy": "analogybox", "trap": "trapbox", "tip": "tipbox",
            "deep": "deepbox", "dbt": "dbtbox", "quiz": "quizbox", "answer": "answerbox"}
LANG_ENV = {v: k for k, v in CODE_ENVS.items()}
FORMAT_NAME = {"mc": "Multiple choice", "ms": "Multiple select", "fill": "Fill in the blank", "match": "Matching",
               "hotspot": "Hotspot", "order": "Build list", "domc": "DOMC"}
TOTALS = {"chapter_questions": 487, "mock_questions": 195, "traps": 145, "terms": 305, "labs": 118, "figures": 64}

# Mock blueprint (reference/book-briefs/MOCK_BLUEPRINT.md): per mock
BLUEPRINT_FORMATS = {"mc": 30, "ms": 6, "fill": 6, "match": 5, "hotspot": 5, "order": 5, "domc": 8}
BLUEPRINT_TOPICS = {1: 26, 2: 7, 3: 8, 4: 5, 5: 9, 6: 4, 7: 6}
BLUEPRINT_OBJECTIVES = {
    "1.1": 2, "1.2": 2, "1.3": 2, "1.4": 3, "1.5": 2, "1.6": 2, "1.7": 2, "1.8": 1, "1.9": 1, "1.10": 2, "1.11": 2,
    "1.12": 2, "1.13": 1, "1.14": 2, "2.1": 3, "2.2": 2, "2.3": 2, "3.1": 2, "3.2": 2, "3.3": 2, "3.4": 1, "3.5": 1,
    "4.1": 3, "4.2": 2, "5.1": 4, "5.2": 3, "5.3": 2, "6.1": 2, "6.2": 2, "7.1": 4, "7.2": 2,
}
# not book text: ids, links, audit copies, and figure alt texts (written by hand in overrides/figures.yaml)
SKIP_FIELDS = {"keyRaw", "textBook", "titleBook", "href", "src", "id", "label", "key", "codeId", "alt", "description"}


# ---------------------------------------------------------------------------------------------- walkers
def walk_json(obj, fn, path=""):
    fn(obj, path)
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk_json(v, fn, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk_json(v, fn, f"{path}[{i}]")


def nodes_of(obj, t: str) -> list:
    out = []
    walk_json(obj, lambda o, p: out.append(o) if isinstance(o, dict) and o.get("t") == t else None)
    return out


def code_blocks(obj) -> list:
    return [c for c in nodes_of(obj, "code") if "text" in c]


def prose_strings(obj, out: list, path: str = ""):
    """Every string that is rendered text (not verbatim code, not ids/links/audit copies)."""
    if isinstance(obj, dict):
        if obj.get("t") == "code" and "text" in obj:
            if "title" in obj:
                out.append((path + ".title", obj["title"]))
            return
        for k, v in obj.items():
            if k in SKIP_FIELDS or k == "t":
                continue
            if obj.get("t") == "code" and k == "v":
                out.append((path + ".v", v))
                continue
            prose_strings(v, out, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            prose_strings(v, out, f"{path}[{i}]")
    elif isinstance(obj, str):
        out.append((path, obj))


# ---------------------------------------------------------------------------------------------- loading
def load_out(out_dir: Path) -> dict[str, object]:
    files = {}
    for p in sorted(out_dir.rglob("*.json")):
        rel = str(p.relative_to(out_dir))
        if rel.split("/")[0] in ("chapters", "questions", "mocks") or "/" not in rel:
            files[rel] = json.loads(p.read_text())
    return files


class Results:
    def __init__(self):
        self.items: list[dict] = []

    def add(self, name: str, ok: bool, detail: str = "", data=None):
        self.items.append({"check": name, "ok": bool(ok), "detail": detail, **({"data": data} if data else {})})

    @property
    def ok(self) -> bool:
        return all(i["ok"] for i in self.items)


def chapter_of_id(i: str) -> str:
    return i.split("-")[0]


# ---------------------------------------------------------------------------------------------- checks
def run_checks(files: dict[str, object], inventory: dict, book: Path = BOOK) -> Results:
    R = Results()
    chapters = {k.split("/")[1][:-5]: v for k, v in files.items() if k.startswith("chapters/")}
    questions = {k.split("/")[1][:-5]: v for k, v in files.items() if k.startswith("questions/")}
    mocks = {int(k.split("/")[1][4:-5]): v for k, v in files.items() if k.startswith("mocks/")}
    inv = {c["number"]: c for c in inventory["chapters"]}
    by_number = {c["number"]: c for c in chapters.values()}

    # every block of the book, grouped by the chapter that printed it (code/figure/lab ids carry it)
    all_docs = list(chapters.values()) + list(questions.values()) + [m["questions"] for m in mocks.values()]
    codes_by_ch: dict[str, Counter] = defaultdict(Counter)
    for doc in all_docs:
        for c in code_blocks(doc):
            codes_by_ch[chapter_of_id(c["id"])][LANG_ENV[c["lang"]]] += 1
    figs_by_ch = Counter(chapter_of_id(f["id"]) for doc in all_docs for f in nodes_of(doc, "figure"))
    labs_by_ch: dict[str, list] = defaultdict(list)
    for doc in all_docs:
        for lab in nodes_of(doc, "lab"):
            labs_by_ch[chapter_of_id(lab["id"])].append(lab)

    total_q = 0
    for num in sorted(inv):
        e = inv[num]
        ch = by_number.get(num)
        name = f"ch{num:02d}" if num < 34 else ["appA", "appB", "appC"][num - 34]
        if ch is None:
            R.add(f"{name} exists", False, "chapter missing")
            continue
        cid = ch["id"]
        problems = []
        # sections
        n_sections = len(ch["lessons"]) + len(ch["quizSections"])
        if n_sections != len(e["sections"]):
            problems.append(f"sections {n_sections} != {len(e['sections'])}")
        # boxes
        mine = Counter()
        for cal in nodes_of(ch, "callout"):
            mine[BOX_KIND[cal["kind"]]] += 1
        qdocs = [ch] + ([questions[cid]] if cid in questions else [])
        for doc in qdocs[1:]:
            for cal in nodes_of(doc, "callout"):
                mine[BOX_KIND[cal["kind"]]] += 1
        mine["exambox"] = len(nodes_of(qdocs, "objectives"))
        mine["labbox"] = len(labs_by_ch[cid])
        quizboxes = sum(1 for qb in nodes_of(ch, "quiz") if qb["ids"] and qb["ids"][0].startswith("q-"))
        mine["quizbox"] += quizboxes
        mine["answerbox"] += quizboxes
        mine["summarybox"] = 1 if ch["summary"] else 0
        for box, n in e["boxes"].items():
            if mine[box] != n:
                problems.append(f"{box} {mine[box]} != {n}")
        # code blocks per language
        for env, n in e["code"].items():
            if codes_by_ch[cid][env] != n:
                problems.append(f"{env} {codes_by_ch[cid][env]} != {n}")
        # figures
        if figs_by_ch[cid] != e["tikz"]:
            problems.append(f"figures {figs_by_ch[cid]} != {e['tikz']}")
        # labs + objective tags
        labs = labs_by_ch[cid]
        if len(labs) != len(e["labs"]):
            problems.append(f"labs {len(labs)} != {len(e['labs'])}")
        else:
            for lab, il in zip(labs, e["labs"]):
                want = [x.strip() for x in il["objectives"].split(",") if x.strip()]
                if lab["objectives"] != want:
                    problems.append(f"{lab['id']} objectives {lab['objectives']} != {want}")
        # quiz questions and formats
        qs = questions.get(cid, [])
        if ch["kind"] == "mock":
            qs = mocks[ch["mock"]]["questions"]
        n_q = len(qs)
        if n_q != e["quiz_questions"]:
            problems.append(f"quiz questions {n_q} != {e['quiz_questions']}")
        fmts = Counter(FORMAT_NAME[q["format"]] for q in qs)
        if dict(fmts) != {k: v for k, v in e["quiz_formats"].items() if v}:
            problems.append(f"formats {dict(fmts)} != {e['quiz_formats']}")
        if ch["kind"] not in ("mock", "mock-answers"):
            total_q += n_q
        if e["mock_keys"]:
            mq = mocks[ch["mock"]]["questions"]
            n_keys = sum(1 for q in mq if q.get("keyRaw") and q.get("objective"))
            if n_keys != e["mock_keys"]:
                problems.append(f"mock keys {n_keys} != {e['mock_keys']}")
        # objective tags (\objective{..} in the chapter)
        objs = {o["id"] for o in nodes_of(qdocs, "obj")}
        for ob in nodes_of(qdocs, "objectives"):
            for it in ob["items"]:
                objs.update(it.get("ids") or ([it["id"]] if it["id"] else []))
        if sorted(objs) != sorted(e["objectives"]):
            problems.append(f"objective tags {sorted(objs)} != {sorted(e['objectives'])}")
        # terms
        n_terms = len(nodes_of(qdocs, "term"))
        if num == 27:
            n_terms += sum(len(nodes_of(t, "term")) for t in files["traps.json"])
        if n_terms != e["terms"]:
            problems.append(f"terms {n_terms} != {e['terms']}")
        R.add(f"{cid} counts", not problems, "; ".join(problems))

    # totals
    mock_q = sum(len(m["questions"]) for m in mocks.values())
    n_labs = sum(len(v) for v in labs_by_ch.values())
    n_figs = sum(figs_by_ch.values())
    got = {"chapter_questions": total_q, "mock_questions": mock_q, "traps": len(files["traps.json"]),
           "terms": len(files["glossary.json"]), "labs": n_labs, "figures": n_figs}
    for k, v in TOTALS.items():
        R.add(f"total {k}", got[k] == v, f"{got[k]} (expected {v})")
    R.add("inventory summary agrees", inventory["summary"]["quiz_questions_total"] == TOTALS["chapter_questions"]
          and inventory["summary"]["mock_questions_total"] == TOTALS["mock_questions"], "")

    # traps T1..T145 in printed order
    tr = files["traps.json"]
    R.add("traps numbered 1..145", [t["n"] for t in tr] == list(range(1, len(tr) + 1)) and
          all(t["id"] == f"trap-{t['n']:03d}" for t in tr), "")

    # keys
    bad, todo = [], []
    allq = [q for qs in questions.values() for q in qs] + [q for m in mocks.values() for q in m["questions"]]
    for q in allq:
        if q["keyStatus"] in ("ok", "override"):
            err = K.validate(q)
            if err:
                bad.append(f"{q['id']}: {err}")
        else:
            todo.append(q["id"])
    R.add("every key validates (except flagged)", not bad, "; ".join(bad[:20]), )
    R.add("flagged keys (keys-todo.yaml)", True, f"{len(todo)} flagged: {', '.join(todo)}")

    # mock blueprint
    for m, doc in sorted(mocks.items()):
        qs = doc["questions"]
        f = Counter(q["format"] for q in qs)
        t = Counter(q.get("topic") for q in qs)
        o = Counter(q.get("objective") for q in qs)
        probs = []
        if dict(f) != BLUEPRINT_FORMATS:
            probs.append(f"formats {dict(f)}")
        if dict(t) != BLUEPRINT_TOPICS:
            probs.append(f"topics {dict(t)}")
        diff = {k: (o.get(k, 0), v) for k, v in BLUEPRINT_OBJECTIVES.items() if o.get(k, 0) != v}
        extra = [k for k in o if k not in BLUEPRINT_OBJECTIVES]
        if diff or extra:
            probs.append(f"objectives (got, blueprint) {diff} extra {extra}")
        R.add(f"mock {m} blueprint", not probs, "; ".join(probs))

    # coverage: each official objective >= 1 lesson, >= 1 lab, >= 3 mock questions
    gaps = files["coverage.json"]["gaps"]
    R.add("coverage: every objective has a lesson, a lab and 3 mock questions", not gaps, json.dumps(gaps))

    # refs resolve
    check_refs(files, chapters, R)
    # raw LaTeX
    check_raw_latex(files, R)
    check_ligature_artefacts(files, R)
    check_escape_accounting(files, chapters, book, R)
    check_paths(files, book, R)
    return R


AUDIT_FIELDS = {"textBook", "titleBook", "keyRaw"}


def check_paths(files, book: Path, R: Results, rules: Path = RULES / "paths.yaml") -> None:
    """Book paths (rules/paths.yaml): every occurrence is mapped (or explicitly allowed), every rule is used, and no
    generated text (prose, inline code, code blocks, titles, OS variants, alt texts) still names the author's folders."""
    from .rewrite import DETECT, scan_book
    occ = scan_book(book, rules)
    unmapped = [f"{o['where']}: {o['unmapped']!r}" for o in occ if o.get("unmapped") and not o.get("allowed")]
    R.add("every book path occurrence is mapped (rules/paths.yaml)", not unmapped,
          f"{len(occ)} occurrences, {sum(1 for o in occ if o.get('allowed'))} allowed; " + "; ".join(unmapped[:20]))
    import yaml
    rule_ids = [r["id"] for r in yaml.safe_load(rules.read_text())["rules"]]
    used = {r for o in occ for r in o["rules"]}
    unused = [r for r in rule_ids if r not in used]
    R.add("every path rule is used by the book", not unused, ", ".join(unused))
    left: list[str] = []

    def visit(o, path):
        if isinstance(o, dict):
            for k, v in o.items():
                if k not in AUDIT_FIELDS:
                    visit(v, f"{path}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                visit(v, f"{path}[{i}]")
        elif isinstance(o, str):
            m = DETECT.search(o)
            if m:
                left.append(f"{path}: {m.group(0)!r}")

    for name in sorted(files):
        if name != "report.json":
            visit(files[name], name)
    R.add("no generated text names the author's folders", not left, "; ".join(left[:20]))


# en dash directly before a letter after a space/quote/bracket: "--empty" typeset as "\u2013empty"
EN_DASH_FLAG = re.compile(r"(?:^|(?<=[\s(\[{/'\"]))\u2013[A-Za-z]")
QUOTE_ARTEFACT = re.compile(r"``|''|\u2018\u2018|\u2019\u2019")


def check_ligature_artefacts(files, R: Results):
    """TeX ligatures must not leak where they are wrong: an en dash glued to a word (a CLI flag written in prose or a
    plain-text string run through TeX rules) and doubled quote marks in prose. Code keeps its characters as typed."""
    hits = []
    for name, doc in files.items():
        if name == "report.json":
            continue
        strings: list = []
        prose_strings(doc, strings, name)
        for path, s in strings:
            is_code = path.endswith(".v") or path.endswith(".title")
            for m in EN_DASH_FLAG.finditer(s):
                hits.append(f"{path}: {s[max(0, m.start() - 20):m.end() + 15]!r}")
            if not is_code:
                for m in QUOTE_ARTEFACT.finditer(s):
                    hits.append(f"{path}: {s[max(0, m.start() - 20):m.end() + 15]!r}")
    R.add("no TeX ligature artefacts (en dash glued to a word, doubled quotes) in rendered text", not hits,
          "; ".join(hits[:20]))


def check_refs(files, chapters, R: Results):
    labels = files["labels.json"]
    routes: dict[str, set] = {}
    for ch in chapters.values():
        intro_anchors = {b["anchor"] for b in walk_blocks_json(ch["intro"]) if b.get("anchor")}
        routes[f"/learn/{ch['id']}/"] = intro_anchors
        for l in ch["lessons"]:
            routes[f"/learn/{ch['id']}/{l['id']}/"] = set(l["anchors"])
        qa = {q.get("anchor") for q in ch["quizSections"] if q.get("anchor")}
        if ch["quizSections"]:
            routes[f"/learn/{ch['id']}/quiz/"] = qa
            routes[f"/learn/{ch['id']}/answers/"] = set()
    bad = []
    n = 0
    for doc in files.values():
        for ref in nodes_of(doc, "ref"):
            n += 1
            lab = labels.get(ref["label"])
            if lab is None or lab["href"] != ref["href"]:
                bad.append(f"{ref['label']}: href {ref['href']} / labels.json {lab and lab['href']}")
                continue
            path, _, anchor = ref["href"].partition("#")
            if path not in routes or (anchor and anchor not in routes[path]):
                bad.append(f"{ref['label']}: route {ref['href']} does not exist")
    for lab, v in labels.items():
        path, _, anchor = v["href"].partition("#")
        if path not in routes or (anchor and anchor not in routes[path]):
            bad.append(f"labels.json {lab}: route {v['href']} does not exist")
    R.add("every ref resolves", not bad, f"{n} refs; " + "; ".join(bad[:20]))


def walk_blocks_json(blocks):
    out = []
    walk_json(blocks, lambda o, p: out.append(o) if isinstance(o, dict) and "t" in o else None)
    return out


RAW = re.compile(r"\\[a-zA-Z]+")


def check_raw_latex(files, R: Results):
    hits = []
    for name, doc in files.items():
        if name == "report.json":
            continue
        strings: list = []
        prose_strings(doc, strings, name)
        for path, s in strings:
            # inline code may hold real backslashes (\\textbackslash): those are audited by the escape accounting
            if path.endswith(".v") or path.endswith(".title"):
                continue
            if RAW.search(s):
                hits.append(f"{path}: {s[:80]!r}")
    R.add("no \\command left in rendered prose", not hits, "; ".join(hits[:20]))


def check_escape_accounting(files, chapters, book: Path, R: Results):
    """'{', '}', '$' and '\\' in rendered (non-verbatim) text must come from \\{ \\} \\$ \\textbackslash in the book.
    Counted per chapter group from the book sources with the parser (not the renderer)."""
    expected: dict[str, Counter] = defaultdict(Counter)
    units = load_units(book)
    ids = sorted(chapters, key=lambda c: chapters[c]["number"])
    if len(units) != len(ids):
        R.add("escape accounting", False, "chapter count differs")
        return
    escape = {"{": "{", "}": "}", "$": "$", "textbackslash": "\\"}

    def count(nodes, ctr):
        for n in walk(nodes):
            if isinstance(n, Cmd) and n.name in escape:
                ctr[escape[n.name]] += 1
            if isinstance(n, Env) and n.args and n.args[0].present and n.name in set(CODE_ENVS) | {
                    "whybox", "ideabox", "analogybox", "trapbox", "tipbox", "deepbox", "dbtbox", "quizbox",
                    "answerbox", "exambox", "summarybox"}:
                from .render.options import keyvals, strip_braces
                from .tex.nodes import Source
                for k, v in keyvals(n.args[0].raw, n.where()):
                    if k == "title":
                        count(Parser(Source("title", strip_braces(v or "")), state="M").parse_seq(), ctr)

    group = {}
    for cid in ids:
        ch = chapters[cid]
        g = f"mock{ch['mock']}" if ch.get("mock") else cid
        group[cid] = g
    for unit, cid in zip(units, ids):
        count(unit.nodes, expected[group[cid]])
    actual: dict[str, Counter] = defaultdict(Counter)

    def add(doc, g):
        strings: list = []
        prose_strings(doc, strings)
        for path, s in strings:
            if path.endswith(".titleText") or ".whyWrong[" in path:   # derived copies (title, explanation)
                continue
            for ch in "{}$\\":
                actual[g][ch] += s.count(ch)

    for cid in ids:
        add(chapters[cid], group[cid])
    for name, doc in files.items():
        if name.startswith("questions/"):
            add(doc, group[name.split("/")[1][:-5]])
        elif name.startswith("mocks/"):
            add(doc["questions"], name.split("/")[1][:-5])
    add(files["traps.json"], "ch27")
    bad = []
    for g in sorted(set(expected) | set(actual)):
        for ch in "{}$\\":
            if expected[g][ch] != actual[g][ch]:
                bad.append(f"{g} {ch!r}: rendered {actual[g][ch]} vs escaped in book {expected[g][ch]}")
    R.add("braces / $ / backslash all come from escapes", not bad, "; ".join(bad[:20]))


def pdf_checks(R: Results) -> None:
    """With pdftotext available: (1) every parsed key equals the answer printed in the PDF (hard check);
    (2) text parity per chapter (informational: lists runs of PDF words missing from the JSON for human review)."""
    import contextlib
    import io
    import shutil
    if not shutil.which("pdftotext"):
        R.add("PDF checks", True, "skipped: pdftotext not installed")
        return
    from .tools import pdf_parity, verify_keys_pdf
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = verify_keys_pdf.main()
    lines = buf.getvalue().strip().split("\n")
    R.add("keys equal the answers printed in the PDF", rc == 0, lines[-1] + ("; " + "; ".join(lines[:-1][:10])
                                                                          if rc else ""))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
        pdf_parity.main([])
    out = buf.getvalue().strip().split("\n")
    chapters = [l for l in out if l.startswith("== ")]
    pct = [float(re.search(r"\(([\d.]+)% of pdf\)", l).group(1)) for l in chapters]
    R.add("PDF text parity (informational)", True,
          f"{len(chapters)} chapters, words matched {min(pct):.1f}%..{max(pct):.1f}% of the PDF text; {out[-1]} "
          f"(remaining runs are figure labels, running heads, box titles, FR translations and table/column order; "
          f"run `python -m converter.tools.pdf_parity` for the list)")


def main(out_dir: Path = OUT) -> int:
    files = load_out(out_dir)
    inventory = json.loads(INVENTORY.read_text())
    R = run_checks(files, inventory)
    pdf_checks(R)
    for i in R.items:
        print(("PASS " if i["ok"] else "FAIL ") + i["check"] + (f"  -- {i['detail']}" if i["detail"] else ""))
    print("ALL PASS" if R.ok else "SOME CHECKS FAILED")
    return 0 if R.ok else 1
