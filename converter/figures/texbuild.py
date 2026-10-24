"""Write one standalone .tex file per figure and compile it to PDF with tectonic.

The preamble is derived from the book's preamble.tex at build time (fonts, packages, colours, inline
helpers), minus the parts that only make sense for a full book page (geometry, chapter/section headings,
header/footer, hyperref). Chapter-local definitions that appear at the top level of the chapter's files
before the figure (\\tikzset styles, \\renewcommand{\\_}, \\raggedright ...) are replayed in front of it.
"""
from __future__ import annotations

import hashlib
import re
import subprocess
from pathlib import Path

import figsrc

BUILD = figsrc.HERE / "build"
TECTONIC = "/opt/homebrew/bin/tectonic"

DROP_SECTIONS = ("Headings", "Header / footer")
DROP_LINE = re.compile(r"\\usepackage(\[[^\]]*\])?\{(geometry|titlesec|fancyhdr|hyperref|bookmark)\}"
                       r"|\\renewcommand\{\\thepart\}")


def _balanced(text: str, i: int, open_ch: str = "{", close_ch: str = "}") -> int:
    """Return the index just after the group starting at text[i] == open_ch."""
    assert text[i] == open_ch, (text[i: i + 20], open_ch)
    depth = 0
    j = i
    while j < len(text):
        ch = text[j]
        if ch == "\\":
            j += 2
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    raise ValueError("unbalanced group")


def figure_preamble() -> str:
    text = (figsrc.BOOK / "preamble.tex").read_text()
    # split into sections by the "% ---------- Name ----" markers
    parts = re.split(r"(?m)^(% -{10} .*)$", text)
    out = [parts[0]]
    for marker, body in zip(parts[1::2], parts[2::2]):
        name = re.sub(r"^% -+ | -+$", "", marker).strip()
        if name in DROP_SECTIONS:
            out.append(f"% [figures] dropped section: {name}\n")
            continue
        out.append(marker + body)
    pre = "".join(out)
    # \hypersetup{...} spans two lines: remove the whole group
    m = re.search(r"\\hypersetup\{", pre)
    if m:
        end = _balanced(pre, m.end() - 1)
        pre = pre[: m.start()] + "% [figures] hypersetup dropped" + pre[end:]
    lines = []
    for line in pre.splitlines():
        if DROP_LINE.search(line.split("%")[0]):
            lines.append("% [figures] dropped: " + line.strip())
        else:
            lines.append(line)
    return "\n".join(lines) + "\n"


# --- chapter-local definitions -----------------------------------------------------------------
LOCAL = re.compile(r"\\(tikzset|tcbset|colorlet|definecolor|newcommand|renewcommand|providecommand|def|raggedright)(?![A-Za-z])")
NGROUPS = {"tikzset": 1, "tcbset": 1, "colorlet": 2, "definecolor": 3, "newcommand": 2,
           "renewcommand": 2, "providecommand": 2, "def": 1, "raggedright": 0}


def _grab(text: str, start: int, name: str) -> int:
    """End index of a definition starting at `start` (the backslash of the macro)."""
    i = start + 1 + len(name)
    need = NGROUPS[name]
    if name == "def":
        m = re.compile(r"\s*\\[A-Za-z@]+[^{]*").match(text, i)
        i = m.end()
    elif name in ("newcommand", "renewcommand", "providecommand"):
        m = re.compile(r"\s*(\\[A-Za-z@]+|\\.)").match(text, i)
        if m and not text[i:].lstrip().startswith("{"):
            i = m.end()
            need -= 1
    got = 0
    while got < need:
        while text[i] in " \t\n*":
            i += 1
        if text[i] == "[":
            i = _balanced(text, i, "[", "]")
            continue
        i = _balanced(text, i)
        got += 1
    if name in ("newcommand", "renewcommand", "providecommand"):
        pass
    return i


GROUPING = re.compile(r"\\begingroup(?![A-Za-z])|\\endgroup(?![A-Za-z])|\\begin\{[^}]*\}|\\end\{[^}]*\}"
                      r"|(?<!\\)\{|(?<!\\)\}")


