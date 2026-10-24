"""A hand-written parser for the LaTeX subset used by the book.

It follows TeX's reading rules where they matter for the text:
  * state N/M/S for spaces: spaces after a control word are skipped, one newline is a space,
    a blank line is a paragraph break, leading spaces of a line are ignored;
  * "%" starts a comment that also swallows the end of line (and the next line's indentation);
  * optional-argument look-ahead skips spaces (like \\@ifnextchar).

Code listing environments (tcblisting) are read verbatim; tikzpicture is kept as raw source.
Unknown macros and environments are hard errors (see macros.py).
"""
from __future__ import annotations

import re

from .macros import ENVS, MACROS, RAW_ENVS, VERBATIM_ENVS
from .nodes import (Arg, Cmd, ConvertError, Env, Group, Math, Par, Source, Space, Special, Text)

SPECIAL_CHARS = set("\\{}$&~%#^_")
WS = " \t"


def mask_comments(text: str) -> str:
    """Blank every comment (from an unescaped % to the end of line), keeping offsets."""
    out = []
    for line in text.splitlines(keepends=True):
        m = re.search(r"(?<!\\)%", line)
        if m:
            nl = "\n" if line.endswith("\n") else ""
            line = line[:m.start()] + " " * (len(line) - m.start() - len(nl)) + nl
        out.append(line)
    return "".join(out)


