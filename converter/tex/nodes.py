"""Node types produced by the LaTeX parser.

Every node keeps its source file and character offsets so that errors can be reported as
file:line and raw source spans (tikz pictures, question keys) can be recovered exactly.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field


class ConvertError(Exception):
    """Hard error: the converter refuses to guess. The message always names file:line."""


@dataclass(eq=False)
class Source:
    path: str   # path relative to the book root, e.g. "parts/part2/ch07-models-sources-dag.tex"
    text: str
    _starts: list[int] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        self._starts = [0]
        for i, ch in enumerate(self.text):
            if ch == "\n":
                self._starts.append(i + 1)

    def line(self, pos: int) -> int:
        return bisect_right(self._starts, pos)

    def where(self, pos: int) -> str:
        return f"{self.path}:{self.line(pos)}"


@dataclass(eq=False)
class Node:
    src: Source
    pos: int
    end: int

    def where(self) -> str:
        return self.src.where(self.pos)

    def raw(self) -> str:
        return self.src.text[self.pos:self.end]


@dataclass(eq=False)
class Text(Node):
    s: str = ""


@dataclass(eq=False)
class Space(Node):
    pass


@dataclass(eq=False)
class Par(Node):
    """Paragraph break: a blank line (or two consecutive newlines) in the source."""


@dataclass(eq=False)
class Special(Node):
    ch: str = ""          # "&" (column separator) or "~" (no-break space)


@dataclass(eq=False)
class Arg:
    kind: str             # "o" optional [..] / "m" mandatory {..}
    nodes: list | None    # parsed content (None when raw)
    raw: str              # raw source text between the delimiters
    pos: int              # offset of the first character inside the delimiters
    present: bool = True


@dataclass(eq=False)
class Cmd(Node):
    name: str = ""
    star: bool = False
    args: list[Arg] = field(default_factory=list)

    def arg(self, i: int) -> Arg:
        return self.args[i]


@dataclass(eq=False)
class Group(Node):
    children: list = field(default_factory=list)


@dataclass(eq=False)
class Math(Node):
    children: list = field(default_factory=list)


@dataclass(eq=False)
class Env(Node):
    name: str = ""
    args: list[Arg] = field(default_factory=list)
    children: list = field(default_factory=list)
    body: str | None = None        # verbatim body (code listings) or raw source (tikzpicture)
    body_pos: int = 0              # offset of the verbatim body in the source


def walk(nodes):
    """Yield every node depth-first (children and parsed arguments included)."""
    for n in nodes:
        yield n
        if isinstance(n, (Group, Math)):
            yield from walk(n.children)
        elif isinstance(n, Env):
            for a in n.args:
                if a.nodes:
                    yield from walk(a.nodes)
            yield from walk(n.children)
        elif isinstance(n, Cmd):
            for a in n.args:
                if a.nodes:
                    yield from walk(a.nodes)
