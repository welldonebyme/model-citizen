"""Read terminal transcripts (command + real output) from the logs and from the book.

Sources
  reference/builder-logs/chNN.md   ```bash  `$ cmd` ```  followed by  ```text <output> ```
  reference/capstone-logs/mNN.md   ```  `$ cmd` + output lines (+ `[exit code N]`) ```  (several commands per block)
  ../dbt-bible/parts/**/*.tex      \\begin{bashcode} `$ cmd` + optional output lines \\end{bashcode}
                                   optionally followed by \\begin{outputcode} ... \\end{outputcode}

Every transcript: {source, line, section, command, output: [lines], exit_code, origin}
"""
from __future__ import annotations

import re
from pathlib import Path

ACADEMY = Path(__file__).resolve().parents[2]
BIBLE = ACADEMY.parent / "dbt-bible"

PROMPT_RE = re.compile(r"^(?:\(\.venv\) )?\$ (.*)$")
EXIT_RE = re.compile(r"^\[exit code (\d+)\]\s*$")


def rel(p: Path) -> str:
    for base, prefix in ((ACADEMY, ""), (BIBLE, "dbt-bible/")):
        try:
            return prefix + str(p.relative_to(base))
        except ValueError:
            pass
    return str(p)


def _join_continuations(cmd_lines: list[str]) -> str:
    out = []
    for l in cmd_lines:
        out.append(l[:-1].rstrip() if l.endswith("\\") else l)
    return " ".join(out).strip()


