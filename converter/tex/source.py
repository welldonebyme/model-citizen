"""Reading order of the book: main.tex \\part and \\input commands, nested \\input expanded in place.

main.tex itself is a layout file (title page, table of contents); only these commands are meaningful there:
\\part{..}, \\input{..}, \\appendix. Everything else in main.tex is checked against an allow-list.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .nodes import Cmd, ConvertError, Env, Group, Source, walk
from .parser import mask_comments, parse_source

MAIN_ALLOWED = {
    "documentclass", "input", "begin", "end", "frontmatter", "mainmatter", "appendix", "tableofcontents",
    "setcounter", "part", "fill", "node", "draw", "vspace", "sffamily", "large", "color", "textbf",
    "par", "vfill", "hfill", "Large", "bfseries", "fontsize", "selectfont", "scriptsize", "ttfamily",
}


@dataclass
class PartInfo:
    number: int          # 0..9
    title: str
    label: str           # "Part 0", "Part I", ...


@dataclass
class FileUnit:
    path: str            # relative to the book root
    nodes: list
    source: Source


@dataclass
class Unit:
    """One top-level \\input of main.tex (a chapter file), with its part and nested inputs expanded."""
    path: str
    part: PartInfo
    appendix: bool
    nodes: list                       # nested \input already spliced in
    files: list[str] = field(default_factory=list)


ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def read_main(book: Path) -> list[tuple[str, object]]:
    """Return the ordered events of main.tex: ("part", title) / ("input", path) / ("appendix", None)."""
    text = (book / "main.tex").read_text()
    masked = mask_comments(text)
    body = masked[masked.index("\\begin{document}"):]
    for m in re.finditer(r"\\(\\|[A-Za-z]+|.)", body):
        name = m.group(1)
        if not name[0].isalpha():
            continue
        if name not in MAIN_ALLOWED:
            # main.tex title page commands are layout; anything unexpected must be looked at
            raise ConvertError(f"main.tex: unexpected command \\{name} (update MAIN_ALLOWED after checking)")
    events: list[tuple[str, object]] = []
    for m in re.finditer(r"\\part\{([^}]*)\}|\\input\{([^}]*)\}|\\appendix\b", body):
        if m.group(1) is not None:
            events.append(("part", m.group(1)))
        elif m.group(2) is not None:
            events.append(("input", m.group(2)))
        else:
            events.append(("appendix", None))
    return events


def _file(book: Path, name: str) -> Path:
    p = book / (name if name.endswith(".tex") else name + ".tex")
    if not p.exists():
        raise ConvertError(f"\\input{{{name}}}: file not found")
    return p


def expand_inputs(book: Path, path: Path, files: list[str], seen: set) -> list:
    rel = str(path.relative_to(book))
    if rel in seen:
        raise ConvertError(f"{rel}: included twice")
    seen.add(rel)
    files.append(rel)
    src = Source(rel, path.read_text())
    nodes = parse_source(src)
    return _splice(book, nodes, files, seen)


def _splice(book: Path, nodes: list, files: list[str], seen: set) -> list:
    out = []
    for n in nodes:
        if isinstance(n, Cmd) and n.name == "input":
            out.extend(expand_inputs(book, _file(book, n.args[0].raw.strip()), files, seen))
        else:
            out.append(n)
    # \input must only appear at the top level of a file
    for n in walk(out):
        if isinstance(n, (Group, Env)):
            for m in walk(n.children):
                if isinstance(m, Cmd) and m.name == "input":
                    raise ConvertError(f"{m.where()}: \\input inside a group or environment")
    return out


def load_units(book: Path) -> list[Unit]:
    units: list[Unit] = []
    part: PartInfo | None = None
    appendix = False
    n_part = -1
    seen: set = set()
    for kind, val in read_main(book):
        if kind == "part":
            n_part += 1
            part = PartInfo(n_part, str(val), f"Part {ROMAN[n_part]}")
        elif kind == "appendix":
            appendix = True
        else:
            name = str(val)
            if name == "preamble":
                continue
            files: list[str] = []
            nodes = expand_inputs(book, _file(book, name), files, seen)
            if part is None:
                raise ConvertError(f"{name}: \\input before the first \\part")
            units.append(Unit(str(_file(book, name).relative_to(book)), part, appendix, nodes, files))
    return units
