"""Book colours -> CSS custom properties.

Every colour that appears in a figure is traced back to the xcolor expression that produced it
(``accent``, ``accent!12``, ``labC!80!black``, ``green!35!black`` ...). Each expression gets one token
``--fig-<name>[-<pct>[-<name2>]]`` whose light and dark values are the same expression evaluated with the
light and dark base colours of the chosen output palette (PALETTES: "site" = the site's brand, default;
"book" = the book's own colours). Because "white" means *paper* and
"black" means *text* in the book, tints (``x!12`` = 12 % x on white) become dark tints in dark mode and
shades (``x!80!black``) become lighter, so contrast follows automatically.
"""
from __future__ import annotations

import re

import figsrc

# xcolor base colours (rgb model) that the figures may use
XCOLOR_BASE = {
    "white": (1, 1, 1), "black": (0, 0, 0), "red": (1, 0, 0), "green": (0, 1, 0), "blue": (0, 0, 1),
    "yellow": (1, 1, 0), "orange": (1, 0.5, 0), "gray": (0.5, 0.5, 0.5), "cyan": (0, 1, 1),
    "magenta": (1, 0, 1), "violet": (0.5, 0, 0.5), "purple": (0.75, 0, 0.25), "brown": (0.75, 0.5, 0.25),
    "lightgray": (0.75, 0.75, 0.75), "darkgray": (0.25, 0.25, 0.25), "teal": (0, 0.5, 0.5),
    "olive": (0.5, 0.5, 0), "lime": (0.75, 1, 0), "pink": (1, 0.75, 0.75),
}

# token stem for every base colour name
STEM = {
    "ink": "ink", "examC": "ink", "accent": "accent", "muted": "muted", "deepC": "muted",
    "codebg": "code-bg", "codeframe": "code-frame", "outbg": "out-bg",
    "whyC": "why", "ideaC": "idea", "labC": "lab", "trapC": "trap", "tipC": "tip", "quizC": "quiz",
    "kw": "kw", "str": "str", "cmt": "cmt", "jinja": "jinja",
    "white": "paper", "black": "text",
}

# Dark-mode base palette (hand-picked; tints and shades are derived from it).
DARK_BASE = {
    "white": "#141A24",    # paper: node fills that are white in the book
    "black": "#ECEFF4",    # default text colour (black in the book)
    "ink": "#DCE2EC", "examC": "#DCE2EC",
    "muted": "#9BA3B1", "deepC": "#9BA3B1",
    "codebg": "#1B2230", "codeframe": "#3A4456", "outbg": "#1C201B",
    "accent": "#F27C67", "whyC": "#6FA6FA", "ideaC": "#F2A43A", "labC": "#3CC79C",
    "trapC": "#F47474", "tipC": "#2BC0E0", "quizC": "#A98EF8",
    "kw": "#7AA2F7", "str": "#4ADE80", "cmt": "#8A8F98", "jinja": "#F59E0B",
}
# expressions whose dark value is chosen by hand (the computed one would not keep its text readable)
DARK_OVERRIDE = {
    # dbt-docs-like yellow node in ch20-fig2 carries default (black -> light) text: darken it
    "yellow!70!orange": "#7A6413",
    # dbt-docs-like blue mart nodes in ch20-fig2 carry white (-> dark) text: the computed #5E60FB is too dark
    "blue!60!black": "#8F97FF",
}
# Colours that xcolor emits in CMYK (yellow is a cmy colour in xcolor) come out of MuPDF's CMYK->RGB
# conversion slightly shifted; they are matched explicitly. hex as found in the SVG -> expression.
PDF_ALIASES = {
    "#FFD401": "yellow!70!orange",   # cmyk(0, .15, 1, 0); naive RGB would be #FFD900
}
# Output palettes. The PDF always uses the book colours (they identify the expression); the palette decides
# the values written to the SVG fallbacks and to figures.css: `light` and `dark` override base colours, and
# every tint/mix (accent!15, ink!70 ...) is recomputed from the overridden base.
PALETTES = {
    # the site's brand (default output): accent family -> magenta, slightly deeper ink, the site's dark surface
    "site": {
        "light": {"accent": "#B4237A", "ink": "#16213B", "examC": "#16213B"},
        "dark": {**DARK_BASE, "accent": "#F06AB4", "white": "#17223A"},
    },
    # the book's own colours (light = exactly the PDF)
    "book": {"light": {}, "dark": dict(DARK_BASE)},
}
DEFAULT_PALETTE = "site"


def book_palette() -> dict[str, tuple[float, float, float]]:
    pal = dict(XCOLOR_BASE)
    for name, hexv in re.findall(r"\\definecolor\{(\w+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}",
                                 (figsrc.BOOK / "preamble.tex").read_text()):
        pal[name] = tuple(int(hexv[i: i + 2], 16) / 255 for i in (0, 2, 4))
    return pal


def hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i: i + 2], 16) / 255 for i in (0, 2, 4))


