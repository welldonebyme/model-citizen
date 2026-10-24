"""Render the generated questions as plain Markdown, the way a learner sees them (no keys, no explanations),
for the independent re-solve. Also writes the normalised keys separately.

    python3 tools/qa/render_questions.py <out_dir>
"""
import json, glob, sys
from pathlib import Path

GEN = Path(__file__).resolve().parents[2] / "site/src/generated"

def inl(c):
    out = []
    for n in c or []:
        if isinstance(n, str): out.append(n); continue
        t = n.get("t")
        if t == "code": out.append(f"`{n['v']}`")
        elif t == "b": out.append(f"**{inl(n['c'])}**")
        elif t == "i": out.append(f"*{inl(n['c'])}*")
        elif t in ("u", "sf", "link"): out.append(inl(n["c"]))
        elif t == "term": out.append(inl(n["en"]))
        elif t == "key": out.append(f"[{n['v']}]")
        elif t == "obj": out.append(f"[objective {n['id']}]")
        elif t == "ref": out.append(n["text"])
        elif t == "blank": out.append("_____")
        elif t == "br": out.append("\n")
        elif t == "icon": out.append("")
    return "".join(out)

def cell(c):
    if c and isinstance(c[0], dict) and c[0].get("t") in ("p", "list", "code", "table") and ("lang" in c[0] or c[0]["t"] != "code"):
        return " ".join(blocks(c).split())
    return inl(c)

def blocks(bs):
    out = []
    for b in bs or []:
        t = b["t"]
        if t == "p": out.append(inl(b["c"]))
        elif t == "h": out.append("### " + inl(b["c"]))
        elif t == "list":
            for i, it in enumerate(b["items"]):
                mark = f"{i + (b.get('start') or 1)}." if b["kind"] == "ol" else "-"
                term = f"**{inl(it['term'])}** " if it.get("term") else ""
                out.append(f"{mark} {term}" + blocks(it["blocks"]).replace("\n", "\n   "))
        elif t == "code":
            text = b["text"]
            if b.get("lineNumbers"):
                first = b.get("firstLine") or 1
                text = "\n".join(f"{first + i:>3} | {l}" for i, l in enumerate(text.split("\n")))
            title = f"  ({b['title']})" if b.get("title") else ""
            out.append(f"```{b['lang']}{title}\n{text}\n```")
        elif t == "callout": out.append("> " + blocks(b["blocks"]).replace("\n", "\n> "))
        elif t == "table":
            rows = [[cell(c["c"]) for c in r] for r in (b.get("head") or []) + b["rows"]]
            if rows:
                w = max(len(r) for r in rows)
                rows = [r + [""] * (w - len(r)) for r in rows]
                out.append("| " + " | ".join(rows[0]) + " |\n|" + "---|" * w + "\n" + "\n".join("| " + " | ".join(r) + " |" for r in rows[1:]))
        elif t == "figure": out.append(f"[Figure: {b.get('alt','')}]")
        elif t == "objectives": out.append("Objectives: " + ", ".join(i["id"] for i in b["items"]))
        elif t == "lab": out.append(f"Lab: {inl(b['title'])}\n" + blocks(b["blocks"]))
    return "\n\n".join(x for x in out if x)

HOW = {
    "mc": "Answer with ONE letter.",
    "ms": "Answer with exactly {n} letters.",
    "fill": "Answer with the exact word(s) for each blank ({n} blank(s)).",
    "match": "Answer with one letter for each number, e.g. 1-b, 2-a.",
    "hotspot": "Answer with ONE line number.",
    "order": "Answer with ALL the letters in the correct order.",
    "domc": "Judge EACH option independently: YES (true/correct) or NO.",
}

def render(q):
    lines = [f"## {q['id']}  [{q['formatLabel']}]", ""]
    lines.append(blocks(q["stem"]))
    if q.get("match"):
        lines.append("\nLeft items:\n" + "\n".join(f"{x['id']}. {inl(x['c'])}" for x in q["match"]["left"]))
        lines.append("\nRight items:\n" + "\n".join(f"{x['id']}. {inl(x['c'])}" for x in q["match"]["right"]))
    if q.get("options"):
        lines.append("\nOptions:\n" + "\n".join(f"{o['id']}. {inl(o['c'])}" for o in q["options"]))
    n = q.get("choose") if q["format"] == "ms" else q.get("blanks", 1)
    lines.append("\nHow to answer: " + HOW[q["format"]].format(n=n))
    return "\n".join(lines) + "\n"

def norm_key(q):
    k, f = q["key"], q["format"]
    if k is None: return None
    if f == "mc": return k
    if f == "ms": return ",".join(sorted(k))
    if f == "order": return ",".join(k)
    if f == "hotspot": return str(k)
    if f == "match": return ",".join(f"{a}-{b}" for a, b in sorted(k.items(), key=lambda x: x[0]))
    if f == "domc": return ",".join(f"{a}:{'Y' if v else 'N'}" for a, v in sorted(k.items()))
    if f == "fill":
        if "blanks" in k: return " || ".join(" | ".join(a) for a in k["blanks"])
        return " | ".join(k.get("accepted", []))
    return json.dumps(k)

def main(out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    chap = {}
    for f in sorted(glob.glob(str(GEN / "questions/ch*.json"))):
        d = json.load(open(f)); qs = d if isinstance(d, list) else d["questions"]
        chap[Path(f).stem] = qs
    mocks = {}
    for f in sorted(glob.glob(str(GEN / "mocks/mock*.json"))):
        mocks[Path(f).stem] = json.load(open(f))["questions"]
    groups = [["ch00", "ch01", "ch02"], ["ch03", "ch04"], ["ch05", "ch06"], ["ch07", "ch08"], ["ch09", "ch10"], ["ch11", "ch12"],
              ["ch13", "ch14"], ["ch15", "ch16"], ["ch17", "ch18"], ["ch19", "ch20"], ["ch21", "ch22"], ["ch23", "ch24"], ["ch25", "ch26"]]
    chunks = []
    for g in groups:
        qs = [q for c in g for q in chap[c]]
        chunks.append({"id": "-".join([g[0], g[-1]]), "kind": "chapter", "chapters": g, "questions": qs})
    for m, qs in mocks.items():
        h = (len(qs) + 1) // 2
        chunks.append({"id": f"{m}-a", "kind": "mock", "mock": m, "questions": qs[:h]})
        chunks.append({"id": f"{m}-b", "kind": "mock", "mock": m, "questions": qs[h:]})
    manifest, keys = [], {}
    for c in chunks:
        p = out / f"{c['id']}.md"
        p.write_text(f"# Questions {c['id']} ({len(c['questions'])} questions)\n\n" + "\n---\n\n".join(render(q) for q in c["questions"]))
        manifest.append({"id": c["id"], "kind": c["kind"], "chapters": c.get("chapters"), "mock": c.get("mock"), "file": str(p), "qids": [q["id"] for q in c["questions"]]})
        for q in c["questions"]:
            keys[q["id"]] = {"format": q["format"], "key": norm_key(q), "keyRaw": q["keyRaw"], "status": q.get("keyStatus", "ok"), "note": q.get("keyNote", "")}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    (out / "keys.json").write_text(json.dumps(keys, indent=1, ensure_ascii=False))
    print(len(chunks), "chunks,", sum(len(c["questions"]) for c in chunks), "questions")

main(sys.argv[1])
