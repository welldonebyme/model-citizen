"""Print random questions as converted next to the PDF text, for a human spot-check.

    converter/.venv/bin/python -m converter.tools.spotcheck [N] [SEED]
"""
from __future__ import annotations

import json
import random
import re
import sys

from ..config import OUT
from ..render.inline import plain
from .pdf_parity import pdf_text
from .preview import blocks as html_blocks  # noqa: F401  (keeps the import graph simple)


def block_plain(bs) -> str:
    out = []
    for b in bs or []:
        t = b.get("t")
        if t == "p":
            out.append(plain(b["c"]))
        elif t == "code":
            out.append(f"[{b['lang']}{' ' + b['title'] if b.get('title') else ''}]\n{b['text']}")
        elif t == "list":
            out += ["- " + block_plain(it["blocks"]) for it in b["items"]]
        elif t == "table":
            for r in (b.get("head") or []) + b["rows"]:
                out.append(" | ".join(plain(c["c"]) if not (c["c"] and isinstance(c["c"][0], dict) and "text" in c["c"][0])
                                      else "[code]" for c in r))
        else:
            out.append(f"[{t}]")
    return "\n".join(out)


def main(argv):
    n = int(argv[0]) if argv else 30
    seed = int(argv[1]) if len(argv) > 1 else 20261024
    qs = []
    for p in sorted((OUT / "questions").glob("*.json")):
        qs += json.loads(p.read_text())
    for p in sorted((OUT / "mocks").glob("*.json")):
        qs += json.loads(p.read_text())["questions"]
    rnd = random.Random(seed)
    sample = rnd.sample(qs, n)
    text = re.sub(r"\s+", " ", pdf_text())
    for q in sample:
        print("=" * 100)
        print(q["id"], q["format"], q["formatLabel"], "| keyStatus", q["keyStatus"])
        stem = block_plain(q["stem"])
        print("STEM:", stem[:700])
        for o in q.get("options") or []:
            print(f"  {o['id']}. {plain(o['c'])[:160]}")
        if q.get("match"):
            for x in q["match"]["left"]:
                print(f"  L{x['id']}. {plain(x['c'])[:120]}")
            for x in q["match"]["right"]:
                print(f"  R{x['id']}. {plain(x['c'])[:120]}")
        if q.get("hotspot"):
            print("  HOTSPOT", q["hotspot"])
        print("KEY:", json.dumps(q["key"], ensure_ascii=False), "| keyRaw:", q["keyRaw"][:80])
        words = re.sub(r"\s+", " ", plain(q["stem"][0]["c"]) if q["stem"] and q["stem"][0].get("t") == "p" else stem)
        probe = " ".join(words.split()[:7])
        i = text.find(probe)
        print("PDF :", text[max(0, i - 40):i + 900] if i >= 0 else f"(probe not found: {probe!r})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
