"""Quick plain-HTML preview of lessons, to compare the JSON with the PDF by eye.

    converter/.venv/bin/python -m converter.tools.preview ch04-s4 ch07-s2 ch16-s3 [...]

Writes converter/preview/<lesson>.html (self-contained, no site code involved).
"""
from __future__ import annotations

import html
import json
import sys

from ..config import CONVERTER, OUT

CSS = """
body{font:16px/1.5 Georgia,serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1F2A44}
h1,h2,h3,h4{font-family:system-ui,sans-serif}
code{font:0.88em Menlo,monospace;background:#F6F7F9;padding:0 .2em;border-radius:3px}
pre{font:13px/1.35 Menlo,monospace;background:#F6F7F9;border:1px solid #D7DBE2;padding:.6em;overflow:auto;white-space:pre}
pre.bash{background:#1d2333;color:#fff} pre.output{background:#FBFBF5}
.codetitle{font:12px Menlo,monospace;background:#e3e6ec;padding:.2em .6em;margin-top:1em}
.callout{border-left:4px solid #888;padding:.2em 1em;margin:1em 0;background:#fafafa}
.callout>.kind{font:bold 12px system-ui;text-transform:uppercase;color:#555}
.why{border-color:#2563EB}.idea{border-color:#D97706}.trap{border-color:#DC2626}.tip{border-color:#0891B2}
.deep{border-color:#6B7280}.dbt{border-color:#E8573F}.analogy{border-color:#b45309}
.lab{border:2px solid #059669;padding:.5em 1em;margin:1em 0}.lab>.kind{color:#059669;font:bold 13px system-ui}
.obj{font:11px system-ui;background:#1F2A44;color:#fff;padding:0 .4em;border-radius:3px}
.term{font-weight:bold}.term small{color:#6B7280;font-weight:normal}
.blank{display:inline-block;width:5em;border-bottom:1px solid}
table{border-collapse:collapse;margin:1em 0}td,th{border-top:1px solid #ccc;padding:.2em .5em;vertical-align:top}
.fig{border:1px dashed #aaa;padding:.5em;color:#666;font:13px system-ui}
.step{border-top:1px solid #eee;margin-top:2em}.meta{color:#888;font:12px system-ui}
.key{font:12px Menlo;border:1px solid #bbb;border-radius:3px;padding:0 .3em}
"""


def e(s: str) -> str:
    return html.escape(s, quote=False)


def inl(items) -> str:
    out = []
    for it in items:
        if isinstance(it, str):
            out.append(e(it))
            continue
        t = it.get("t")
        if t == "code":
            out.append(f"<code>{e(it['v'])}</code>")
        elif t == "b":
            out.append(f"<b>{inl(it['c'])}</b>")
        elif t == "i":
            out.append(f"<i>{inl(it['c'])}</i>")
        elif t == "u":
            out.append(f"<u>{inl(it['c'])}</u>")
        elif t == "sf":
            out.append(f"<span style='font-family:system-ui'>{inl(it['c'])}</span>")
        elif t == "term":
            out.append(f"<span class=term>{inl(it['en'])} <small>(FR: <i>{e(it['fr'])}</i>)</small></span>")
        elif t == "key":
            out.append(f"<span class=key>{e(it['v'])}</span>")
        elif t == "obj":
            out.append(f"<span class=obj>EXAM {e(it['id'])}</span>")
        elif t == "ref":
            out.append(f"<a href='{e(it['href'])}'>{e(it['text'])}</a>")
        elif t == "link":
            out.append(f"<a href='{e(it['href'])}'>{inl(it['c'])}</a>")
        elif t == "icon":
            out.append({"checkbox": "&#9744;", "check": "&#10003;"}.get(it["name"], f"[{e(it['name'])}]"))
        elif t == "blank":
            out.append("<span class=blank></span>")
        elif t == "br":
            out.append("<br>")
        else:
            out.append(f"[?{e(str(t))}]")
    return "".join(out)


def cell(c) -> str:
    if c and isinstance(c[0], dict) and (c[0].get("t") in ("p", "list", "table", "callout") or
                                         (c[0].get("t") == "code" and "text" in c[0])):
        return blocks(c)
    return inl(c)


