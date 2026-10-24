"""Replay the Windows (PowerShell) variants of the chapters under pwsh, next to the book's commands under zsh.

    converter/.venv/bin/python -m converter.tools.win_replay [--work DIR] [--chapters ch02,ch03] [--no-install]

Two sandboxes (two HOMEs), each with the practice + capstone kits installed by their setup.sh:
  mac/ : every command line of the chapter as the book prints it (after the path rules), run by zsh
  win/ : the Windows variant of the same block (or the book text when the block has none), run by pwsh
Each chapter is replayed end to end, block after block, in one shell session per sandbox, from the same starting
state (prepare()): the project at the end of the previous chapter's tag with the chapter's files on top (what the
learner has typed), the profile, the raw data of that moment, `dbt build` done. A book command and the PowerShell
line(s) made from it are compared: both succeed, or both fail (the book shows a few failures on purpose).

macOS adaptations of the PowerShell text (Windows runs the text exactly, see converter/reference/ci/kit-matrix.yml):
  `\\` -> `/` in paths (cmdlets accept both on Windows; native programs on macOS need `/`),
  `.venv\\Scripts` -> a `Scripts` link to the venv's `bin`, `$env:TEMP` -> a sandbox folder.
Commands that are not run (same in both shells): network (git push/pull, gh, winget, brew, curl), interactive or
blocking ones (duckdb prompt, dbt docs serve, interactive dbt init, editors), and Windows-only installers. DuckDB CLI
lines (no CLI on this machine) are replaced in BOTH shells by the kit's duck.py with the same SQL ("substituted").

Writes converter/golden/win-replay.json: per block ok / partly / differs / untested (+ reasons), per chapter totals.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from ..build.oscmd import PROMPT, Ctx, OsCommands, balanced
from ..build.output import bash_blocks
from ..config import ACADEMY, OUT, OVERRIDES
from .check_kit_paths import install

REPORT = ACADEMY / "converter" / "golden" / "win-replay.json"
END_TO_END = ["ch02", "ch03", "ch06", "ch07", "ch13", "ch22"]
MARK = "@@MC"

SKIP = [
    (re.compile(r"^(\(\.venv\) )?(git (push|pull)\b|git fetch( -\S+)* origin|git clone (-\S+ )*https?://)"), "network (GitHub)"),
    (re.compile(r"^gh\b"), "network (GitHub CLI)"),
    (re.compile(r"^(winget|brew|xcode-select|curl|irm)\b"), "installer (changes the computer)"),
    (re.compile(r"^(code|open|start|Invoke-Item)\b"), "opens an editor / a window"),
    (re.compile(r"^dbt docs serve\b"), "blocking web server"),
    (re.compile(r"^dbt init(?!.*(--skip-profile-setup|\s-s\b))"), "interactive (dbt init asks questions)"),
    (re.compile(r"^duckdb( -readonly)? \S+\.duckdb\s*(#.*)?$"), "interactive DuckDB prompt"),
    (re.compile(r"^git commit(?!.*\s-(m|am)\b)"), "opens an editor (no -m)"),
    (re.compile(r"^py -3"), "Windows-only (Python launcher)"),
    (re.compile(r"^python3?\s*$"), "interactive Python prompt"),
    (re.compile(r"^Set-ExecutionPolicy\b"), "changes a Windows setting"),
    (re.compile(r"^uv venv\b"), "re-creates the venv (the kit setup made it; it would remove dbt from the sandbox)"),
    (re.compile(r"^python3?(\.12)? -m venv\b"), "re-creates the venv (the kit setup made it)"),
]

# known, explained differences between zsh and PowerShell results (block id, book command prefix) -> reason
EXPECTED = {
    ("ch16-c4", "dbt ls -s stg_jaffle_shop__*"): "zsh's glob error does not exist in PowerShell (it passes * to dbt): "
                                                 "the OS note of this section says so",
    ("ch02-c11", "which python3"): "outside the venv, the sandbox has python3 but no `python` on macOS "
                                   "(on Windows `python` is the command)",
}


def ps_mac(line: str) -> str:
    """The macOS adaptation of one PowerShell line (see the module doc). On Windows the line runs as it is."""
    return line if os.name == "nt" else line.replace("\\", "/")


def duck_substitute(cmd: str, shell: str) -> str | None:
    """A DuckDB CLI command line -> the kit's duck.py with the same SQL (None when it is not one)."""
    m = re.match(r"^duckdb( -readonly)? (\S+)\s*(?:<\s*(\S+)|-c \"\.read (\S+)\"|-c (\"[^\"]*\"))\s*(#.*)?$", cmd)
    if shell == "zsh":
        py = '"$HOME/dbt-course/.venv/bin/python" "$HOME/dbt-course/kit/tools/duck.py"'
    else:
        py = '& "$HOME/dbt-course/.venv/bin/python" "$HOME/dbt-course/kit/tools/duck.py"'
    if not m and re.match(r"^duckdb --version\b", cmd):
        rest = cmd[len("duckdb --version"):]
        return f"{py} --version{rest}"
    if not m:
        return None
    ro, db, f1, f2, sql = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
    args = f"{'--readonly ' if ro else ''}{db} " + (f"-f {f1 or f2}" if (f1 or f2) else sql)
    return f"{py} {args}"