def builder_log(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").split("\n")
    res = []
    h2 = h3 = ""
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith("## "):
            h2, h3 = l[3:].strip(), ""
        elif l.startswith("### "):
            h3 = l[4:].strip()
        if l.strip() == "```bash":
            start = i + 1
            j = i + 1
            body = []
            while j < len(lines) and lines[j].strip() != "```":
                body.append(lines[j])
                j += 1
            cmds = []
            for b in body:
                m = PROMPT_RE.match(b)
                if m:
                    cmds.append([m.group(1)])
                elif cmds and cmds[-1][-1].endswith("\\"):
                    cmds[-1].append(b.strip())
            k = j + 1
            while k < len(lines) and lines[k].strip() == "":
                k += 1
            output = []
            if k < len(lines) and lines[k].strip() == "```text":
                k += 1
                while k < len(lines) and lines[k].strip() != "```":
                    output.append(lines[k])
                    k += 1
                j = k
            exit_code = None
            if output and EXIT_RE.match(output[-1]):
                exit_code = int(EXIT_RE.match(output[-1]).group(1))
            for c in cmds:
                res.append({"source": f"{rel(path)}:{start + 1}", "line": start + 1,
                            "section": " > ".join(x for x in (h2, h3) if x), "command": _join_continuations(c),
                            "output": output if len(cmds) == 1 else None, "exit_code": exit_code,
                            "origin": "builder-log"})
            i = j + 1
            continue
        i += 1
    return res


def capstone_log(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").split("\n")
    res = []
    head = ""
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith("#"):
            head = l.lstrip("#").strip()
        if l.strip() == "```":
            j = i + 1
            cur = None
            while j < len(lines) and lines[j].strip() != "```":
                b = lines[j]
                m = PROMPT_RE.match(b)
                if m:
                    cur = {"source": f"{rel(path)}:{j + 1}", "line": j + 1, "section": head,
                           "command": m.group(1).strip(), "output": [], "exit_code": None,
                           "origin": "capstone-log"}
                    res.append(cur)
                elif cur is not None:
                    em = EXIT_RE.match(b)
                    if em:
                        cur["exit_code"] = int(em.group(1))
                    else:
                        cur["output"].append(b)
                j += 1
            i = j + 1
            continue
        i += 1
    return res


ENV_RE = re.compile(r"\\begin\{(bashcode|outputcode)\}")


def _skip_options(text: str, pos: int) -> int:
    """pos points just after \\begin{env}; skip an optional [...] (with nested braces/brackets)."""
    if pos < len(text) and text[pos] == "[":
        depth = 0
        k = pos
        while k < len(text):
            ch = text[k]
            if ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
                if depth == 0:
                    return k + 1
            k += 1
    return pos


def tex_envs(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    envs = []
    for m in ENV_RE.finditer(text):
        kind = m.group(1)
        p = _skip_options(text, m.end())
        end_tag = f"\\end{{{kind}}}"
        e = text.find(end_tag, p)
        body = text[p:e]
        if body.startswith("\n"):
            body = body[1:]
        envs.append({"kind": kind, "start": m.start(), "end": e + len(end_tag), "body": body.rstrip("\n"),
                     "line": text.count("\n", 0, m.start()) + 1})
    return envs, text


SECTION_RE = re.compile(r"\\(section|subsection|subsubsection)\*?\{")


def _section_at(text: str, pos: int) -> str:
    last = ""
    for m in SECTION_RE.finditer(text, 0, pos):
        # take the title up to the matching brace
        k = m.end()
        depth = 1
        while k < len(text) and depth:
            if text[k] == "{":
                depth += 1
            elif text[k] == "}":
                depth -= 1
            k += 1
        last = text[m.end():k - 1]
    return last


def book_tex(path: Path) -> list[dict]:
    envs, text = tex_envs(path)
    res = []
    for idx, env in enumerate(envs):
        if env["kind"] != "bashcode":
            continue
        lines = env["body"].split("\n")
        items = []
        cur = None
        for off, b in enumerate(lines):
            m = PROMPT_RE.match(b)
            if m and not (cur and cur["_cont"]):
                cur = {"source": f"{rel(path)}:{env['line'] + off + 1}", "line": env["line"] + off + 1,
                       "section": _section_at(text, env["start"]), "command_lines": [m.group(1)],
                       "output": [], "exit_code": None, "origin": "book", "_cont": m.group(1).endswith("\\")}
                items.append(cur)
            elif cur is not None and cur["_cont"]:
                cur["command_lines"].append(b.strip())
                cur["_cont"] = b.endswith("\\")
            elif cur is not None:
                cur["output"].append(b)
        # strip trailing blank output lines (blank lines separate commands in the book)
        for it in items:
            while it["output"] and it["output"][-1].strip() == "":
                it["output"].pop()
        # outputcode right after the bashcode (only whitespace in between) = output of the last command
        nxt = envs[idx + 1] if idx + 1 < len(envs) else None
        inline = any(it["output"] for it in items)
        for it in items:
            it["block_has_inline_output"] = inline
        if items and nxt and nxt["kind"] == "outputcode":
            gap = text[env["end"]:nxt["start"]]
            if gap.strip() == "" and not inline:
                if len(items) == 1:
                    items[-1]["output"] = nxt["body"].split("\n")
                    items[-1]["output_from"] = f"outputcode at line {nxt['line']}"
                else:
                    # one Result box for several commands: the outputs cannot be told apart
                    for it in items:
                        it["output"] = None
                        it["output_ambiguous"] = f"outputcode at line {nxt['line']} follows {len(items)} commands"
        for it in items:
            it["command"] = _join_continuations(it.pop("command_lines"))
            it.pop("_cont", None)
            res.append(it)
    return res


def all_builder_logs() -> list[dict]:
    out = []
    for p in sorted((ACADEMY / "reference" / "builder-logs").glob("ch*.md")):
        for t in builder_log(p):
            t["tag"] = p.stem
            t["project"] = "jaffle"
            out.append(t)
    return out


def all_capstone_logs() -> list[dict]:
    out = []
    for p in sorted((ACADEMY / "reference" / "capstone-logs").glob("m*.md")):
        for t in capstone_log(p):
            t["tag"] = p.stem
            t["project"] = "shopflow"
            out.append(t)
    return out


def all_book() -> list[dict]:
    out = []
    for p in sorted((BIBLE / "parts").rglob("*.tex")):
        m = re.match(r"ch(\d\d)", p.name)
        n = int(m.group(1)) if m else None
        for t in book_tex(p):
            t["chapter"] = n
            t["tag"] = f"ch{n:02d}" if n is not None and 6 <= n <= 25 else None
            t["project"] = "jaffle" if t["tag"] else None
            out.append(t)
    return out
