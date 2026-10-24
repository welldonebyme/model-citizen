"""Every definition (\\newcommand, \\renewcommand, \\tcbset, \\tikzset, \\setlength) found in the chapters.

A definition is accepted only if its source text (whitespace-normalised) is listed here. If the book changes a
definition, the converter stops with a clear message instead of rendering stale behaviour.

Actions:
    layout     the definition only changes layout (line breaking, spacing, tikz styles): ignored
    codestyle  a chapter-local tcolorbox style for code listings; using it sets {small: true}
    macro      a chapter-local macro whose rendering is implemented in render/inline.py or render/blocks.py
"""
from __future__ import annotations

import re

from .nodes import Cmd, ConvertError


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


_SMALL = "listing options={language={},basicstyle=\\ttfamily\\scriptsize}"
_BASHFN = ("listing options={language=bashx,basicstyle=\\ttfamily\\footnotesize\\color{white}, "
           "keywordstyle=\\color{accent!60!white}\\bfseries,commentstyle=\\color{white!60!ink}\\itshape, "
           "stringstyle=\\color{green!60!white}}")

# (command, normalised raw arguments joined with " | ") -> (action, name)
KNOWN: dict[tuple[str, str], tuple[str, str]] = {
    ("tcbset", f"c8small/.style={{{_SMALL}}}"): ("codestyle", "c8small"),
    ("tcbset", f"c9small/.style={{{_SMALL}}}"): ("codestyle", "c9small"),
    ("tcbset", f"c11small/.style={{{_SMALL}}}"): ("codestyle", "c11small"),
    ("tcbset", f"c12small/.style={{{_SMALL}}}"): ("codestyle", "c12small"),
    ("tcbset", f"c14out/.style={{{_BASHFN}}}"): ("codestyle", "c14out"),
    ("tcbset", f"c16fn/.style={{left=2pt,right=2pt,{_BASHFN}}}"): ("codestyle", "c16fn"),
    ("tcbset", "halign=flush left"): ("layout", ""),
    ("setlength", "\\emergencystretch | 3em"): ("layout", ""),
    ("renewcommand", "\\_ | - | \\textunderscore\\allowbreak"): ("layout", ""),
    ("renewcommand", "\\arraystretch | - | 1.5"): ("layout", ""),
    ("renewcommand", "\\arraystretch | - | 1.75"): ("layout", ""),
    ("renewcommand", "\\arraystretch | - | 1.9"): ("layout", ""),
    ("renewcommand", "\\arraystretch | - | 2.1"): ("layout", ""),
    ("newcommand", "\\capscore | - | \\checkbox\\,S\\ \\checkbox\\,H\\ \\checkbox\\,R"): ("macro", "capscore"),
    ("newcommand", "\\cxxviiwhere | 1 | {\\unskip\\nobreak\\hfil\\penalty50\\hskip1.5em\\hbox{}\\nobreak\\hfil "
                   "\\mbox{\\sffamily\\footnotesize\\color{muted}\\faBookOpen\\ #1}\\parfillskip=0pt"
                   "\\finalhyphendemerits=0\\par}"): ("macro", "cxxviiwhere"),
    ("newcommand", "\\cxxviitrap | 3 | \\item {\\sffamily\\bfseries\\small\\color{trapC}Confusion.}\\ #1\\par"
                   "\\nopagebreak {\\sffamily\\bfseries\\small\\color{labC!80!black}Truth.}\\ #2\\cxxviiwhere{#3}"):
        ("macro", "cxxviitrap"),
}

# tikz styles of Chapter 3 (layout of its figures only)
TIKZSET_CH3 = ("gcommit/.style={circle,draw=ink,fill=white,thick,minimum size=8mm,inner sep=0pt,"
               "font=\\ttfamily\\scriptsize}, gnew/.style={gcommit,fill=accent!20,draw=accent}, "
               "gmerge/.style={gcommit,fill=labC!20,draw=labC}, glabel/.style={rounded corners=2pt,"
               "font=\\sffamily\\scriptsize\\bfseries,inner sep=3pt,text=white}, gmain/.style={glabel,fill=ink}, "
               "gfeat/.style={glabel,fill=accent}, ghead/.style={glabel,fill=labC}, "
               "garrow/.style={-{Stealth[length=2mm]},thick,ink!70}, gline/.style={thick,ink!60},")
KNOWN[("tikzset", TIKZSET_CH3)] = ("layout", "")


def check_definition(cmd: Cmd) -> tuple[str, str]:
    key = (cmd.name, " | ".join(_norm(a.raw) if a.present else "-" for a in cmd.args))
    if key not in KNOWN:
        raise ConvertError(f"{cmd.where()}: unknown definition \\{cmd.name} {key[1][:120]!r} "
                           f"(add it to converter/tex/definitions.py after checking what it does)")
    return KNOWN[key]