def duck_substitute_line(cmd: str, shell: str = "zsh") -> str | None:
    """duck_substitute for each part of a line with && / ; / | (None if no part is a DuckDB CLI command)."""
    from ..build.oscmd import split_ops
    parts = split_ops(cmd)
    changed = False
    out = ""
    for text, op in parts:
        sub = duck_substitute(text, shell)
        if sub:
            changed = True
        out += (sub or text) + (f" {op} " if op else "")
    return out.strip() if changed else None


def classify(cmd: str) -> str | None:
    c = re.sub(r"^\(\.venv\) ", "", cmd).strip()
    for rx, why in SKIP:
        if rx.search(c):
            return why
    return None


# ---------------------------------------------------------------------------------------------- chapter states
def sh(args, home: Path, cwd: Path | None = None, check=True, env_extra=None) -> subprocess.CompletedProcess:
    env = base_env(home)
    if env_extra:
        env.update(env_extra)
    r = subprocess.run(args, cwd=cwd or home, env=env, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{args}: {r.stdout[-800:]}\n{r.stderr[-800:]}")
    return r


def base_env(home: Path) -> dict:
    real = os.environ["HOME"]
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DBT_", "VIRTUAL_ENV", "GIT_"))}
    env.update(HOME=str(home), DBT_SEND_ANONYMOUS_USAGE_STATS="false", DBT_USE_COLORS="false", NO_COLOR="1",
               TERM="dumb", PAGER="cat", GIT_PAGER="cat", MANPAGER="cat", GIT_EDITOR="true",
               GIT_AUTHOR_NAME="Learner", GIT_AUTHOR_EMAIL="learner@example.com", GIT_COMMITTER_NAME="Learner",
               GIT_COMMITTER_EMAIL="learner@example.com", TEMP=str(home / "tmp"), TMPDIR=str(home / "tmp"),
               UV_CACHE_DIR=os.environ.get("UV_CACHE_DIR", f"{real}/.cache/uv"),
               UV_PYTHON_INSTALL_DIR=os.environ.get("UV_PYTHON_INSTALL_DIR", f"{real}/.local/share/uv/python"))
    env["PATH"] = f"{real}/.local/bin:" + env.get("PATH", "")
    return env


def tag_of(ch: str) -> str | None:
    n = int(ch[2:])
    return f"ch{n:02d}" if 6 <= n <= 25 else None


def prepare(home: Path, ch: str, doc: dict | None = None) -> dict:
    """The state of the learner's computer at the start of chapter `ch` (same for both sandboxes)."""
    course = home / "dbt-course"
    (home / "tmp").mkdir(exist_ok=True)
    for name in ("jaffle_dbt", "throwaway", "ci_run", "logs", "notes.txt", "shopflow_dbt", "shopflow_solution",
                 "before_macro", "last_run", "state_ch16", "state-ch17", "state_freshness"):
        p = course / name
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()
    for p in (home / ".dbt", home / "altprofiles", home / ".zshrc", home / ".gitconfig", home / "learner"):
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()
    (home / "learner").mkdir()
    # raw data of that moment (reference/builder-logs/INDEX.md): day 1 up to Chapter 14, day 2 from Chapter 15
    prac = course / "practice"
    if prac.exists():
        shutil.rmtree(prac)
    prac.mkdir()
    shutil.copytree(course / "kit" / "data", prac / "data")
    shutil.copytree(course / "kit" / "updates", prac / "updates")
    shutil.copy(course / "kit" / "setup.sql", prac / "setup.sql")
    bindir = course / ".venv" / ("Scripts" if os.name == "nt" else "bin")
    exe = ".exe" if os.name == "nt" else ""
    py = str(bindir / f"python{exe}")
    duck = str(course / "kit" / "tools" / "duck.py")
    sh([py, duck, "practice.duckdb", "-f", "setup.sql"], home, prac)
    n = int(ch[2:]) if ch[2:].isdigit() else 0
    if n >= 15:
        sh([py, duck, "practice.duckdb", "-f", "updates/day2.sql"], home, prac)
    # the venv's Scripts\ folder of Windows = bin/ on macOS
    scripts = course / ".venv" / "Scripts"
    if os.name != "nt" and not scripts.exists():
        scripts.symlink_to("bin")
    for block_id, dest in LEARNER_FILES.get(ch, []):
        (home / dest).parent.mkdir(parents=True, exist_ok=True)
        (home / dest).write_text(code_text(doc, block_id))
    state = {"cwd": "~", "venv": False}
    prof_src = course / "kit" / "profiles" / "profiles.yml"
    if n == 6:
        shutil.copy(prof_src, home / "learner" / "profiles.yml")   # written by the learner in Chapter 6
        state.update(cwd="~/dbt-course", venv=True)
    tag = tag_of(ch)
    if tag and n >= 7:
        prev = f"ch{n - 1:02d}"
        proj = course / "jaffle_dbt"
        sh(["git", "clone", "-q", str(course / "kit" / "jaffle_dbt.bundle"), str(proj)], home)
        sh(["git", "checkout", "-q", "-b", "learner", prev], home, proj)
        (home / ".dbt").mkdir()
        shutil.copy(prof_src, home / ".dbt" / "profiles.yml")
        dbt = str(bindir / f"dbt{exe}")
        if (proj / "packages.yml").exists():
            sh([dbt, "deps"], home, proj)
        if n - 1 >= 15:
            sh(["uv", "pip", "install", "-q", "--python", py, "pandas"], home)
        if n >= 8:
            args = [dbt, "build"] + (["--exclude-resource-type", "unit_test"] if n - 1 >= 19 else [])
            sh(args, home, proj, check=False)
        # the chapter's files, as the learner types them (not committed yet)
        sh(["git", "checkout", "-q", tag, "--", "."], home, proj)
        gone = sh(["git", "diff", "--name-only", "--diff-filter=D", prev, tag], home, proj).stdout.split()
        for f in gone:
            (proj / f).unlink(missing_ok=True)
        if (proj / "packages.yml").exists() and not (proj / "dbt_packages").exists():
            sh([dbt, "deps"], home, proj)
        state.update(cwd="~/dbt-course/jaffle_dbt", venv=True)
    if ch == "ch26":
        proj = course / "shopflow_dbt"
        sh(["git", "clone", "-q", str(course / "kit" / "capstone" / "shopflow_dbt.bundle"), str(proj)], home)
        sh(["git", "checkout", "-q", "-b", "learner", "m14"], home, proj)
        (home / ".dbt").mkdir(exist_ok=True)
        (home / ".dbt" / "profiles.yml").write_text(prof_src.read_text() + "\n" +
                                                    (course / "kit" / "capstone" / "profiles" / "profiles.yml").read_text())
        sh([str(bindir / f"dbt{exe}"), "deps"], home, proj)
        state.update(cwd="~/dbt-course/shopflow_dbt", venv=True)
    return state


# files the learner writes from a code block of the chapter (block id -> path under HOME), before the chapter starts
LEARNER_FILES = {
    "ch05": [("ch05-c23", "dbt-course/practice/broken.yml"), ("ch05-c37", "dbt-course/practice/pivot.sql"),
             ("ch05-c46", "dbt-course/practice/render.py"), ("ch05-c51", "dbt-course/practice/basics.py"),
             ("ch05-c53", "dbt-course/practice/explore.py")],
}


def code_text(doc: dict, block_id: str) -> str:
    def walk(o):
        if isinstance(o, dict):
            if o.get("t") == "code" and o.get("id") == block_id:
                return o["text"]
            for v in o.values():
                r = walk(v)
                if r is not None:
                    return r
        elif isinstance(o, list):
            for v in o:
                r = walk(v)
                if r is not None:
                    return r
        return None
    t = walk(doc)
    if t is None:
        raise KeyError(block_id)
    return t + "\n"


# learner steps between blocks (files the book asks you to write with an editor), applied in BOTH shells
INJECT = {
    "ch06-c24": {"after": ("mkdir -p \"$HOME/.dbt\" && cp \"$HOME/learner/profiles.yml\" \"$HOME/.dbt/profiles.yml\"",
                           "New-Item -ItemType Directory -Force \"$HOME/.dbt\" | Out-Null; "
                           "Copy-Item \"$HOME/learner/profiles.yml\" \"$HOME/.dbt/profiles.yml\""),
                 "why": "the learner writes ~/.dbt/profiles.yml in the editor (the book's profile)"},
}


# ---------------------------------------------------------------------------------------------- sessions
def book_commands(text: str) -> list[str]:
    """Command lines of a block, joined like oscmd.block (continuations, open quotes)."""
    lines = text.split("\n")
    out = []
    i = 0
    while i < len(lines):
        m = PROMPT.match(lines[i])
        if not m:
            i += 1
            continue
        cmd = m.group(2)
        while (cmd.endswith("\\") or not balanced(cmd)) and i + 1 < len(lines):
            i += 1
            if cmd.endswith("\\"):
                cmd = cmd[:-1] + lines[i] if not cmd[:-1].endswith(" ") else cmd[:-1] + lines[i].lstrip()
            else:
                cmd = cmd + "\n" + lines[i]
        out.append(cmd)
        i += 1
    return out


REAL_DUCKDB = False   # --real-duckdb (CI with the DuckDB CLI): the PowerShell side runs the DuckDB lines as written


def plan_chapter(doc: dict, eng: OsCommands, ch: str) -> list[dict]:
    ctx = Ctx()
    blocks = []
    for b in bash_blocks(doc):
        cmds = book_commands(b["text"])
        override = eng.blocks.get(b["id"])
        items = []
        if override:
            ps_lines = [PROMPT_PS.sub("", l) for l in override["win"].split("\n") if PROMPT_PS.match(l)]
            items.append({"book": cmds, "win": ps_lines, "block_override": True})
        else:
            for c in cmds:
                win = eng.line(c, b["id"], ctx) if b.get("variants", {}).get("win") else [c]
                items.append({"book": [c], "win": win})
        for it in items:
            reasons = {classify(x) for x in it["book"] + it["win"]} - {None}
            if reasons:
                it["skip"] = sorted(reasons)[0]
                continue
            subs_b = [duck_substitute_line(x) for x in it["book"]]
            subs_w = [None if REAL_DUCKDB else duck_substitute_line(ps_mac(x), "pwsh") for x in it["win"]]
            if any(subs_b) or any(subs_w):
                it["substituted"] = True
                it["book_run"] = [s or x for s, x in zip(subs_b, it["book"])]
                it["win_run"] = [s or ps_mac(x) for s, x in zip(subs_w, it["win"])]
            else:
                it["book_run"] = it["book"]
                it["win_run"] = [ps_mac(x) for x in it["win"]]
        blocks.append({"block": b["id"], "has_variant": bool(b.get("variants", {}).get("win")), "items": items})
    return blocks


PROMPT_PS = re.compile(r"^(\(\.venv\) )?PS> ")


def zsh_script(blocks, state) -> str:
    out = ["setopt NO_BEEP", f'cd {state["cwd"]}']
    if state["venv"]:
        out.append("source $HOME/dbt-course/.venv/bin/activate")
    for bi, b in enumerate(blocks):
        for ii, it in enumerate(b["items"]):
            if "book_run" not in it:
                continue
            for k, c in enumerate(it["book_run"]):
                tag = f"{bi}.{ii}.{k}"
                out += [f'print -r -- "{MARK}B {tag}"', "__c=$(cat <<'__MCEOF__'", c, "__MCEOF__", ")",
                        'eval "$__c" 2>&1', f'print -r -- "{MARK}E {tag} $?"']
        inj = INJECT.get(b["block"])
        if inj:
            out.append(inj["after"][0])
    return "\n".join(out) + "\n"


def pwsh_script(blocks, state) -> str:
    out = ["$ErrorActionPreference = 'Continue'", f'Set-Location {state["cwd"].replace("~", "$HOME")}']
    if state["venv"]:
        out.append("& $HOME/dbt-course/.venv/Scripts/Activate.ps1")
    for bi, b in enumerate(blocks):
        for ii, it in enumerate(b["items"]):
            if "win_run" not in it:
                continue
            for k, c in enumerate(it["win_run"]):
                tag = f"{bi}.{ii}.{k}"
                if "\n'@" in c or c.startswith("'@"):
                    raise ValueError(f"cannot replay {c!r}")
                out += [f'Write-Output "{MARK}B {tag}"', "$global:LASTEXITCODE = 0; $__e = $Error.Count; $__x = ''",
                        "try { Invoke-Expression @'", c, "'@ 2>&1 | ForEach-Object { \"$_\" } } catch { $__x = "
                        "($_.Exception.GetType().Name + ': ' + $_.Exception.Message) -replace \"`r?`n\", ' ' }",
                        "$__n = $Error.Count - $__e",
                        "$__ps = @($Error | Select-Object -First $__n | Where-Object { $_.Exception -isnot "
                        "[System.Management.Automation.RemoteException] }).Count",
                        f'Write-Output "{MARK}E {tag} $LASTEXITCODE $__ps $__x"']
        inj = INJECT.get(b["block"])
        if inj:
            out.append(inj["after"][1])
    return "\n".join(out) + "\n"


def run_session(shell: str, script: str, home: Path, log: Path, timeout: int) -> dict:
    f = log.with_suffix(".zsh" if shell == "zsh" else ".ps1")
    f.write_text(script)
    args = ["zsh", "-f", str(f)] if shell == "zsh" else ["pwsh", "-NoProfile", "-NonInteractive", "-File", str(f)]
    try:
        r = subprocess.run(args, cwd=home, env=base_env(home), capture_output=True, text=True, timeout=timeout)
        out = r.stdout + "\n" + r.stderr
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        out += "\n@@TIMEOUT"
    log.write_text(out)
    res: dict[str, dict] = {}
    cur = None
    buf: list[str] = []
    for line in out.split("\n"):
        line = re.sub(r"\x1b\[[0-9;]*m", "", line)
        if line.startswith(MARK + "B "):
            cur, buf = line.split()[1], []
            continue
        if line.startswith(MARK + "E "):
            parts = line.split(" ", 5)
            tag = parts[1]
            if shell == "zsh":
                res[tag] = {"ok": parts[2] == "0", "rc": int(parts[2]), "out": "\n".join(buf)[-600:]}
            else:
                code = int(parts[2]) if parts[2].lstrip("-").isdigit() else 1
                errs = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0
                exc = parts[4] if len(parts) > 4 else ""
                if len(parts) > 5:
                    exc += " " + parts[5]
                res[tag] = {"ok": code == 0 and errs == 0 and not exc.strip(), "rc": code, "ps_errors": errs,
                            "exception": exc.strip() or None, "out": "\n".join(buf)[-600:]}
            cur = None
            continue
        if cur is not None:
            buf.append(line)
    return res


def baseline_mac(blocks, chapter_report: dict) -> dict:
    """mac results of an earlier macOS run (win-replay.json), keyed like run_session's results."""
    res = {}
    by_block = {r["block"]: r for r in chapter_report["blocks"]}
    for bi, b in enumerate(blocks):
        old = by_block.get(b["block"])
        if not old:
            continue
        for ii, it in enumerate(b["items"]):
            if "book_run" not in it or ii >= len(old["commands"]) or "mac_ok" not in old["commands"][ii]:
                continue
            for k in range(len(it["book_run"])):
                res[f"{bi}.{ii}.{k}"] = {"ok": old["commands"][ii]["mac_ok"], "out": "(baseline: macOS run)"}
    return res


def judge(blocks, mac: dict, win: dict) -> list[dict]:
    rows = []
    for bi, b in enumerate(blocks):
        st_items = []
        for ii, it in enumerate(b["items"]):
            row = {"book": it["book"], "win": it["win"]}
            if it.get("block_override"):
                row["block_override"] = True
            if "skip" in it:
                row["status"] = "skipped"
                row["reason"] = it["skip"]
                st_items.append(row)
                continue
            m = [mac.get(f"{bi}.{ii}.{k}") for k in range(len(it["book_run"]))]
            w = [win.get(f"{bi}.{ii}.{k}") for k in range(len(it["win_run"]))]
            if any(x is None for x in m + w):
                row["status"] = "not_reached"
                st_items.append(row)
                continue
            m_ok, w_ok = all(x["ok"] for x in m), all(x["ok"] for x in w)
            # a PowerShell syntax error is always a translation problem; a missing command or a bad parameter is one
            # only when the book's command worked
            ps_problem = [x["exception"] for x in w if x.get("exception") and (
                "ParseException" in x["exception"] or "ParentContainsError" in x["exception"] or
                (m_ok_all := all(y["ok"] for y in m)) and re.search(r"CommandNotFound|ParameterBinding", x["exception"]))]
            row.update(mac_ok=m_ok, win_ok=w_ok)
            if it.get("substituted"):
                row["substituted"] = "DuckDB CLI line run with the kit's duck.py in both shells"
            key = next((k for k in EXPECTED if k[0] == b["block"] and it["book"][0].startswith(k[1])), None)
            if m_ok == w_ok and not ps_problem:
                row["status"] = "ok"
            elif key:
                row["status"] = "ok"
                row["expected_difference"] = EXPECTED[key]
            else:
                row["status"] = "differs"
                row["detail"] = {"mac": [x["out"][-300:] for x in m], "win": [(x.get("exception") or "") + " " +
                                                                            x["out"][-300:] for x in w]}
            st_items.append(row)
        statuses = [r["status"] for r in st_items]
        if not statuses:
            status = "untested"
        elif "differs" in statuses:
            status = "differs"
        elif all(s == "ok" for s in statuses):
            status = "partly" if any(r.get("substituted") for r in st_items) else "ok"
        elif all(s in ("skipped", "not_reached") for s in statuses):
            status = "untested"
        else:
            status = "partly"
        reasons = sorted({r.get("reason") or r.get("substituted") or r.get("status") for r in st_items
                          if r["status"] != "ok" or r.get("substituted")} - {None})
        rows.append({"block": b["block"], "has_variant": b["has_variant"], "status": status,
                     **({"reasons": reasons} if reasons else {}), "commands": st_items})
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=None)
    ap.add_argument("--chapters", default=None, help="comma list (default: every chapter with a Windows variant)")
    ap.add_argument("--no-install", action="store_true")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--win-only", action="store_true",
                    help="run only the PowerShell side (Windows CI) and compare with the macOS results of --baseline")
    ap.add_argument("--home", default=None, help="an already installed HOME for the PowerShell side (CI: the runner's)")
    ap.add_argument("--real-duckdb", action="store_true", help="the DuckDB CLI is installed: run its lines as written")
    ap.add_argument("--baseline", default=str(REPORT))
    ap.add_argument("--out", default=None)
    ap.add_argument("--fail-on-differs", action="store_true", help="exit 1 when a block differs (CI)")
    a = ap.parse_args(argv)
    global REAL_DUCKDB
    REAL_DUCKDB = a.real_duckdb
    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="mc-win-replay-"))
    work.mkdir(parents=True, exist_ok=True)
    homes = {}
    for side in (("win",) if a.win_only else ("mac", "win")):
        if a.home and side == "win":
            homes[side] = Path(a.home)
        else:
            homes[side] = (work / side / "home") if a.no_install else install(work / side)
    report_path = Path(a.out) if a.out else REPORT
    baseline = json.loads(Path(a.baseline).read_text()) if a.win_only else None
    eng = OsCommands(OVERRIDES / "os-commands.yaml")
    version = subprocess.run(["pwsh", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
                             capture_output=True, text=True).stdout.strip()
    docs = {p.stem: json.loads(p.read_text()) for p in sorted((OUT / "chapters").glob("ch*.json"))}
    wanted = a.chapters.split(",") if a.chapters else [
        c for c, d in docs.items() if any(b.get("variants", {}).get("win") for b in bash_blocks(d))]
    old = json.loads(report_path.read_text()) if report_path.exists() else {}
    chapters = dict(old.get("chapters", {}))
    for ch in wanted:
        blocks = plan_chapter(docs[ch], eng, ch)
        state = None
        for side in homes:
            state = prepare(homes[side], ch, docs[ch])
        logs = work / "logs"
        logs.mkdir(exist_ok=True)
        if a.win_only:
            mac = baseline_mac(blocks, baseline["chapters"][ch])
        else:
            mac = run_session("zsh", zsh_script(blocks, state), homes["mac"], logs / f"{ch}-mac.log", a.timeout)
        win = run_session("pwsh", pwsh_script(blocks, state), homes["win"], logs / f"{ch}-win.log", a.timeout)
        rows = judge(blocks, mac, win)
        tally = {}
        for r in rows:
            if r["has_variant"]:
                tally[r["status"]] = tally.get(r["status"], 0) + 1
        cmds = [c for r in rows for c in r["commands"]]
        chapters[ch] = {
            "end_to_end": ch in END_TO_END,
            "start_state": state,
            "blocks_with_variant": sum(1 for r in rows if r["has_variant"]),
            "variant_blocks_by_status": dict(sorted(tally.items())),
            "commands": {s: sum(1 for c in cmds if c["status"] == s) for s in ("ok", "differs", "skipped", "not_reached")},
            "commands_ok_both_succeeded": sum(1 for c in cmds if c["status"] == "ok" and c.get("win_ok")),
            "commands_ok_both_failed": sum(1 for c in cmds if c["status"] == "ok" and not c.get("win_ok")),
            "blocks": rows,
        }
        print(f"{ch}: variant blocks {chapters[ch]['variant_blocks_by_status']}, commands {chapters[ch]['commands']}",
              flush=True)
    platform = ("Windows (no adaptation)" if os.name == "nt" else
                "macOS (pwsh from Homebrew) with the adaptations of the module doc")
    summary = {"pwsh": version, "platform": platform, "duckdb": "CLI" if REAL_DUCKDB else "duck.py substitute",
               "baseline": "macOS zsh results of converter/golden/win-replay.json" if a.win_only else "zsh, same run",
               "variant_blocks": {}, "commands": {}}
    for c in chapters.values():
        for k, v in c["variant_blocks_by_status"].items():
            summary["variant_blocks"][k] = summary["variant_blocks"].get(k, 0) + v
        for k, v in c["commands"].items():
            summary["commands"][k] = summary["commands"].get(k, 0) + v
    report_path.write_text(json.dumps({"summary": summary, "chapters": dict(sorted(chapters.items()))},
                                      indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(summary))
    print(f"work folder: {work}")
    return 1 if a.fail_on_differs and summary["variant_blocks"].get("differs") else 0


if __name__ == "__main__":
    sys.exit(main())
