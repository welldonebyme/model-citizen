"""PDF page -> themable SVG.

PyMuPDF (MuPDF's SVG device, text kept as real <text>) converts the PDF; the result is then cleaned: text
becomes word runs (one <tspan x> per word or TeX-placed run, word spaces restored for copy/search), colours become CSS custom properties with the book colour as fallback, fonts
become CSS font stacks (also overridable), ids get a per-figure prefix (several SVGs can be inlined in one
page), fill+stroke path pairs are merged, numbers are rounded, width/height are set in CSS px.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import pymupdf

import colors
import fonts

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
XML_NS = "http://www.w3.org/XML/1998/namespace"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)

PT_TO_PX = 96 / 72

FONT_SANS = "var(--fig-font-sans, 'Fira Sans', 'Helvetica Neue', Arial, sans-serif)"
FONT_MONO = "var(--fig-font-mono, 'Fira Mono', Menlo, Consolas, monospace)"
FONT_SERIF = "var(--fig-font-serif, 'TeX Gyre Pagella', Palatino, 'Palatino Linotype', 'Book Antiqua', serif)"
FONT_MATH = ("var(--fig-font-math, 'Fira Sans', 'STIX Two Math', 'Cambria Math', 'Segoe UI Symbol', "
             "'Apple Symbols', 'DejaVu Sans', sans-serif)")
# TeX builds long arrows from two glyphs (an arrow and a minus that overlap); in a web font they would not
# join, so the pair becomes the single long-arrow character (the font stack above has fallbacks for it).
MATH_JOIN = {"\u2190\u2212": "\u27F5", "\u2212\u2192": "\u27F6"}


# MuPDF family name -> font used for glyph advances (fonts.py)
METRIC_FONT = {
    "FiraSans-Regular": "FiraSans-Regular", "FiraSans-SemiBold": "FiraSans-SemiBold",
    "FiraSans-Italic": "FiraSans-Italic", "FiraSans-SemiBoldItalic": "FiraSans-SemiBoldItalic",
    "Fira Mono": "FiraMono-Regular", "FiraMono-Regular": "FiraMono-Regular", "FiraMono-Bold": "FiraMono-Bold",
    "TeXGyrePagella": "TeXGyrePagella-Regular", "TeXGyrePagella-Regular": "TeXGyrePagella-Regular",
}
GAP_TOLERANCE = 0.12  # em: a glyph placed further than this from its natural position starts a new run
WORD_GAP = 0.18       # em: such a gap is a word space (TeX glue has no space character in the PDF)


def segment_words(text_el, metric_font: str, size: float) -> None:
    """MuPDF gives one x per glyph. Keep an explicit x only where a run starts: at each word and wherever TeX
    moved a glyph away from its natural advance (glue, \\hspace, column alignment). Inside a run the browser
    uses the font's own advances: identical with Fira, and still readable with a fallback font (per-glyph x
    with a wider fallback font makes letters collide, e.g. "Jinja")."""
    new = []
    for ts in list(text_el):
        chars = ts.text or ""
        xs = (ts.get("x") or "").split()
        if _local(ts.tag) != "tspan" or len(xs) != len(chars) or len(chars) < 2 or len(ts):
            new.append([ts])
            continue
        starts = [0]
        spaced = set()   # run starts preceded by a word gap that has no space character in the PDF
        for i in range(1, len(chars)):
            c, prev = chars[i], chars[i - 1]
            if c == " ":
                continue                      # a space stays at the end of the run before it
            if prev == " ":
                starts.append(i)
                continue
            adv = fonts.advance(metric_font, prev)
            gap = None if adv is None else float(xs[i]) - float(xs[i - 1]) - adv * size
            if gap is None or abs(gap) > GAP_TOLERANCE * size:
                starts.append(i)
                if gap is not None and gap > WORD_GAP * size:
                    spaced.add(i)
        runs = []
        for k, st in enumerate(starts):
            end = starts[k + 1] if k + 1 < len(starts) else len(chars)
            t = ET.Element(ts.tag, {"x": xs[st]})
            if k == 0 and ts.get("y") is not None:
                t.set("y", ts.get("y"))
            t.text = chars[st:end]
            if k + 1 < len(starts) and starts[k + 1] in spaced:
                t.text += " "                 # keeps words apart in copy/paste and find-in-page
            runs.append(t)
        new.append(runs)
    # a line break between two lines of a node also separates two words (but not after a hyphen)
    for j, item in enumerate(new[:-1]):
        last = item[-1] if isinstance(item, list) else item
        if last.text and not last.text.endswith((" ", "-")) and not len(last):
            last.text += " "
    new = [t for item in new for t in (item if isinstance(item, list) else [item])]
    for ch in list(text_el):
        text_el.remove(ch)
    for t in new:
        text_el.append(t)


def join_math_glyphs(tspan) -> None:
    text = tspan.text or ""
    xs = (tspan.get("x") or "").split()
    if len(xs) != len(text):
        return
    i = 0
    out, out_x = [], []
    while i < len(text):
        pair = text[i: i + 2]
        if pair in MATH_JOIN:
            out.append(MATH_JOIN[pair])
            out_x.append(xs[i])
            i += 2
        else:
            out.append(text[i])
            out_x.append(xs[i])
            i += 1
    tspan.text = "".join(out)
    tspan.set("x", " ".join(out_x))

# PDF font name (as MuPDF reports it in font-family) -> (stack, weight, style)
FONT_MAP = {
    "FiraSans-Regular": (FONT_SANS, None, None),
    "FiraSans-SemiBold": (FONT_SANS, "600", None),
    "FiraSans-Italic": (FONT_SANS, None, "italic"),
    "FiraSans-SemiBoldItalic": (FONT_SANS, "600", "italic"),
    "Fira Mono": (FONT_MONO, None, None),          # regular and bold (weight attribute kept)
    "FiraMono-Regular": (FONT_MONO, None, None),
    "FiraMono-Bold": (FONT_MONO, "700", None),
    "TeXGyrePagella": (FONT_SERIF, None, None),
    "TeXGyrePagella-Regular": (FONT_SERIF, None, None),
    "Computer Modern": (FONT_MATH, None, "normal"),  # CMSY/CMMI: arrows, minus, '>'
}

NUM = re.compile(r"-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")


def _fmt(v: float, nd: int) -> str:
    s = f"{v:.{nd}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    if s in ("-0", ""):
        s = "0"
    if s.startswith("0.") and len(s) > 2:
        s = s[1:]
    elif s.startswith("-0.") and len(s) > 3:
        s = "-" + s[2:]
    return s


PATH_TOKEN = re.compile(r"[A-Za-z]|-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")


def round_path(d: str, nd: int = 2) -> str:
    out = []
    prev_num = False
    for t in PATH_TOKEN.findall(d):
        if t.isalpha():
            out.append(t)
            prev_num = False
        else:
            s = _fmt(float(t), nd)
            if prev_num and not s.startswith("-"):
                out.append(" ")
            out.append(s)
            prev_num = True
    return "".join(out)


def round_transform(t: str) -> str:
    def mat(m):
        vals = [float(x) for x in NUM.findall(m.group(1))]
        if len(vals) != 6:
            return m.group(0)
        a = [_fmt(v, 4) for v in vals[:4]] + [_fmt(v, 2) for v in vals[4:]]
        if a[:4] == ["1", "0", "0", "1"]:
            return f"translate({a[4]} {a[5]})"
        return "matrix(" + " ".join(a) + ")"
    return re.sub(r"matrix\(([^)]*)\)", mat, t)


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1]


def pdf_to_svg_text(pdf_path) -> str:
    doc = pymupdf.open(str(pdf_path))
    try:
        if doc.page_count != 1:
            raise SystemExit(f"{pdf_path}: expected one page, got {doc.page_count}")
        return doc[0].get_svg_image(text_as_path=False)
    finally:
        doc.close()


def postprocess(raw: str, fig_id: str, mapper: colors.Mapper, cands: list[str],
                title: str | None = None) -> tuple[str, float, float, dict]:
    root = ET.fromstring(raw)
    stats = {"text": 0, "path": 0, "fonts": set()}
    vb = [float(x) for x in root.get("viewBox").split()]
    w_pt, h_pt = vb[2], vb[3]

    # ---- ids: prefix so that several inlined SVGs never clash
    idmap = {}
    for el in root.iter():
        i = el.get("id")
        if i:
            new = f"{fig_id}-{re.sub(r'[^A-Za-z0-9]+', '', i)}"
            idmap[i] = new
            el.set("id", new)

    def fix_refs(val: str) -> str:
        return re.sub(r"url\(#([^)]+)\)", lambda m: f"url(#{idmap.get(m.group(1), m.group(1))})", val)

    # ---- walk
    def walk(el, in_clip=False):
        tag = _local(el.tag)
        clip = in_clip or tag == "clipPath"
        for attr in list(el.attrib):
            val = el.attrib[attr]
            if attr in ("clip-path", "mask", "fill", "stroke") and "url(" in val:
                el.set(attr, fix_refs(val))
                continue
            if attr in ("fill", "stroke") and val.startswith("#"):
                if clip:
                    del el.attrib[attr]
                    continue
                role = "text" if tag in ("text", "tspan") and attr == "fill" else "shape"
                el.set(attr, mapper.resolve(val, cands, fig_id, role))
            elif attr == "d":
                el.set(attr, round_path(val, 2))
            elif attr == "transform":
                el.set(attr, round_transform(val))
            elif attr in ("x", "y"):
                el.set(attr, " ".join(_fmt(float(v), 2) for v in NUM.findall(val)))
            elif attr in ("stroke-width", "font-size", "stroke-miterlimit", "stroke-dashoffset"):
                el.set(attr, _fmt(float(val), 3))
            elif attr == "stroke-dasharray":
                el.set(attr, " ".join(_fmt(float(v), 3) for v in NUM.findall(val)))
        if tag == "text":
            stats["text"] += 1
            fam = el.get("font-family")
            if fam is not None:
                stats["fonts"].add(fam)
                if fam not in FONT_MAP:
                    raise SystemExit(f"{fig_id}: unknown font {fam!r}; add it to svgpost.FONT_MAP")
                stack, weight, style = FONT_MAP[fam]
                if fam == "Fira Mono" and el.get("font-weight") == "bold":
                    weight = "700"
                if stack == FONT_MATH:
                    for ts in el:
                        join_math_glyphs(ts)
                else:
                    metric = METRIC_FONT[fam]
                    if fam == "Fira Mono" and el.get("font-weight") == "bold":
                        metric = "FiraMono-Bold"
                    segment_words(el, metric, float(el.get("font-size")))
                if stack == FONT_SANS:
                    del el.attrib["font-family"]          # inherited from the root
                else:
                    el.set("font-family", stack)
                if weight:
                    el.set("font-weight", weight)
                elif "font-weight" in el.attrib:
                    del el.attrib["font-weight"]
                if style and style != "normal":
                    el.set("font-style", style)
                elif "font-style" in el.attrib:
                    del el.attrib["font-style"]
        if tag == "path":
            stats["path"] += 1
        # stroke-linecap butt / miterlimit 10 / linejoin miter are the SVG defaults except miterlimit (4)
        if el.get("stroke-linecap") == "butt":
            del el.attrib["stroke-linecap"]
        if el.get("stroke-linejoin") == "miter":
            del el.attrib["stroke-linejoin"]
        for ch in list(el):
            walk(ch, clip)

    walk(root)

    # ---- merge "fill-only path" + "stroke-only path" with the same geometry (MuPDF emits both)
    def merge(parent):
        kids = list(parent)
        i = 0
        while i < len(kids) - 1:
            a, b = kids[i], kids[i + 1]
            if (_local(a.tag) == _local(b.tag) == "path" and a.get("d") == b.get("d")
                    and a.get("transform") == b.get("transform") and a.get("stroke") is None
                    and b.get("fill") == "none" and a.get("fill") not in (None, "none")
                    and b.get("stroke") is not None):
                for k, v in b.attrib.items():
                    if k != "fill":
                        a.set(k, v)
                parent.remove(b)
                kids.pop(i + 1)
                stats["path"] -= 1
                continue
            i += 1
        for ch in parent:
            merge(ch)

    merge(root)

    # ---- hoist the stroke-miterlimit="10" that every stroked path carries
    for el in root.iter():
        if el.get("stroke-miterlimit") == "10":
            del el.attrib["stroke-miterlimit"]

    # ---- root attributes
    for k in list(root.attrib):
        if k not in ("viewBox",):
            del root.attrib[k]
    w_px, h_px = round(w_pt * PT_TO_PX), round(h_pt * PT_TO_PX)
    root.set("viewBox", " ".join(_fmt(v, 2) for v in vb))
    root.set("width", str(w_px))
    root.set("height", str(h_px))
    root.set("role", "img")
    root.set("data-figure", fig_id)
    root.set("font-family", FONT_SANS)
    root.set("fill", mapper.resolve("#000000", cands, fig_id, "text"))
    root.set("stroke-miterlimit", "10")
    if title:
        root.set("aria-labelledby", f"{fig_id}-title")
        t = ET.Element(f"{{{SVG_NS}}}title", {"id": f"{fig_id}-title"})
        t.text = title
        root.insert(0, t)

    # ---- layout: one element per line, nothing inside <text>
    root.text = "\n"
    def tails(parent):
        for ch in parent:
            if _local(ch.tag) in ("text",):
                ch.tail = "\n"
                continue
            ch.tail = "\n"
            if len(ch) and _local(ch.tag) in ("g", "defs", "clipPath"):
                ch.text = "\n"
                tails(ch)
    tails(root)
    # drop empty <defs>
    for d in [c for c in root if _local(c.tag) == "defs" and len(c) == 0]:
        root.remove(d)

    xml = ET.tostring(root, encoding="unicode", short_empty_elements=True)
    xml = xml.replace(' xmlns:xlink="http://www.w3.org/1999/xlink"', "") if "xlink:" not in xml.split(">", 1)[1] else xml
    return xml + "\n", w_px, h_px, stats
