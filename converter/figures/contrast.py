"""Text contrast check for every figure, in light and dark mode.

    .venv/bin/python contrast.py                  # site palette: text/background pairs below 4.5:1
    .venv/bin/python contrast.py --palette book   # the book's colours

For each text span of the standalone PDF (PyMuPDF text trace) the background is the last filled shape painted
before it whose box contains the span centre (or the page: transparent, so the site background). Colours are
mapped to their --fig-* token exactly like the SVG post-processor does, then the WCAG contrast ratio of the
light values and of the dark values is computed. Transparent areas show the palette's paper (the site
surface the figure sits on: #FFFFFF / the dark paper).
"""
from __future__ import annotations

import sys

import pymupdf

import colors
import figsrc
import texbuild



def lum(hexv: str) -> float:
    def ch(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = colors.hex_rgb(hexv)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def ratio(a: str, b: str) -> float:
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def to_hex(c) -> str:
    if isinstance(c, int):
        return f"#{c:06X}"
    return colors.rgb_hex(c[:3])


def check(figs, mapper: colors.Mapper) -> list[tuple]:
    """[(dark ratio, light ratio, figure id, text, text token, background token)] for every text span."""
    out = []
    for f in figs:
        cands = mapper.candidates(f.source + "\n".join(texbuild.chapter_prelude(f)))
        doc = pymupdf.open(str(texbuild.BUILD / f"{f.id}.pdf"))
        page = doc[0]
        fills = [d for d in page.get_drawings() if d.get("fill") is not None]

        def values(hexv, role):
            v = mapper.resolve(hexv, cands, f.id, role)
            tok = v[4: v.index(",")]
            u = mapper.used[tok]
            return tok, u["light"], u["dark"]

        for sp in page.get_texttrace():
            text = "".join(chr(c[0]) for c in sp["chars"]).strip()
            if not text:
                continue
            x0, y0, x1, y1 = sp["bbox"]
            centre = pymupdf.Point((x0 + x1) / 2, (y0 + y1) / 2)
            bg = None
            for d in fills:
                if d["seqno"] < sp["seqno"] and pymupdf.Rect(d["rect"]).contains(centre):
                    bg = d
            ttok, tl, td = values(to_hex(sp["color"]), "text")
            if bg is None:
                btok, bl, bd = "page (paper)", mapper.paper["light"], mapper.paper["dark"]
            else:
                btok, bl, bd = values(to_hex(bg["fill"]), "shape")
            out.append((round(ratio(td, bd), 2), round(ratio(tl, bl), 2), f.id, text[:40], ttok, btok))
        doc.close()
    out.sort()
    return out


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--palette", choices=sorted(colors.PALETTES), default=colors.DEFAULT_PALETTE)
    args = ap.parse_args()
    worst = check(figsrc.figures(), colors.Mapper(args.palette))
    print(f"palette {args.palette}; lowest contrast pairs "
          "(dark ratio, light ratio, figure, text, text token, background token):")
    seen = set()
    for dr, lr, fid, text, tt, bt in worst:
        if dr >= 4.5 and lr >= 4.5:
            continue
        key = (fid, tt, bt)
        if key in seen:
            continue
        seen.add(key)
        flag = "DARK<3" if dr < 3 else ("dark<4.5" if dr < 4.5 else "")
        flag += (" LIGHT<3" if lr < 3 else (" light<4.5" if lr < 4.5 else ""))
        print(f"  {dr:5.2f} {lr:5.2f}  {fid:10s} {text!r:44s} {tt} on {bt}  {flag}")
    print("min dark ratio %.2f, min light ratio %.2f" % (min(w[0] for w in worst), min(w[1] for w in worst)))
    print(f"{len(worst)} text spans checked; {sum(1 for w in worst if w[0] < 4.5)} below 4.5:1 and "
          f"{sum(1 for w in worst if w[0] < 3)} below 3:1 in dark mode; {sum(1 for w in worst if w[1] < 4.5)} "
          f"below 4.5:1 and {sum(1 for w in worst if w[1] < 3)} below 3:1 in light mode")
    return 0


if __name__ == "__main__":
    sys.exit(main())