def chapter_prelude(fig: figsrc.Figure) -> list[str]:
    """Definitions still in effect at the figure: local definitions made in the chapter's files before it,
    minus those made inside a group ({...}, \\begingroup...\\endgroup, an environment) that was closed again."""
    files = []
    chapter_no = -1
    for f in figsrc.included_files():
        tc = "\n".join(l for l in f.read_text().splitlines() if not l.lstrip().startswith("%"))
        if re.search(r"\\chapter\{", tc):
            chapter_no += 1
        if chapter_no == fig.chapter:
            files.append(f)
    stack: list[list[str]] = [[]]
    for f in files:
        text = f.read_text()
        masked = figsrc._mask_comments(text)
        rel = str(f.relative_to(figsrc.BOOK))
        limit = len(masked)
        if rel == fig.file:
            limit = sum(len(l) for l in text.splitlines(keepends=True)[: fig.line - 1])
        i = 0
        while i < limit:
            d = LOCAL.search(masked, i, limit)
            g = GROUPING.search(masked, i, limit)
            if d and (not g or d.start() <= g.start()):
                end = _grab(masked, d.start(), d.group(1))
                stack[-1].append(masked[d.start(): end].strip())
                i = end
                continue
            if not g:
                break
            tok = g.group(0)
            if tok in ("{", "\\begingroup") or tok.startswith("\\begin{"):
                stack.append([])
            elif len(stack) > 1:
                stack.pop()
            i = g.end()
        if rel == fig.file:
            break
    return [d for level in stack for d in level]


def tex_for(fig: figsrc.Figure) -> str:
    prelude = chapter_prelude(fig)
    lines = [
        "% generated by converter/figures/texbuild.py -- do not edit",
        f"% {fig.id}: {fig.file}:{fig.line}-{fig.end_line}",
        "\\documentclass[11pt,border=2pt]{standalone}",
        "\\input{fig-preamble.tex}",
        "\\begin{document}",
    ]
    if prelude:
        lines.append("% chapter-local definitions replayed from the book")
        lines += prelude
    lines += [fig.source, "\\end{document}", ""]
    return "\n".join(lines)


def compile_all(figs, force: bool = False, log=print) -> dict[str, Path]:
    BUILD.mkdir(exist_ok=True)
    pre = figure_preamble()
    pre_path = BUILD / "fig-preamble.tex"
    if not pre_path.exists() or pre_path.read_text() != pre:
        pre_path.write_text(pre)
    pdfs = {}
    for fig in figs:
        tex = tex_for(fig)
        key = hashlib.sha1((pre + tex).encode()).hexdigest()
        texp = BUILD / f"{fig.id}.tex"
        pdf = BUILD / f"{fig.id}.pdf"
        keyp = BUILD / f"{fig.id}.key"
        if not force and pdf.exists() and keyp.exists() and keyp.read_text() == key:
            pdfs[fig.id] = pdf
            continue
        texp.write_text(tex)
        r = subprocess.run([TECTONIC, "--keep-logs", "--outdir", str(BUILD), str(texp)],
                           cwd=BUILD, capture_output=True, text=True)
        if r.returncode != 0 or not pdf.exists():
            log(f"!! {fig.id}: tectonic failed\n{r.stdout[-3000:]}\n{r.stderr[-3000:]}")
            raise SystemExit(1)
        warn = [l for l in r.stderr.splitlines()
                if "warning" in l.lower() and "Overfull" not in l and "/dev/null" not in l]
        if warn:
            log(f"   {fig.id}: " + " | ".join(warn[:3]))
        keyp.write_text(key)
        pdfs[fig.id] = pdf
        log(f"   compiled {fig.id}")
    return pdfs


if __name__ == "__main__":
    import sys
    figs = figsrc.figures()
    if len(sys.argv) > 1:
        figs = [f for f in figs if f.id in sys.argv[1:]]
    compile_all(figs)
