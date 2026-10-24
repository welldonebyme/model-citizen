"""Count every distinct non-dbt shell command typed in the book's bashcode blocks.

    uv run --no-project --python 3.12 converter/reference/scan_shell_commands.py [--json out.json]

Reads ../dbt-bible/parts/**/*.tex (only lines that start with `$ ` or `(.venv) $ ` inside \\begin{bashcode}),
splits each line on | && || ; and counts:
  commands       first word of each segment (env-var prefixes like X=1 removed)
  subcommands    git/uv/brew/python/duckdb/... with their first argument(s)
  features       shell features that differ on Windows: < > >> redirection, $?, export, X=1 prefix, ~, globs, \\
Used to build converter/overrides/os-commands.yaml (the `scan` section).
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import transcripts as T  # noqa: E402

SUB_DEPTH = {"git": 1, "uv": 2, "brew": 1, "python": 1, "python3": 1, "duckdb": 0, "gh": 2, "code": 0,
             "pip": 1, "docker": 1, "xcode-select": 1, "winget": 1, "open": 0, "source": 1}


def split_segments(cmd: str) -> tuple[list[list[str]], list[str]]:
    lex = shlex.shlex(cmd, posix=True, punctuation_chars="|&;<>")
    lex.whitespace_split = True
    lex.commenters = "#"
    toks = list(lex)
    segs, cur, ops = [], [], []
    for t in toks:
        if t in ("|", "&&", ";", "||", "&"):
            segs.append(cur)
            ops.append(t)
            cur = []
        else:
            cur.append(t)
    segs.append(cur)
    return [s for s in segs if s], ops


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    commands: Counter = Counter()
    subs: Counter = Counter()
    features: Counter = Counter()
    examples: dict[str, list[str]] = defaultdict(list)
    files: dict[str, set] = defaultdict(set)
    total_lines = 0
    unparsable = []
    for t in T.all_book():
        cmd = t["command"]
        total_lines += 1
        src = t["source"].split(":")[0].split("/")[-1]
        raw = cmd
        if re.search(r"(^|\s)<\s", raw):
            features["input redirection <"] += 1
        if re.search(r"(?<![>&0-9])>(?!>)\s", raw):
            features["output redirection >"] += 1
        if ">>" in raw:
            features["append redirection >>"] += 1
        if "2>&1" in raw or "2>/dev/null" in raw:
            features["stderr redirection 2>"] += 1
        if "$?" in raw:
            features["exit code $?"] += 1
        if re.search(r"(^|\s)~(/|\s|$)", raw):
            features["home ~"] += 1
        if re.search(r"\$\(", raw):
            features["command substitution $( )"] += 1
        if re.search(r"(^|[\s;&|])[A-Z_][A-Z0-9_]*=\S*\s+\S", raw):
            features["VAR=value prefix"] += 1
        if "|" in raw.replace("||", ""):
            features["pipe |"] += 1
        if "&&" in raw:
            features["and-chain &&"] += 1
        if re.search(r"(?<!['\"\w])\*", raw):
            features["glob or quoted * (selection)"] += 1
        try:
            segs, ops = split_segments(cmd)
        except ValueError:
            unparsable.append(cmd)
            continue
        for s in segs:
            while s and re.match(r"^[A-Z_][A-Z0-9_]*=", s[0]):
                s = s[1:]
            if not s:
                continue
            w = s[0]
            if w in ("dbt",):
                continue
            commands[w] += 1
            files[w].add(src)
            if len(examples[w]) < 3 and cmd not in examples[w]:
                examples[w].append(cmd)
            depth = SUB_DEPTH.get(w, 0)
            if depth:
                args = [x for x in s[1:] if not x.startswith("-") or w in ("python", "python3")][:depth]
                key = " ".join([w] + args)
                subs[key] += 1
    out = {
        "source": "dbt-bible/parts/**/*.tex, bashcode blocks, lines starting with '$ ' or '(.venv) $ '",
        "command_lines": total_lines,
        "commands": dict(sorted(commands.items(), key=lambda kv: (-kv[1], kv[0]))),
        "subcommands": dict(sorted(subs.items(), key=lambda kv: (-kv[1], kv[0]))),
        "features": dict(sorted(features.items(), key=lambda kv: (-kv[1], kv[0]))),
        "files": {k: sorted(v) for k, v in sorted(files.items())},
        "examples": {k: v for k, v in sorted(examples.items())},
        "unparsable": unparsable,
    }
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"command lines: {total_lines}")
    for k, v in out["commands"].items():
        print(f"{v:5d}  {k}")
    print("--- subcommands")
    for k, v in out["subcommands"].items():
        print(f"{v:5d}  {k}")
    print("--- features")
    for k, v in out["features"].items():
        print(f"{v:5d}  {k}")
    print(f"unparsable: {len(unparsable)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
