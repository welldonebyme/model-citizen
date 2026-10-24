"""Windows (PowerShell) and WSL variants of the book's shell blocks, from converter/overrides/os-commands.yaml.

    variants(text, ctx) -> {"win": str, "wsl": str} (only the OSes whose text differs) + a log

Every command line (`$ ...` or `(.venv) $ ...`) is translated; output lines are kept as they are.
- the prompt becomes `PS> ` / `(.venv) PS> ` (Windows); WSL keeps `$ `
- `a && b` becomes two lines (Windows PowerShell 5.1 has no &&), `a; b` stays on one line
- each simple command goes through the `transforms` of os-commands.yaml (regex -> PowerShell template, or a named
  function of this module for the few that need logic: env-var prefixes, grep options, sed ranges, echo, source)
- programs that are the same on every OS (dbt, git, uv, python, duckdb without `<`, gh, code, jq) keep their text;
  only what PowerShell would read differently is changed: `~/` paths -> `$HOME\\...`, `$VAR` -> `$env:VAR`, and
  unquoted arguments with `, @ { } ( )` get double quotes (PowerShell would split or evaluate them)
- `cmd > file` / `cmd >> file` -> `cmd | Set-Content file` / `Add-Content` (no UTF-16 files in Windows PowerShell 5.1),
  `prog < file.sql` -> `prog -c ".read file.sql"` (duckdb; PowerShell has no `<`)
A command with no rule that is not OS-neutral is reported (`unhandled`); the variant then keeps the book's text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

PROMPT = re.compile(r"^(\(\.venv\) )?\$ (.*)$")
ENV_PREFIX = re.compile(r"(?P<assigns>(?:[A-Za-z_][A-Za-z0-9_]*=(?:\"[^\"]*\"|'[^']*'|\S*)\s+)+)(?P<rest>\S.*)")
NEUTRAL = {"dbt", "git", "uv", "python", "duckdb", "gh", "code", "jq", "deactivate", "pwd"}
PS_SPECIAL = re.compile(r"[,@{}()]")      # unquoted, PowerShell would split / splat / evaluate these
KEEP_DOLLAR = {"HOME", "PWD", "true", "false", "null"}


# ---------------------------------------------------------------------------------------------- shell parsing
def split_comment(cmd: str) -> tuple[str, str]:
    """('dbt run', '# comment') -- a # outside quotes that starts a word."""
    q = None
    i = 0
    while i < len(cmd):
        c = cmd[i]
        if q:
            if c == q:
                q = None
            elif c == "\\" and q == '"':
                i += 1
        elif c in "'\"":
            q = c
        elif c == "\\":
            i += 1
        elif c == "#" and (i == 0 or cmd[i - 1] in " \t"):
            return cmd[:i].rstrip(), cmd[i:]
        i += 1
    return cmd, ""


def split_ops(cmd: str) -> list[tuple[str, str | None]]:
    """[(text, operator after it)] for && || ; | outside quotes."""
    out, buf, q, i = [], "", None, 0
    while i < len(cmd):
        c = cmd[i]
        if q:
            buf += c
            if c == q:
                q = None
            elif c == "\\" and q == '"' and i + 1 < len(cmd):
                buf += cmd[i + 1]
                i += 1
            i += 1
            continue
        if c in "'\"":
            q = c
            buf += c
            i += 1
            continue
        if c == "\\" and i + 1 < len(cmd):
            buf += cmd[i:i + 2]
            i += 2
            continue
        two = cmd[i:i + 2]
        if two in ("&&", "||"):
            out.append((buf.strip(), two))
            buf = ""
            i += 2
            continue
        if c in ";|":
            out.append((buf.strip(), c))
            buf = ""
            i += 1
            continue
        buf += c
        i += 1
    out.append((buf.strip(), None))
    return out


