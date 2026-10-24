"""Inputs for mapping each chapter quiz question to the lesson it tests and to an exam objective.

    python3 tools/qa/render_mapping_input.py <out_dir>
"""
import json, glob, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from render_questions import inl, blocks, render  # noqa: E402

GEN = Path(__file__).resolve().parents[2] / "site/src/generated"
OBJ = {o["id"]: o.get("title", "") for o in json.load(open(GEN / "objectives.json"))}

def main(out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for f in sorted(glob.glob(str(GEN / "questions/ch*.json"))):
        cid = Path(f).stem
        qs = json.load(open(f))
        ch = json.load(open(GEN / f"chapters/{cid}.json"))
        lines = [f"# Chapter {ch['number']}: {ch['title']}", "", "## Exam objectives of this chapter", ""]
        for o in ch.get("objectives", []):
            lines.append(f"- {o}: {OBJ.get(o, '')}")
        lines += ["", "## Lessons (id, number, title; step titles)", ""]
        for l in ch["lessons"]:
            steps = "; ".join(s["titleText"] for s in l["steps"][1:])
            objs = ", ".join(l.get("objectives", []))
            lines.append(f"- {l['id']} {l['number']} {l['titleText']}" + (f" [objectives: {objs}]" if objs else "") + (f" — steps: {steps}" if steps else ""))
        lines += ["", "## Questions (with the book's explanation)", ""]
        for q in qs:
            lines.append(render(q).replace("How to answer:", "Format note:"))
            lines.append("Book explanation: " + " ".join(blocks(q.get("explanation", [])).split())[:900])
            lines.append("\n---\n")
        p = out / f"{cid}.md"
        p.write_text("\n".join(lines))
        manifest.append({"chapter": cid, "file": str(p), "qids": [q["id"] for q in qs], "lessons": [l["id"] for l in ch["lessons"]], "objectives": ch.get("objectives", [])})
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(len(manifest), "chapters,", sum(len(m["qids"]) for m in manifest), "questions")

main(sys.argv[1])