class Parser:
    def __init__(self, src: Source, start: int = 0, end: int | None = None, state: str = "N",
                 math: bool = False, depth: int = 0):
        self.src = src
        self.t = src.text
        self.pos = start
        self.end = len(self.t) if end is None else end
        self.state = state
        self.math = math
        self.depth = depth
        if depth > 60:
            self.error(start, "nesting too deep")

    # ------------------------------------------------------------------ helpers
    def error(self, pos: int, msg: str) -> None:
        raise ConvertError(f"{self.src.where(pos)}: {msg}")

    def peek(self, off: int = 0) -> str:
        p = self.pos + off
        return self.t[p] if p < self.end else ""

    def skip_comment(self, p: int) -> int:
        """p is at '%': return the offset after the end of line and the next line's indentation."""
        nl = self.t.find("\n", p, self.end)
        if nl < 0:
            return self.end
        p = nl + 1
        while p < self.end and self.t[p] in WS:
            p += 1
        return p

    def skip_ws_for_arg(self, p: int, allow_blank_line: bool = False) -> int:
        """Skip spaces, single newlines and comments (TeX skips them before arguments).
        Stops before a blank line (a \\par token)."""
        while p < self.end:
            c = self.t[p]
            if c in WS:
                p += 1
            elif c == "\n":
                q = p + 1
                while q < self.end and self.t[q] in WS:
                    q += 1
                if not allow_blank_line and (q >= self.end or self.t[q] == "\n"):
                    return p
                p = q
            elif c == "%":
                p = self.skip_comment(p)
            else:
                return p
        return p

    def match_close(self, p: int, open_ch: str, close_ch: str) -> int:
        """p is at open_ch. Return the offset of the matching close_ch (braces balanced, escapes and
        comments skipped). For '[', the closing ']' must be at brace depth 0."""
        assert self.t[p] == open_ch
        depth = 0
        q = p + 1
        while q < self.end:
            c = self.t[q]
            if c == "\\":
                q += 2
                continue
            if c == "%":
                q = self.skip_comment(q)
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                if depth == 0:
                    if close_ch == "}":
                        return q
                    self.error(p, f"unbalanced braces inside {open_ch}...{close_ch}")
                depth -= 1
            elif c == close_ch and depth == 0 and close_ch != "}":
                return q
            q += 1
        self.error(p, f"no matching {close_ch!r}")
        return -1

    def sub(self, start: int, end: int, state: str = "M") -> list:
        return Parser(self.src, start, end, state=state, math=self.math, depth=self.depth + 1).parse_seq()

    # ------------------------------------------------------------------ arguments
    def read_args(self, sig: str, name: str, cmd_pos: int) -> tuple[bool, list[Arg]]:
        star = False
        args: list[Arg] = []
        for kind in sig:
            if kind == "s":
                if self.peek() == "*":
                    star = True
                    self.pos += 1
                continue
            if kind in "oO":
                q = self.skip_ws_for_arg(self.pos)
                if q < self.end and self.t[q] == "[":
                    close = self.match_close(q, "[", "]")
                    raw = self.t[q + 1:close]
                    nodes = self.sub(q + 1, close) if kind == "O" else None
                    args.append(Arg("o", nodes, raw, q + 1))
                    self.pos = close + 1
                    self.state = "M"
                else:
                    # like \@ifnextchar: the spaces looked at are gobbled
                    self.pos = q
                    args.append(Arg("o", None, "", q, present=False))
                continue
            if kind in "mr":
                q = self.skip_ws_for_arg(self.pos)
                if q >= self.end or self.t[q] != "{":
                    self.error(cmd_pos, f"\\{name}: expected '{{' for a mandatory argument")
                close = self.match_close(q, "{", "}")
                raw = self.t[q + 1:close]
                nodes = self.sub(q + 1, close) if kind == "m" else None
                args.append(Arg("m", nodes, raw, q + 1))
                self.pos = close + 1
                self.state = "M"
                continue
            raise AssertionError(kind)
        return star, args

    # ------------------------------------------------------------------ main loop
    def parse_seq(self, end_env: str | None = None, end_env_pos: int = 0) -> list:
        out: list = []
        buf: list[str] = []
        buf_start = self.pos

        def flush():
            nonlocal buf
            if buf:
                out.append(Text(self.src, buf_start, self.pos, "".join(buf)))
                buf = []

        while self.pos < self.end:
            c = self.t[self.pos]
            if c not in SPECIAL_CHARS and c not in " \t\n":
                if not buf:
                    buf_start = self.pos
                buf.append(c)
                self.pos += 1
                self.state = "M"
                continue
            flush()
            p = self.pos
            if c in WS:
                self.pos += 1
                if self.state == "M":
                    out.append(Space(self.src, p, self.pos))
                    self.state = "S"
                continue
            if c == "\n":
                self.pos += 1
                if self.state == "N":
                    out.append(Par(self.src, p, self.pos))
                elif self.state == "M":
                    out.append(Space(self.src, p, self.pos))
                self.state = "N"
                while self.pos < self.end and self.t[self.pos] in WS:
                    self.pos += 1
                continue
            if c == "%":
                self.pos = self.skip_comment(p)
                self.state = "N"
                continue
            if c == "{":
                close = self.match_close(p, "{", "}")
                out.append(Group(self.src, p, close + 1, self.sub(p + 1, close)))
                self.pos = close + 1
                self.state = "M"
                continue
            if c == "}":
                self.error(p, "unexpected '}'")
            if c == "$":
                if self.math:
                    self.error(p, "nested $")
                close = self.t.find("$", p + 1, self.end)
                while close > 0 and self.t[close - 1] == "\\":
                    close = self.t.find("$", close + 1, self.end)
                if close < 0:
                    self.error(p, "unterminated $")
                children = Parser(self.src, p + 1, close, state="M", math=True, depth=self.depth + 1).parse_seq()
                out.append(Math(self.src, p, close + 1, children))
                self.pos = close + 1
                self.state = "M"
                continue
            if c in "&~":
                out.append(Special(self.src, p, p + 1, c))
                self.pos += 1
                self.state = "M"
                continue
            if c in "#^_":
                self.error(p, f"unescaped {c!r} outside a verbatim environment")
            # c == "\\": a command
            node = self.parse_command(end_env)
            if node == "END":
                return out
            if node is not None:
                out.append(node)
        flush()
        if end_env is not None:
            self.error(end_env_pos, f"\\begin{{{end_env}}} is never closed")
        return out

    def parse_command(self, end_env: str | None):
        p = self.pos
        q = p + 1
        if q >= self.end:
            self.error(p, "backslash at end of input")
        if self.t[q].isalpha():
            while q < self.end and self.t[q].isalpha():
                q += 1
            name = self.t[p + 1:q]
            self.pos = q
            self.state = "S"
            # TeX skips spaces after a control word (one newline included)
            while self.pos < self.end and self.t[self.pos] in WS:
                self.pos += 1
            if self.pos < self.end and self.t[self.pos] == "\n":
                # a newline in state S is dropped; the next line starts in state N
                self.pos += 1
                self.state = "N"
                while self.pos < self.end and self.t[self.pos] in WS:
                    self.pos += 1
            if name in ("begin", "end"):
                return self.parse_env_marker(name, p, end_env)
        else:
            name = self.t[q]
            self.pos = q + 1
            self.state = "S" if name == " " else "M"
            if name == "\n":
                self.error(p, "backslash at end of line")
        if name not in MACROS:
            self.error(p, f"unknown macro \\{name}")
        sig, _cat = MACROS[name]
        # the star must follow the name directly (\section*)
        star, args = self.read_args(sig, name, p)
        return Cmd(self.src, p, self.pos, name, star, args)

    def parse_env_marker(self, which: str, p: int, end_env: str | None):
        q = self.skip_ws_for_arg(self.pos)
        if q >= self.end or self.t[q] != "{":
            self.error(p, f"\\{which} without {{name}}")
        close = self.match_close(q, "{", "}")
        name = self.t[q + 1:close]
        self.pos = close + 1
        self.state = "M"
        if which == "end":
            if name != end_env:
                self.error(p, f"\\end{{{name}}} does not match \\begin{{{end_env}}}")
            return "END"
        if name not in ENVS:
            self.error(p, f"unknown environment {name!r}")
        if name in VERBATIM_ENVS:
            return self.parse_verbatim(name, p)
        if name in RAW_ENVS:
            return self.parse_raw_env(name, p)
        star, args = self.read_args(ENVS[name], name, p)
        children = self.parse_seq(end_env=name, end_env_pos=p)
        return Env(self.src, p, self.pos, name, args, children)

    def parse_verbatim(self, name: str, p: int) -> Env:
        args: list[Arg] = []
        q = self.pos
        while q < self.end and self.t[q] in WS:
            q += 1
        if q < self.end and self.t[q] == "[":
            close = self.match_close(q, "[", "]")
            args.append(Arg("o", None, self.t[q + 1:close], q + 1))
            q = close + 1
        else:
            args.append(Arg("o", None, "", q, present=False))
        while q < self.end and self.t[q] in WS:
            q += 1
        if q >= self.end or self.t[q] != "\n":
            self.error(p, f"\\begin{{{name}}}: text after the options on the same line")
        body_start = q + 1
        end_marker = "\\end{" + name + "}"
        e = self.t.find(end_marker, body_start, self.end)
        if e < 0:
            self.error(p, f"\\begin{{{name}}} is never closed")
        line_start = self.t.rfind("\n", body_start - 1, e) + 1
        if self.t[line_start:e].strip():
            self.error(e, f"\\end{{{name}}} must start its own line")
        body = self.t[body_start:line_start]
        if body.endswith("\n"):
            body = body[:-1]
        self.pos = e + len(end_marker)
        self.state = "M"
        return Env(self.src, p, self.pos, name, args, [], body=body, body_pos=body_start)

    def parse_raw_env(self, name: str, p: int) -> Env:
        masked = mask_comments(self.t[:self.end])
        end_marker = "\\end{" + name + "}"
        e = masked.find(end_marker, self.pos)
        if e < 0:
            self.error(p, f"\\begin{{{name}}} is never closed")
        self.pos = e + len(end_marker)
        self.state = "M"
        return Env(self.src, p, self.pos, name, [], [], body=self.t[p:self.pos], body_pos=p)


def parse_source(src: Source) -> list:
    return Parser(src).parse_seq()


def parse_string(text: str, path: str = "<string>") -> list:
    return parse_source(Source(path, text))