def words(seg: str) -> list[str]:
    """Raw words (quotes kept) of a simple command."""
    out, buf, q = [], "", None
    i = 0
    while i < len(seg):
        c = seg[i]
        if q:
            buf += c
            if c == q:
                q = None
            elif c == "\\" and q == '"' and i + 1 < len(seg):
                buf += seg[i + 1]
                i += 1
        elif c in "'\"":
            q = c
            buf += c
        elif c in " \t":
            if buf:
                out.append(buf)
                buf = ""
        else:
            buf += c
        i += 1
    if buf:
        out.append(buf)
    return out


def balanced(cmd: str) -> bool:
    q = None
    i = 0
    while i < len(cmd):
        c = cmd[i]
        if q:
            if c == q:
                q = None
            elif c == "\\" and q == '"':
                i += 1
        elif c in "'\"":
            q = c
        elif c == "\\":
            i += 1
        i += 1
    return q is None


# ---------------------------------------------------------------------------------------------- PowerShell forms
def winpath(p: str) -> str:
    if not p or "://" in p:
        return p
    quote = ""
    if p[0] in "'\"" and p[-1] == p[0]:
        quote, p = p[0], p[1:-1]
    if p == "~":
        p = "$HOME"
    elif p.startswith("~/"):
        p = "$HOME/" + p[2:]
    p = p.replace("/", "\\")
    if quote == "'" and "$" in p:
        quote = '"'
    return f"{quote}{p}{quote}"


def ps_vars(s: str, ctx: "Ctx") -> str:
    """$? -> $LASTEXITCODE, $NAME -> $env:NAME unless NAME is a shell variable of the chapter or $HOME/$PWD."""
    s = s.replace("$?", "$LASTEXITCODE")

    def rep(m):
        name = m.group(1)
        if name in KEEP_DOLLAR or name in ctx.shell_vars or name == "LASTEXITCODE":
            return m.group(0)
        return "$env:" + name
    return re.sub(r"\$(?!env:)([A-Za-z_][A-Za-z0-9_]*)", rep, s)


def ps_arg(w: str, ctx: "Ctx") -> str:
    """One argument of a program for PowerShell (same meaning as in zsh)."""
    if w[0] == "'" and w[-1] == "'":
        return w                                   # literal in both shells
    if w[0] == '"' and w[-1] == '"':
        inner = w[1:-1].replace('\\"', '`"')
        return '"' + ps_vars(inner, ctx) + '"'
    if w.startswith("~/") or w == "~":
        return winpath(w)
    if "$" in w:
        w = ps_vars(w, ctx)
        if PS_SPECIAL.search(w):
            return f'"{w}"'
        return w
    if PS_SPECIAL.search(w) or w.startswith("#"):
        return f'"{w}"'
    return w


def ps_program(seg: str, ctx: "Ctx") -> str:
    ws = words(seg)
    first = ws[0]
    if first == "python3":
        first = "python"
    return " ".join([first] + [ps_arg(w, ctx) for w in ws[1:]])


@dataclass
class Ctx:
    shell_vars: set = field(default_factory=set)
    rules: list = field(default_factory=list)
    unhandled: list = field(default_factory=list)


