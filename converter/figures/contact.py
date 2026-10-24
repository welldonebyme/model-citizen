"""Contact sheet for reviewing the figures: book crop | SVG light | SVG dark, one row per figure.

    .venv/bin/python contact.py        # writes contact-sheet.html (+ build/book/*.png, build/fonts/*)
    node screenshot.mjs                # writes screenshots/*.png (chromium; --all-browsers adds firefox/webkit)

The book crop comes from ../dbt-bible/dbt-bible.pdf (read only): the page that contains the figure's
words, cropped around them. The SVGs are inlined so the --fig-* variables apply; the dark column
scopes the dark token values to `.dark`.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

import pymupdf

import figsrc
import fonts

HERE = figsrc.HERE
OUT = figsrc.ACADEMY / "site/src/generated/figures"
BOOK_PDF = figsrc.BOOK / "dbt-bible.pdf"
BUILD = HERE / "build"
FONTS = {  # CSS family, weight, style -> font name in fonts.py
    ("Fira Sans", 400, "normal"): "FiraSans-Regular",
    ("Fira Sans", 600, "normal"): "FiraSans-SemiBold",
    ("Fira Sans", 400, "italic"): "FiraSans-Italic",
    ("Fira Sans", 600, "italic"): "FiraSans-SemiBoldItalic",
    ("Fira Mono", 400, "normal"): "FiraMono-Regular",
    ("Fira Mono", 700, "normal"): "FiraMono-Bold",
    ("TeX Gyre Pagella", 400, "normal"): "TeXGyrePagella-Regular",
}


def copy_fonts() -> list[str]:
    """@font-face rules for the book's fonts (copied from tectonic's cache by fonts.py)."""
    faces = []
    for (fam, wt, st), name in FONTS.items():
        target = fonts.font_file(name)
        if target is not None:
            faces.append(f"@font-face{{font-family:'{fam}';font-weight:{wt};font-style:{st};"
                         f"src:url('build/fonts/{target.name}') format('opentype');}}")
    return faces


RESIZED = {"ch26-fig1"}  # \\resizebox{\\linewidth}{!} in the book: scaled to the text width
LINEWIDTH_PT = 16.2 / 2.54 * 72


def _locate(fig_page, book_page, scale: float = 1.0):
    """Offset of the figure on a book page, found by matching the sizes of its vector shapes (each shape of
    the standalone PDF appears on the book page translated by the same offset). Returns (votes, rect)."""
    from collections import Counter
    fd = [d["rect"] for d in fig_page.get_drawings() if d["rect"].width * d["rect"].height > 4]
    fd = sorted(fd, key=lambda r: -r.width * r.height)[:60]
    bd = [d["rect"] for d in book_page.get_drawings()]
    votes = Counter()
    for f in fd:
        fw, fh = f.width * scale, f.height * scale
        for b in bd:
            if abs(b.width - fw) < 0.4 and abs(b.height - fh) < 0.4:
                votes[(round(b.x0 - f.x0 * scale), round(b.y0 - f.y0 * scale))] += 1
    if not votes:
        return 0, None
    (dx, dy), n = votes.most_common(1)[0]
    r = fig_page.rect
    return n, pymupdf.Rect(r.x0 * scale + dx, r.y0 * scale + dy, r.x1 * scale + dx, r.y1 * scale + dy)


def book_crops(meta) -> dict[str, tuple[int, str]]:
    """For each figure: (book page number, png path) cropped to the figure on its book page."""
    out_dir = BUILD / "book"
    out_dir.mkdir(parents=True, exist_ok=True)
    book = pymupdf.open(str(BOOK_PDF))
    page_words = [set(w[4] for w in p.get_text("words")) for p in book]
    res = {}
    start = 0
    for m in meta:
        fig = pymupdf.open(str(BUILD / f"{m['id']}.pdf"))
        fp = fig[0]
        scale = LINEWIDTH_PT / fp.rect.width if m["id"] in RESIZED else 1.0
        uniq = set(w[4] for w in fp.get_text("words"))
        ranked = sorted(range(start, len(book)), key=lambda p: (-len(uniq & page_words[p]), p))[:4]
        best, rect, votes = None, None, 0
        for pno in ranked:
            n, r = _locate(fp, book[pno], scale)
            if n > votes:
                best, rect, votes = pno, r, n
        fig.close()
        if rect is None:
            best, rect = ranked[0], book[ranked[0]].rect
        page = book[best]
        clip = pymupdf.Rect(rect.x0 - 8, rect.y0 - 8, rect.x1 + 8, rect.y1 + 8) & page.rect
        page.get_pixmap(dpi=150, clip=clip).save(str(out_dir / f"{m['id']}.png"))
        res[m["id"]] = (best + 1, f"build/book/{m['id']}.png", votes)
        start = best  # figures appear in book order
    book.close()
    return res


def dark_css() -> str:
    css = (OUT / "figures.css").read_text()
    block = re.search(r':root\[data-theme="dark"\] \{(.*?)\}', css, re.S).group(1)
    return ".dark {" + block + "}"


def main() -> None:
    meta = json.loads((OUT / "figures.json").read_text())
    faces = copy_fonts()
    crops = book_crops(meta)
    css = (OUT / "figures.css").read_text()
    rows = []
    for m in meta:
        svg = (OUT / m["svg"]).read_text()
        page, png, votes = crops[m["id"]]
        kb = len(svg.encode()) / 1024
        rows.append(f"""<section class="row" id="{m['id']}">
<h2>{m['id']} <small>{html.escape(m['file'])}:{m['line']} · book p. {page} · {m['width']}×{m['height']} px · {kb:.1f} KiB</small></h2>
<p class="alt">{html.escape(m.get('alt') or '(no alt text yet)')}</p>
<div class="cols">
<figure class="book"><img src="{png}" alt=""><figcaption>book PDF (p. {page}, located by {votes} matching shapes)</figcaption></figure>
<figure class="light">{svg}<figcaption>SVG light</figcaption></figure>
<figure class="dark">{svg}<figcaption>SVG dark</figcaption></figure>
</div></section>""")
    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Figures contact sheet</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
{chr(10).join(faces)}
{css}
{dark_css()}
body {{ margin: 0; padding: 16px; font: 14px/1.4 system-ui, sans-serif; background: #e9ecf1; color: #111; }}
.row {{ background: #fff; margin: 0 0 14px; padding: 8px 12px 12px; border-radius: 6px; }}
h2 {{ font-size: 15px; margin: 0 0 2px; }} h2 small {{ font-weight: 400; color: #555; }}
.alt {{ margin: 0 0 6px; color: #333; font-size: 12px; }}
.cols {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; align-items: start; }}
figure {{ margin: 0; padding: 8px; border-radius: 4px; }}
figure svg, figure img {{ width: 100%; height: auto; display: block; }}
figcaption {{ font-size: 11px; color: #777; margin-top: 4px; }}
.book {{ background: #fff; border: 1px solid #ddd; }}
.light {{ background: #ffffff; border: 1px solid #ddd; }}
.dark {{ background: #0E131B; border: 1px solid #0E131B; }}
.dark figcaption {{ color: #aaa; }}
</style></head><body>
<h1>Model Citizen: 64 book figures (book · light · dark)</h1>
{chr(10).join(rows)}
</body></html>
"""
    (HERE / "contact-sheet.html").write_text(doc)
    print("wrote contact-sheet.html")


if __name__ == "__main__":
    main()