def blocks(bs) -> str:
    out = []
    for b in bs or []:
        t = b.get("t")
        if t == "p":
            out.append(f"<p>{inl(b['c'])}</p>")
        elif t == "h":
            out.append(f"<h{b['level'] + 1}>{inl(b['c'])}</h{b['level'] + 1}>")
        elif t == "code":
            title = f"<div class=codetitle>{e(b['title'])}</div>" if b.get("title") else (
                "<div class=codetitle>Result</div>" if b["lang"] == "output" else "")
            text = b["text"]
            if b.get("lineNumbers"):
                start = b.get("firstLine", 1)
                text = "\n".join(f"{i + start:>3}  {l}" for i, l in enumerate(text.split("\n")))
            meta = f"<span class=meta>{b['id']} {b['lang']}{' small' if b.get('small') else ''}" \
                   f"{' expected=' + b['expected'] if b.get('expected') else ''}</span>"
            out.append(f"{title}<pre class={b['lang']}>{e(text)}</pre>{meta}")
        elif t == "list":
            tag = {"ul": "ul", "ol": "ol", "dl": "dl"}[b["kind"]]
            if tag == "dl":
                items = "".join(f"<dt>{inl(it['term'])}</dt><dd>{blocks(it['blocks'])}</dd>" for it in b["items"])
            else:
                items = "".join(f"<li>{blocks(it['blocks'])}</li>" for it in b["items"])
            attrs = f" start={b['start']}" if b.get("start") else ""
            attrs += f" type='{b['marker'][0]}'" if b.get("marker") and b["marker"][0] in "aA" else ""
            out.append(f"<{tag}{attrs}>{items}</{tag}>")
        elif t == "callout":
            title = inl(b["title"]) if b.get("title") else b["kind"]
            out.append(f"<div class='callout {b['kind']}'><div class=kind>{title}</div>{blocks(b['blocks'])}</div>")
        elif t == "lab":
            out.append(f"<div class=lab><div class=kind>Hands-on lab: {inl(b['title'])} "
                       f"<span class=meta>{b['id']} objectives {', '.join(b['objectives'])}</span></div>"
                       f"{blocks(b['blocks'])}</div>")
        elif t == "objectives":
            items = "".join(f"<li>{''.join(f'<span class=obj>EXAM {i}</span> ' for i in (it.get('ids') or ([it['id']] if it['id'] else [])))}"
                            f"{inl(it['c'])}</li>" for it in b["items"])
            out.append(f"<div class='callout'><div class=kind>Exam objectives</div><ul>{items}</ul>{blocks(b.get('blocks'))}</div>")
        elif t == "table":
            rows = []
            for r in b.get("head") or []:
                rows.append("<tr>" + "".join(f"<th colspan={c.get('colspan', 1)}>{cell(c['c'])}</th>" for c in r) + "</tr>")
            for r in b["rows"]:
                rows.append("<tr>" + "".join(f"<td colspan={c.get('colspan', 1)} style='text-align:"
                                              f"{ {'l': 'left', 'c': 'center', 'r': 'right'}[c.get('align', 'l')]}'>"
                                              f"{cell(c['c'])}</td>" for c in r) + "</tr>")
            cap = f"<caption>{inl(b['caption'])}</caption>" if b.get("caption") else ""
            out.append(f"<table>{cap}{''.join(rows)}</table>")
        elif t == "figure":
            cap = f"<br><i>{inl(b['caption'])}</i>" if b.get("caption") else ""
            out.append(f"<div class=fig>[figure {b['id']} -> {e(b['src'])}] alt: {e(b.get('alt', ''))}{cap}</div>")
        else:
            out.append(f"<div class=fig>[{e(str(t))} {e(', '.join(b.get('ids', [])))}]</div>")
    return "".join(out)


def lesson_html(ch: dict, les: dict) -> str:
    parts = [f"<p class=meta>{ch['id']} — {e(ch['title'])} — reading {les['minutes']} min, labs {les['labMinutes']} min"
             f" — objectives {', '.join(les['objectives'])}</p>",
             f"<h1>{e(les['number'])} {inl(les['title'])}</h1>"]
    for s in les["steps"]:
        head = "" if s["id"].endswith("-0") else f"<h2>{e(s.get('number', ''))} {inl(s['title'])}</h2>"
        parts.append(f"<div class=step id='{e(s.get('anchor') or s['id'])}'><span class=meta>{s['id']}</span>{head}"
                     f"{blocks(s['blocks'])}</div>")
    return f"<!doctype html><meta charset=utf-8><title>{e(les['titleText'])}</title><style>{CSS}</style>" + "".join(parts)


def main(argv: list[str]) -> int:
    out_dir = CONVERTER / "preview"
    out_dir.mkdir(exist_ok=True)
    for lid in argv or ["ch04-s4", "ch07-s2", "ch16-s3"]:
        cid = lid.split("-")[0]
        ch = json.loads((OUT / "chapters" / f"{cid}.json").read_text())
        les = next(l for l in ch["lessons"] if l["id"] == lid)
        p = out_dir / f"{lid}.html"
        p.write_text(lesson_html(ch, les))
        print(p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