# ---------------------------------------------------------------------------------------------- engine
class OsCommands:
    def __init__(self, path: Path):
        data = yaml.safe_load(path.read_text())
        self.data = data
        self.transforms = []
        for t in data.get("transforms", []):
            self.transforms.append({**t, "rx": re.compile(t["match"])})
        self.pipes = [{**t, "rx": re.compile(t["match"])} for t in data.get("pipe_transforms", [])]
        self.lines = {(l["block"], l["book"]): l for l in data.get("lines", [])}
        self.wsl = [{**t, "rx": re.compile(t["match"])} for t in data.get("wsl_transforms", [])]
        self.blocks = {b["block"]: b for b in data.get("blocks", [])}

    # ------------------------------------------------------------------ one simple command
    def fill(self, tpl: str, m: re.Match, ctx: Ctx) -> str:
        def rep(mm):
            kind, _, name = mm.group(1).rpartition(":")
            v = m.group(name) or ""
            if kind == "path":
                return ps_vars(winpath(v), ctx)
            if kind == "paths":
                return ", ".join(ps_vars(winpath(x), ctx) for x in words(v))
            if kind == "args":
                return " ".join(ps_arg(x, ctx) for x in words(v))
            if kind == "vars":
                return ps_vars(v, ctx)
            if kind == "cmd":
                return self.command(v, ctx)
            if kind == "minus1":
                return str(int(v) - 1)
            return v
        return re.sub(r"\{\{((?:[a-z0-9]+:)?[a-z_0-9]+)\}\}", rep, tpl)

    def fn(self, name: str, m: re.Match, seg: str, ctx: Ctx) -> str:
        return getattr(self, f"fn_{name}")(m, seg, ctx)

    def command(self, seg: str, ctx: Ctx) -> str:
        """A simple command (may contain an env prefix or a redirection)."""
        seg = seg.strip()
        if not seg:
            return seg
        for t in self.transforms:
            m = t["rx"].fullmatch(seg)
            if m:
                ctx.rules.append(t["rule"])
                if "fn" in t:
                    return self.fn(t["fn"], m, seg, ctx)
                return self.fill(t["win"], m, ctx)
        # redirections outside quotes
        red = self.redirection(seg)
        if red:
            return red(ctx)
        first = words(seg)[0]
        if first in NEUTRAL or first == "python3":
            out = ps_program(seg, ctx)
            if out != seg:
                ctx.rules.append("ps-quoting")
            return out
        ctx.unhandled.append(seg)
        return seg

    def redirection(self, seg: str):
        ws = words(seg)
        for i, w in enumerate(ws):
            if w in (">", ">>", "<") and i == len(ws) - 2:
                target = ws[-1]
                left = " ".join(ws[:i])
                if w == "<":
                    if ws[0] == "duckdb":
                        def f(ctx, left=left, target=target):
                            ctx.rules.append("duckdb-redirect")
                            return f'{ps_program(left, ctx)} -c ".read {target}"'
                        return f
                    return None
                op = "Set-Content" if w == ">" else "Add-Content"
                if ws[0] == "echo":
                    def f(ctx, op=op, target=target, parts=ws[1:i]):
                        ctx.rules.append("echo-redirect")
                        text = " ".join(parts)
                        value = ps_arg(text, ctx) if len(parts) == 1 and parts[0][:1] in ("'", '"') else repr_ps(text)
                        return f"{op} {ps_vars(winpath(target), ctx)} {value}"
                    return f

                def f(ctx, op=op, target=target, left=left):
                    ctx.rules.append("echo-redirect")
                    return f"{self.command(left, ctx)} | {op} {winpath(target)}"
                return f
        return None

    def pipe(self, stage: str, ctx: Ctx) -> str:
        for t in self.pipes:
            m = t["rx"].fullmatch(stage.strip())
            if m:
                ctx.rules.append(t["rule"])
                if "fn" in t:
                    return self.fn(t["fn"], m, stage, ctx)
                return self.fill(t["win"], m, ctx)
        first = words(stage)[0]
        if first in NEUTRAL or first == "python3":
            return ps_program(stage, ctx)
        ctx.unhandled.append("| " + stage)
        return stage

    # ------------------------------------------------------------------ named transforms
    def fn_env_prefix(self, m, seg, ctx):
        assigns = re.findall(r"([A-Za-z_][A-Za-z0-9_]*)=(\"[^\"]*\"|'[^']*'|\S*)\s+", m.group("assigns"))
        sets = "; ".join(f"$env:{n} = {ps_value(v)}" for n, v in assigns)
        rest = self.command(m.group("rest"), ctx)
        rm = ", ".join(f"Env:{n}" for n, _ in assigns)
        return f"{sets}; {rest}; Remove-Item {rm}"

    def fn_assign(self, m, seg, ctx):
        ctx.shell_vars.add(m.group("name"))
        return f"${m.group('name')} = {ps_value(m.group('value'))}"

    def fn_export(self, m, seg, ctx):
        assigns = re.findall(r"([A-Za-z_][A-Za-z0-9_]*)=(\"[^\"]*\"|'[^']*'|\S*)", m.group("assigns"))
        return "; ".join(f"$env:{n} = {ps_value(v, ctx)}" for n, v in assigns)

    def fn_echo(self, m, seg, ctx):
        text = m.group("text")
        return "echo " + " ".join(ps_arg(w, ctx) for w in words(text))

    def fn_source(self, m, seg, ctx):
        p = winpath(m.group("venv"))
        act = f"{p}\\Scripts\\Activate.ps1"
        return f"& {act}" if act.startswith("$") else act

    def fn_grep(self, m, seg, ctx):
        opts = m.group("opts").split()
        pat = m.group("pat")
        files = m.group("files")
        return grep_ps(opts, pat, files)

    def fn_grep_pipe(self, m, seg, ctx):
        return grep_ps(m.group("opts").split(), m.group("pat"), None)

    def fn_sed(self, m, seg, ctx):
        a, b = int(m.group("a")), int(m.group("b"))
        sel = f"Select-Object -First {b}" if a == 1 else f"Select-Object -Skip {a - 1} -First {b - a + 1}"
        f = m.groupdict().get("file")
        return f"Get-Content {winpath(f)} | {sel}" if f else sel

    # ------------------------------------------------------------------ lines and blocks
    def line(self, cmd: str, block: str, ctx: Ctx) -> list[str]:
        """PowerShell command(s) for one book command line (without the prompt)."""
        ov = self.lines.get((block, cmd))
        if ov:
            ctx.rules.append(ov.get("rule", "line-override"))
            return ov["win"].split("\n")
        body, comment = split_comment(cmd)
        parts = split_ops(body)
        out_lines: list[str] = []
        cur = ""
        i = 0
        while i < len(parts):
            text, op = parts[i]
            env = ENV_PREFIX.fullmatch(text) if op == "|" else None
            if env:                                  # VAR=x prog | filter: the variable lives for the pipeline
                text = env.group("rest")
                ctx.rules.append("env-prefix")
            stage = self.command(text, ctx) if text else ""
            # pipelines: text | next | next ...
            while op == "|":
                i += 1
                nxt, op = parts[i]
                stage = f"{stage} | {self.pipe(nxt, ctx)}"
            if env:
                assigns = re.findall(r"([A-Za-z_][A-Za-z0-9_]*)=(\"[^\"]*\"|'[^']*'|\S*)\s+", env.group("assigns"))
                sets = "; ".join(f"$env:{n} = {ps_value(v)}" for n, v in assigns)
                stage = f"{sets}; {stage}; Remove-Item {', '.join(f'Env:{n}' for n, _ in assigns)}"
            cur = f"{cur}; {stage}" if cur else stage
            if op == "&&" or op == "||":
                if op == "||":
                    ctx.unhandled.append(cmd)
                out_lines.append(cur)
                cur = ""
            i += 1
        if cur or not out_lines:
            out_lines.append(cur)
        if comment:
            gap = re.search(r"(\s*)#", cmd[len(body):] if cmd.startswith(body) else " #").group(1) or " "
            out_lines[-1] = (out_lines[-1] + gap + comment) if out_lines[-1] else comment
        if len(out_lines) > 1:
            ctx.rules.append("and-chain")
        return out_lines

    def wsl_line(self, cmd: str) -> str | None:
        for t in self.wsl:
            m = t["rx"].fullmatch(cmd.strip())
            if m:
                return t["wsl"]
        return None

    def block(self, text: str, block_id: str, ctx: Ctx) -> tuple[str | None, str | None, dict]:
        ov = self.blocks.get(block_id)
        if ov:
            import hashlib
            digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
            if digest != ov["sha1"]:
                raise ValueError(f"os-commands.yaml blocks: {block_id} changed in the book (sha1 {digest} != "
                                 f"{ov['sha1']}): re-check its Windows text")
            return ov["win"], ov.get("wsl"), {"rules": [ov["rule"], "block-override"], "unhandled": []}
        lines = text.split("\n")
        win, wsl = [], []
        changed_win = changed_wsl = False
        rules_before = len(ctx.rules)
        unhandled_before = len(ctx.unhandled)
        i = 0
        while i < len(lines):
            l = lines[i]
            m = PROMPT.match(l)
            if not m:
                win.append(l)
                wsl.append(l)
                i += 1
                continue
            venv, cmd = m.group(1) or "", m.group(2)
            raw = [l]
            # continuation lines: trailing backslash, or an unclosed quote
            while (cmd.endswith("\\") or not balanced(cmd)) and i + 1 < len(lines):
                i += 1
                raw.append(lines[i])
                if cmd.endswith("\\"):
                    nxt = lines[i]
                    cmd = cmd[:-1] + nxt if not cmd[:-1].endswith(" ") else cmd[:-1] + nxt.lstrip()
                else:
                    cmd = cmd + "\n" + lines[i]
            ps = self.line(cmd, block_id, ctx)
            prompt = f"{venv}PS> " if venv else "PS> "
            new = [prompt + p for p in ps]
            # a variant only when a COMMAND differs (the prompt alone does not count)
            if ps != [cmd] or len(raw) > 1:
                changed_win = True
            win.extend(new)
            w = self.wsl_line(cmd)
            if w is not None:
                changed_wsl = True
                wsl.extend(f"{venv}$ {x}" for x in w.split("\n"))
                ctx.rules.append("wsl")
            else:
                wsl.extend(raw)
            i += 1
        log = {"rules": sorted(set(ctx.rules[rules_before:])), "unhandled": ctx.unhandled[unhandled_before:]}
        return ("\n".join(win) if changed_win else None), ("\n".join(wsl) if changed_wsl else None), log


