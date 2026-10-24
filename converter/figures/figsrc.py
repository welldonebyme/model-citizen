"""Locate every TikZ figure of the book, with the same chapter numbering and counting rules as
tools/inventory.py (files in \\input order from main.tex, a chapter starts at a file with \\chapter,
lines whose first non-blank character is % are ignored, the title page in main.tex is not counted).

    figure id = chNN-figK   (NN = chapter number, K = 1-based order of \\begin{tikzpicture} in the chapter)
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
ACADEMY = HERE.parent.parent
BOOK = ACADEMY.parent / "dbt-bible"
MAIN = BOOK / "main.tex"


def included_files() -> list[Path]:
    seen: list[Path] = []

    def walk(path: Path) -> None:
        for line in path.read_text().splitlines():
            line = line.split("%")[0]
            for name in re.findall(r"\\input\{([^}]*)\}", line):
                p = BOOK / (name if name.endswith(".tex") else name + ".tex")
                if p.exists() and p not in seen and p.name != "preamble.tex":
                    seen.append(p)
                    walk(p)

    walk(MAIN)
    return seen


@dataclass
class Figure:
    id: str
    chapter: int
    k: int
    file: str          # path relative to the book root
    line: int          # 1-based line of \begin{tikzpicture}
    end_line: int      # 1-based line of \end{tikzpicture}
    source: str        # exact text from \begin{tikzpicture} to \end{tikzpicture} inclusive
    sha1: str
    context: list[str] = field(default_factory=list)  # enclosing environments (outermost first)
    override: str | None = None        # site source used instead of the book's (overrides/<id>.tex), if any
    override_sha1: str | None = None   # SHA-1 of that site source


BEGIN = re.compile(r"\\begin\{tikzpicture\}")
END = re.compile(r"\\end\{tikzpicture\}")
ENV = re.compile(r"\\(begin|end)\{([A-Za-z*]+)\}")


def _mask_comments(text: str) -> str:
    """Blank out comment lines (inventory rule) and trailing % comments, keeping offsets."""
    out = []
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("%"):
            out.append(re.sub(r"[^\n]", " ", line))
            continue
        m = re.search(r"(?<!\\)%", line)
        if m:
            line = line[: m.start()] + re.sub(r"[^\n]", " ", line[m.start():])
        out.append(line)
    return "".join(out)


def _enclosing_envs(masked: str, pos: int) -> list[str]:
    stack: list[str] = []
    for m in ENV.finditer(masked, 0, pos):
        kind, name = m.groups()
        if kind == "begin":
            stack.append(name)
        elif stack and stack[-1] == name:
            stack.pop()
        elif name in stack:
            while stack and stack.pop() != name:
                pass
    return stack


def figures() -> list[Figure]:
    figs: list[Figure] = []
    chapter_no = -1
    k = 0
    in_chapter = False
    for f in included_files():
        text = f.read_text()
        tc = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("%"))
        if re.search(r"\\chapter\{([^}]*)\}", tc):
            chapter_no += 1
            k = 0
            in_chapter = True
        if not in_chapter:
            continue
        masked = _mask_comments(text)
        pos = 0
        while True:
            b = BEGIN.search(masked, pos)
            if not b:
                break
            e = END.search(masked, b.end())
            if not e:
                raise SystemExit(f"unterminated tikzpicture in {f}:{text.count(chr(10), 0, b.start()) + 1}")
            k += 1
            src = text[b.start(): e.end()]
            rel = str(f.relative_to(BOOK))
            figs.append(Figure(
                id=f"ch{chapter_no:02d}-fig{k}", chapter=chapter_no, k=k, file=rel,
                line=text.count("\n", 0, b.start()) + 1, end_line=text.count("\n", 0, e.end()) + 1,
                source=src, sha1=hashlib.sha1(src.encode("utf-8")).hexdigest(),
                context=_enclosing_envs(masked, b.start()),
            ))
            pos = e.end()
    apply_overrides(figs)
    return figs


OVERRIDES_DIR = HERE / "overrides"
BOOK_SHA1 = re.compile(r"^% book-sha1: ([0-9a-f]{40})\s*$", re.M)


def apply_overrides(figs: list[Figure]) -> None:
    """overrides/<id>.tex = a site-specific TikZ source (e.g. ch02-fig1: the kit's folders instead of the
    author's). Used only while the book figure still has the `% book-sha1:` written in the file; `sha1` stays
    the book's (alt texts and the converter check it against the book)."""
    by_id = {f.id: f for f in figs}
    for p in sorted(OVERRIDES_DIR.glob("*.tex")):
        f = by_id.get(p.stem)
        if f is None:
            raise SystemExit(f"{p}: no figure {p.stem} in the book")
        text = p.read_text()
        m = BOOK_SHA1.search(text)
        if not m:
            raise SystemExit(f"{p}: missing '% book-sha1: <sha1 of the book figure>' line")
        if m.group(1) != f.sha1:
            raise SystemExit(f"{p}: the book figure changed (sha1 {f.sha1} != {m.group(1)}): update the site "
                             f"version from {f.file}:{f.line}, then its book-sha1 line")
        b = BEGIN.search(text)
        e = END.search(text, b.end()) if b else None
        if not b or not e:
            raise SystemExit(f"{p}: no tikzpicture")
        f.source = text[b.start(): e.end()]
        f.override = str(p.relative_to(ACADEMY))
        f.override_sha1 = hashlib.sha1(f.source.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    import sys
    figs = figures()
    for fg in figs:
        print(f"{fg.id:12s} {fg.file}:{fg.line}-{fg.end_line} {fg.sha1[:10]} ctx={'/'.join(fg.context)}"
              + (f" override={fg.override}" if fg.override else ""))
    print(len(figs), "figures", file=sys.stderr)