def rgb_hex(c) -> str:
    return "#" + "".join(f"{max(0, min(255, round(v * 255))):02X}" for v in c)


def evaluate(expr: str, pal: dict) -> tuple[float, float, float]:
    """xcolor mix: a!p!b = p% a + (100-p)% b; a!p = a!p!white; chains are left-associative."""
    parts = expr.split("!")
    cur = pal[parts[0]]
    i = 1
    while i < len(parts):
        p = float(parts[i]) / 100
        other = pal[parts[i + 1]] if i + 1 < len(parts) else pal["white"]
        cur = tuple(p * a + (1 - p) * b for a, b in zip(cur, other))
        i += 2
    return cur


def token(expr: str) -> str:
    parts = expr.split("!")
    out = [STEM.get(parts[0], parts[0].lower())]
    for j, p in enumerate(parts[1:]):
        if j % 2 == 0:
            out.append(p.replace(".", "_"))
        elif p == "white":
            continue  # 'x!p!white' is the same as 'x!p'
        elif p == "black":
            out.append("black")
        else:
            out.append(STEM.get(p, p.lower()))
    return "--fig-" + "-".join(out)


def expressions_in(text: str, pal: dict) -> set[str]:
    names = sorted(pal, key=len, reverse=True)
    pat = re.compile(r"(?<![A-Za-z\\])(" + "|".join(names) + r")((?:![0-9.]+(?:!(?:" + "|".join(names) + r"))?)*)(?![A-Za-z])")
    out = set()
    for m in pat.finditer(text):
        expr = m.group(1) + m.group(2)
        # a trailing "!p" without second colour is fine; normalise "x!100" -> x
        out.add(expr)
    return out


class Mapper:
    """Map hex colours found in one figure's SVG to tokens."""

    def __init__(self, palette: str = DEFAULT_PALETTE):
        self.palette = palette
        spec = PALETTES[palette]
        self.pal = book_palette()                     # matching (what the PDF contains) and the "book" column
        self.light_pal = {**self.pal, **{k: hex_rgb(v) for k, v in spec["light"].items()}}
        self.dark_pal = {**self.pal, **{k: hex_rgb(v) for k, v in spec["dark"].items()}}
        self.paper = {"light": rgb_hex(self.light_pal["white"]), "dark": rgb_hex(self.dark_pal["white"])}
        self.used: dict[str, dict] = {}     # token -> info (expr, book, light, dark, figures)
        self.unmatched: dict[str, set] = {}

    def candidates(self, fig_text: str) -> list[str]:
        local = sorted(expressions_in(fig_text, self.pal))
        base = ["ink", "accent", "muted", "codebg", "codeframe", "outbg", "whyC", "ideaC", "labC", "trapC",
                "tipC", "quizC", "white", "black"]
        return local + [b for b in base if b not in local]

    def match(self, hexv: str, cands: list[str]) -> str | None:
        alias = PDF_ALIASES.get(rgb_hex(hex_rgb(hexv)))
        if alias and alias in cands:
            return alias
        target = hex_rgb(hexv)
        best = None
        for expr in cands:
            try:
                c = evaluate(expr, self.pal)
            except (KeyError, IndexError, ValueError):
                continue
            d = max(abs(a - b) for a, b in zip(c, target)) * 255
            if d <= 1.01 and (best is None or d < best[0]):
                best = (d, expr)
        return best[1] if best else None

    def resolve(self, hexv: str, cands: list[str], fig_id: str, role: str) -> str:
        """Return the attribute value var(--fig-..., #HEX) for a colour."""
        light = rgb_hex(hex_rgb(hexv))
        if role == "text" and light == "#FFFFFF":
            tok = "--fig-on-solid"
            # white *text* sits on solid colour badges: it stays white in light mode, becomes paper-dark in dark mode
            info = self.used.setdefault(tok, {"expr": "white (text on a solid fill)", "book": "#FFFFFF",
                                              "light": "#FFFFFF", "dark": self.paper["dark"],
                                              "figures": set(), "hex": set()})
        else:
            expr = self.match(hexv, cands)
            if expr is None:
                self.unmatched.setdefault(light, set()).add(fig_id)
                tok = "--fig-x-" + light[1:].lower()
                info = self.used.setdefault(tok, {"expr": "(unmatched)", "book": light, "light": light,
                                                  "dark": light, "figures": set(), "hex": set()})
            else:
                expr = re.sub(r"!100$", "", expr)
                tok = token(expr)
                if tok not in self.used:
                    dark = DARK_OVERRIDE.get(expr) or rgb_hex(evaluate(expr, self.dark_pal))
                    self.used[tok] = {"expr": expr, "book": rgb_hex(evaluate(expr, self.pal)),
                                      "light": rgb_hex(evaluate(expr, self.light_pal)), "dark": dark,
                                      "figures": set(), "hex": set()}
                info = self.used[tok]
        info["figures"].add(fig_id)
        info["hex"].add(light)
        return f"var({tok}, {info['light']})"