def ps_value(v: str, ctx: Ctx | None = None) -> str:
    """A value for `$x = ...`: a double-quoted PowerShell string (paths in Windows form)."""
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        q, v = v[0], v[1:-1]
        if q == "'":
            return "'" + v + "'"
    if v.startswith("~/") or v == "~" or v.startswith("$PWD/") or v.startswith("$HOME/"):
        v = winpath(v)
    if ctx is not None:
        v = ps_vars(v, ctx)
    return f'"{v}"'


def repr_ps(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def grep_ps(opts: list[str], pat: str, files: str | None) -> str:
    flags = set()
    ctx_ab = None
    for o in opts:
        if o.startswith("-") and not o.startswith("--"):
            body = o[1:]
            if re.fullmatch(r"[A-Z]\d+", body):
                flags.add(body)
                continue
            if body.startswith("m") and body[1:].isdigit():
                flags.add(body)
                continue
            for ch in body:
                flags.add(ch)
    cs = "" if "i" in flags else " -CaseSensitive"
    nm = " -NotMatch" if "v" in flags else ""
    am = " -AllMatches" if "o" in flags else ""
    b = next((int(f[1:]) for f in flags if f.startswith("B") and f[1:].isdigit()), None)
    a = next((int(f[1:]) for f in flags if f.startswith("A") and f[1:].isdigit()), None)
    if a is not None or b is not None:
        ctx_ab = f" -Context {b or 0},{a or 0}"
    src = f" {', '.join(winpath(x) for x in words(files))}" if files else ""
    p = pat
    if "E" not in flags:
        p = p.replace("\\|", "|")           # basic regex alternation (grep 'a\|b') = .NET 'a|b'
    if p[0] == '"' and p[-1] == '"':
        p = "'" + p[1:-1].replace("'", "''") + "'"
    if "|" in p and p[0] not in "'\"":
        p = f"'{p}'"
    cmd = f"Select-String{cs}{nm}{am}{ctx_ab or ''} {p}{src}"
    tail = []
    m1 = next((f for f in flags if f.startswith("m") and f[1:].isdigit()), None)
    if m1:
        tail.append(f"Select-Object -First {m1[1:]}")
    if "c" in flags:
        return f"({cmd}).Count"
    if "o" in flags:
        tail.append("ForEach-Object { $_.Matches.Value }")
    elif "n" not in flags and ctx_ab is None:
        tail.append("ForEach-Object Line")
    elif "n" in flags and ctx_ab is None:
        tail.append('ForEach-Object { "$($_.LineNumber):$($_.Line)" }')
    return " | ".join([cmd] + tail)
