"""Extract golden outputs from the real logs and the book.

    uv run --no-project --python 3.12 converter/reference/golden_extract.py

Writes (deterministic):
  converter/golden/dbt-ls.json     every `dbt ls` (and dbt build/run/test/seed/snapshot node lists) with its real output
  converter/golden/outputs.json    golden outputs for paste-to-verify parsers: dbt summary lines, dbt --version,
                                   git log --oneline, git status (--short)
  converter/golden/extract-report.json   counts + every transcript that was NOT used, with the reason

golden_verify.py later adds a `verification` field to every dbt-ls.json entry (re-run with the real dbt env).
"""
from __future__ import annotations

import json
import re
import shlex
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import transcripts as T  # noqa: E402

ACADEMY = Path(__file__).resolve().parents[2]
GOLDEN = ACADEMY / "converter" / "golden"

TS_RE = re.compile(r"^(\d\d:\d\d:\d\d)\s{1,2}(.*)$")
NODE_LINE_RE = re.compile(r"^(?:\d\d:\d\d:\d\d\s+)?(\d+) of (\d+) (START|SKIP|NO-OP) (.+?)(?: \.+ | \.*\s*\[|\s*$)")
SUMMARY_RE = re.compile(r"Done\. PASS=(\d+) WARN=(\d+) ERROR=(\d+) SKIP=(\d+) NO-OP=(\d+) TOTAL=(\d+)")
FOUND_RE = re.compile(r"Found (\d+ .+)$")
VALUE_GLOBAL = {"--log-level", "--log-level-file", "--log-format", "--log-format-file", "--log-path",
                "--target-path", "--printer-width", "--warn-error-options", "--profiles-dir", "--project-dir",
                "--profile", "--target", "-t", "--vars", "--threads", "--log-file-max-bytes", "--cache-selected-only"}
SILENT_CMDS = {"mkdir", "cp", "cd", "export", "rm", "mv", "touch", "sleep", "true"}
RUNLIKE = {"build", "run", "test", "seed", "snapshot", "clone"}
STATE_WORDS = ("state:", "result:", "source_status:")


# ----------------------------------------------------------------------------------------------- command parsing
def tokenize(cmd: str) -> list[str] | None:
    try:
        lex = shlex.shlex(cmd, posix=True, punctuation_chars="|&;<>")
        lex.whitespace_split = True
        lex.commenters = "#"
        return list(lex)
    except ValueError:
        return None


def segments(tokens: list[str]) -> list[list[str]]:
    segs, cur = [], []
    for t in tokens:
        if t in ("|", "&&", ";", "||", "&"):
            segs.append(cur)
            segs.append([t])
            cur = []
        else:
            cur.append(t)
    segs.append(cur)
    return [s for s in segs if s]


def split_env(seg: list[str]) -> tuple[dict, list[str]]:
    env = {}
    i = 0
    while i < len(seg) and re.match(r"^[A-Z_][A-Z0-9_]*=", seg[i]):
        k, v = seg[i].split("=", 1)
        env[k] = v
        i += 1
    return env, seg[i:]


def dbt_subcommand(words: list[str]) -> tuple[list[str], str | None, list[str]]:
    """['dbt', '-q', 'ls', '-s', 'x'] -> (global flags, 'ls', args)."""
    if not words or words[0] != "dbt":
        return [], None, []
    g = []
    i = 1
    while i < len(words):
        w = words[i]
        if w.startswith("-"):
            g.append(w)
            if w in VALUE_GLOBAL and "=" not in w and i + 1 < len(words):
                g.append(words[i + 1])
                i += 2
                continue
            i += 1
            continue
        return g, w, words[i + 1:]
    return g, None, []


MULTI = {"--select": "select", "-s": "select", "--models": "select", "-m": "select", "--model": "select",
         "--exclude": "exclude", "--resource-type": "resource_types", "--resource-types": "resource_types",
         "--exclude-resource-type": "exclude_resource_types", "--exclude-resource-types": "exclude_resource_types",
         "--output-keys": "output_keys"}
SINGLE = {"--selector": "selector", "--output": "output", "-o": "output", "--indirect-selection": "indirect_selection",
          "--target": "target", "-t": "target", "--state": "state", "--defer-state": "defer_state",
          "--vars": "vars", "--threads": "threads", "--sample": "sample", "--event-time-start": "event_time_start",
          "--event-time-end": "event_time_end", "--limit": "limit", "--inline": "inline",
          "--warn-error-options": "warn_error_options", "--log-level": "log_level"}


def parse_args(args: list[str]) -> dict:
    out: dict = {"flags": []}
    i = 0
    while i < len(args):
        a = args[i]
        if "=" in a and a.startswith("--") and a.split("=", 1)[0] in {**MULTI, **SINGLE}:
            k, v = a.split("=", 1)
            args = args[:i] + [k, v] + args[i + 1:]
            a = k
        if a in MULTI:
            key = MULTI[a]
            vals = []
            i += 1
            while i < len(args) and not args[i].startswith("-"):
                vals.append(args[i])
                i += 1
            out.setdefault(key, []).extend(vals)
            continue
        if a in SINGLE:
            out[SINGLE[a]] = args[i + 1] if i + 1 < len(args) else None
            i += 2
            continue
        if a.startswith("-"):
            out["flags"].append(a)
        else:
            out.setdefault("positional", []).append(a)
        i += 1
    if not out["flags"]:
        del out["flags"]
    return out


def is_state_dependent(words: list[str]) -> bool:
    for w in words:
        if w in ("--state", "--defer", "--favor-state", "--defer-state") or w.startswith("--state="):
            return True
        if any(s in w for s in STATE_WORDS):
            return True
    return False


def analyse_command(cmd: str) -> dict | None:
    """Find the dbt command inside a shell line. Returns None when there is no dbt command."""
    toks = tokenize(cmd)
    if toks is None:
        return {"problem": "unparsable shell line"}
    segs = segments(toks)
    dbts = []
    others = []
    pipes_after = []
    for idx, s in enumerate(segs):
        if len(s) == 1 and s[0] in ("|", "&&", ";", "||", "&"):
            continue
        env, words = split_env(s)
        if words and words[0] == "dbt":
            g, sub, args = dbt_subcommand(words)
            prev_op = segs[idx - 1][0] if idx > 0 else None
            nxt_op = segs[idx + 1][0] if idx + 1 < len(segs) else None
            dbts.append({"env": env, "global": g, "sub": sub, "args": args, "words": words,
                         "piped_into": prev_op == "|", "pipe_out": nxt_op == "|", "seg_index": idx})
        else:
            others.append({"words": words, "seg_index": idx, "env": env})
    if not dbts:
        return None
    return {"dbts": dbts, "others": others, "segments": segs}


# ----------------------------------------------------------------------------------------------- output parsing
def clean(lines: list[str] | None) -> list[str]:
    return [l.rstrip() for l in (lines or [])]


def parse_ls_output(lines: list[str]) -> dict:
    nodes, logs, err = [], [], []
    partial = False
    in_err = False
    found = None
    for l in lines:
        s = l.strip()
        if in_err:
            if s:
                err.append(s)
            continue
        m = TS_RE.match(l)
        if m:
            msg = m.group(2).strip()
            fm = FOUND_RE.search(msg)
            if fm and msg.startswith("Found "):
                found = msg
            if msg.startswith("Encountered an error"):
                in_err = True
                err.append(msg)
            elif msg:
                logs.append(msg)
            continue
        if s in ("...", "…", "[...]"):
            partial = True
            continue
        if not s or T.EXIT_RE.match(s):
            continue
        if s.startswith(("Encountered an error", "Runtime Error", "Compilation Error", "Parsing Error")):
            in_err = True
            err.append(s)
            continue
        if s.startswith(("zsh:", "bash:", "Error:", "Usage:", "Try 'dbt")):
            err.append(s)
            continue
        nodes.append(s)
    if len(err) > 6:
        err = err[:6] + [f"... ({len(err) - 6} more lines)"]
    return {"nodes": nodes, "logs": logs, "error": "\n".join(err) or None, "partial": partial, "found_line": found}


RESULT_LINE_RE = re.compile(r"^(\d+) of (\d+) (OK created|OK loaded|OK snapshotted|ERROR creating|ERROR snapshotting|"
                            r"ERROR loading|PASS|FAIL \d+|WARN \d+|ERROR) (.+?)(?: \.+ | \.*\s*\[|\s*$)")


def _result_desc(kind: str, rest: str) -> str:
    rest = re.sub(r"\s*\.{2,}.*$", "", rest).strip()
    if kind in ("OK created", "ERROR creating"):
        return rest
    if kind in ("OK loaded", "ERROR loading"):
        return rest if rest.startswith("seed file ") else "seed file " + rest
    if kind in ("OK snapshotted", "ERROR snapshotting"):
        return "snapshot " + rest
    return ("unit_test " if "::" in rest else "test ") + rest


def parse_run_output(lines: list[str]) -> dict:
    """Nodes of a dbt build/run/test/seed/snapshot log: one per 'N of M' index (START/SKIP/NO-OP lines, and the
    result line when the START line was elided). Run hooks ('hook: ...', numbered separately) are left out."""
    idx: dict[int, dict] = {}
    fallback: dict[int, dict] = {}
    total = None
    summary = None
    for l in lines:
        s = l.strip()
        m = TS_RE.match(l)
        msg = (m.group(2) if m else s).strip()
        sm = SUMMARY_RE.search(msg)
        if sm:
            summary = dict(zip(["pass", "warn", "error", "skip", "no_op", "total"], map(int, sm.groups())))
        if msg.startswith("Batch "):
            continue
        nm = NODE_LINE_RE.match(msg)
        if nm:
            i, n, status, desc = int(nm.group(1)), int(nm.group(2)), nm.group(3), nm.group(4).strip()
            desc = re.sub(r"\s*\.{2,}.*$", "", desc).strip()
            if desc.startswith("hook:"):
                continue
            total = n
            if i not in idx:
                idx[i] = {"index": i, "status": status, "desc": desc}
            continue
        rm = RESULT_LINE_RE.match(msg)
        if rm and not rm.group(4).startswith("hook:"):
            i, n = int(rm.group(1)), int(rm.group(2))
            if i not in fallback:
                fallback[i] = {"index": i, "status": rm.group(3).split()[0], "desc": _result_desc(rm.group(3), rm.group(4)),
                               "from_result_line": True}
            if total is None:
                total = n
    for i, f in fallback.items():
        if i not in idx and (total is None or i <= total):
            idx[i] = f
    nodes = [idx[k] for k in sorted(idx)]
    return {"nodes": nodes, "total": total, "summary": summary,
            "complete": total is not None and len(nodes) == total}


def canon_desc(desc: str) -> str:
    """'sql view model dbt_adnane.x' / 'relation dbt_adnane.x' -> 'rel:dbt_adnane.x', 'test t' -> 'test:t' ..."""
    d = re.sub(r" due to .*$", "", desc.strip())   # "relation x due to ephemeral model status 'skipped'"
    if d.startswith("unit_test "):
        # START lines say "model::test", some SKIP lines only "test": keep the test name
        return "unit_test:" + d[10:].strip().split("::")[-1]
    if d.startswith("test "):
        return "test:" + d[5:].strip()
    if d.startswith("exposure "):
        return "exposure:" + d[9:].strip()
    if d.startswith("relation "):
        return "rel:" + d[9:].strip()
    if d.startswith("seed file "):
        return "rel:" + d[10:].strip()
    if d.startswith("snapshot "):
        return "rel:" + d[9:].strip()
    m = re.match(r"^(?:sql|python) (?:\w+ )*model (.+)$", d)
    if m:
        return "rel:" + m.group(1).strip()
    m = re.match(r"^clone (?:\w+ )*(.+)$", d)
    if m:
        return "rel:" + m.group(1).strip()
    return "other:" + d


# ----------------------------------------------------------------------------------------------- golden: dbt ls
def demo_note(t: dict) -> str | None:
    sec = (t.get("section") or "").lower()
    for w in ("demo", "throwaway", "temporar", "experiment", "revert", "trap", "mistake", "wrong", "error"):
        if w in sec:
            return f"section title mentions '{w}' (may be an intermediate state of the chapter)"
    return None


def build_ls_entries(trs: list[dict]) -> tuple[list[dict], list[dict]]:
    entries, excluded = [], []
    for t in trs:
        a = analyse_command(t["command"])
        if a is None or "problem" in (a or {}):
            continue
        cands = [d for d in a["dbts"] if d["sub"] in ("ls", "list") or d["sub"] in RUNLIKE]
        if not cands:
            continue
        reason = None
        if len(a["dbts"]) > 1:
            reason = "several dbt commands in one shell line (outputs are mixed)"
        d = cands[0]
        others_loud = [o for o in a["others"] if o["words"] and o["words"][0] not in SILENT_CMDS
                       and not (o["words"][0] == "echo" and any("exit code" in w for w in o["words"]))]
        if reason is None and d["pipe_out"]:
            pipe_to = None
            for o in a["others"]:
                if o["seg_index"] == d["seg_index"] + 2:
                    pipe_to = o["words"]
            if d["sub"] in ("ls", "list") and pipe_to and pipe_to[:2] == ["wc", "-l"] and len(a["dbts"]) == 1 \
                    and len(others_loud) == 1:
                pass  # count entry
            else:
                reason = f"output piped into {' '.join(pipe_to or ['?'])}"
        elif reason is None and others_loud:
            reason = "compound shell line with other commands that print output: " + \
                     ", ".join(" ".join(o["words"][:2]) for o in others_loud)
        out = t.get("output")
        if reason is None and t.get("output_ambiguous"):
            reason = "book: " + t["output_ambiguous"] + " (outputs mixed)"
        if reason is None and out is None:
            reason = "no output recorded"
        if reason is None and t["origin"] == "book" and not clean(out):
            # empty output is a real result only if another command of the same block shows its output inline
            if not t.get("block_has_inline_output"):
                reason = "book lab instruction (no output shown in the block)"
        if reason:
            excluded.append({"source": t["source"], "command": t["command"], "reason": reason})
            continue
        args = parse_args(d["args"])
        words = d["global"] + [d["sub"]] + d["args"]
        notes = []
        dn = demo_note(t)
        if dn:
            notes.append(dn)
        if t.get("output_from"):
            notes.append(f"output taken from the {t['output_from']}")
        if d["env"]:
            notes.append("environment: " + " ".join(f"{k}={v}" for k, v in d["env"].items()))
        lines = clean(out)
        echo_exit = [l for l in lines if re.fullmatch(r"exit code: \d+", l.strip())]
        if echo_exit:
            lines = [l for l in lines if not re.fullmatch(r"exit code: \d+", l.strip())]
            if t.get("exit_code") is None:
                t["exit_code"] = int(echo_exit[-1].split(":")[1])
        e = {
            "id": None,
            "source": t["source"],
            "origin": t["origin"],
            "section": t.get("section") or "",
            "project": t["project"],
            "tag": t["tag"],
            "command": t["command"],
            "dbt": "dbt " + " ".join(shlex.quote(w) for w in words),
            "kind": "ls" if d["sub"] in ("ls", "list") else d["sub"],
            "global_flags": d["global"],
            "args": args,
            "env": d["env"],
            "state_dependent": is_state_dependent(words),
        }
        if e["kind"] == "ls":
            p = parse_ls_output(lines)
            if d["pipe_out"]:
                cnt = [x for x in p["nodes"] if re.fullmatch(r"\d+", x)]
                e["output_format"] = "count"
                e["count"] = int(cnt[0]) if cnt else None
                e["selected"] = None
            else:
                e["output_format"] = args.get("output", "selector")
                if args.get("output_keys"):
                    e["output_keys"] = args["output_keys"]
                e["selected"] = p["nodes"]
                e["count"] = len(p["nodes"])
            e["partial"] = p["partial"]
            e["found_line"] = p["found_line"]
            e["warnings"] = [x for x in p["logs"] if not x.startswith(("Running with", "Registered adapter", "Found "))]
            e["error"] = p["error"]
            if not lines:
                notes.append("empty output (quiet mode prints nothing when nothing is selected)")
        else:
            p = parse_run_output(lines)
            if not p["nodes"]:
                excluded.append({"source": t["source"], "command": t["command"],
                                 "reason": f"dbt {d['sub']}: no 'N of M' node lines in the output"})
                continue
            if not (args.get("select") or args.get("exclude") or args.get("selector")
                    or args.get("resource_types") or args.get("exclude_resource_types")):
                notes.append("no selection flags (default selection)")
            e["output_format"] = "run_log"
            e["selected"] = [n["desc"] for n in p["nodes"]]
            e["statuses"] = [n["status"] for n in p["nodes"]]
            e["count"] = len(p["nodes"])
            e["total"] = p["total"]
            e["partial"] = not p["complete"]
            if not p["complete"]:
                notes.append("not every 'N of M' line is in the output (--fail-fast stop or elided log)")
            e["summary"] = p["summary"]
            e["selected_canon"] = sorted({canon_desc(n["desc"]) for n in p["nodes"]})
        e["exit_code"] = t.get("exit_code")
        e["notes"] = "; ".join(notes)
        entries.append(e)
    return entries, excluded


# ----------------------------------------------------------------------------------------------- golden: outputs
def trim_text(lines: list[str], keep: int = 400) -> tuple[str, int]:
    if len(lines) <= keep:
        return "\n".join(lines), 0
    return "\n".join(lines[-keep:]), len(lines) - keep


VERSION_CORE_RE = re.compile(r"installed:\s+(\S+)")
PLUGIN_RE = re.compile(r"^\s*-\s+(\w[\w-]*):\s+(\S+)")


def parse_version(lines: list[str]) -> dict | None:
    core = None
    latest = None
    plugins = {}
    in_plugins = False
    for l in lines:
        if "installed:" in l and core is None:
            m = VERSION_CORE_RE.search(l)
            core = m.group(1) if m else None
        if "latest:" in l and latest is None:
            latest = l.split("latest:", 1)[1].split()[0]
        if l.strip().startswith("Plugins:"):
            in_plugins = True
            continue
        if in_plugins:
            m = PLUGIN_RE.match(l)
            if m:
                plugins[m.group(1)] = m.group(2)
    if not core:
        return None
    return {"core_installed": core, "core_latest": latest, "plugins": plugins}


GITLOG_RE = re.compile(r"^([*|\\/ _]*)\s*([0-9a-f]{7,40})(?: \(([^)]*)\))? (.*)$")
GITSTATUS_SHORT_RE = re.compile(r"^([ MADRCU?!]{2}) (.+)$")


def build_outputs(trs: list[dict]) -> list[dict]:
    out = []
    for t in trs:
        lines = clean(t.get("output"))
        if not lines:
            continue
        cmd = t["command"]
        toks = tokenize(cmd) or []
        base = {"source": t["source"], "origin": t["origin"], "project": t.get("project"), "tag": t.get("tag"),
                "section": t.get("section") or "", "command": cmd}
        text, cut = trim_text(lines)
        # dbt summary
        summ = [SUMMARY_RE.search(l) for l in lines]
        summ = [m for m in summ if m]
        if summ:
            m = summ[-1]
            comp = [l for l in lines if "Completed successfully" in l or "Completed with" in l
                    or "Completed with warning" in l]
            fin = [l for l in lines if "Finished running" in l]
            nums = dict(zip(["pass", "warn", "error", "skip", "no_op", "total"], map(int, m.groups())))
            out.append({**base, "kind": "dbt_summary", "text": text, "truncated_head_lines": cut,
                        "expected": {**nums,
                                     "completed": (TS_RE.match(comp[-1]).group(2).strip() if comp and TS_RE.match(comp[-1]) else (comp[-1].strip() if comp else None)),
                                     "finished": (TS_RE.match(fin[-1]).group(2).strip() if fin and TS_RE.match(fin[-1]) else (fin[-1].strip() if fin else None)),
                                     "exit_code": t.get("exit_code")}})
        words = [w for w in toks if w not in ("|", "&&", ";")]
        if words[:2] == ["dbt", "--version"] or (words[:1] == ["dbt"] and "--version" in words[:3]):
            v = parse_version(lines)
            if v:
                out.append({**base, "kind": "dbt_version", "text": text, "truncated_head_lines": cut, "expected": v})
        if len(words) >= 2 and words[0] == "git" and words[1] == "log" and "--oneline" in words \
                and not any(x in toks for x in ("|", "&&", ";")):
            commits = []
            for l in lines:
                m = GITLOG_RE.match(l)
                if m:
                    refs = [r.strip() for r in m.group(3).split(",")] if m.group(3) else []
                    commits.append({"graph": m.group(1).rstrip() or None, "hash": m.group(2), "refs": refs,
                                    "subject": m.group(4)})
            if commits:
                out.append({**base, "kind": "git_log_oneline", "text": text, "truncated_head_lines": cut,
                            "expected": {"commits": commits, "graph": "--graph" in words}})
        if len(words) >= 2 and words[0] == "git" and words[1] == "status" \
                and not any(x in toks for x in ("|", "&&", ";")):
            short = "--short" in words or "-s" in words
            if short:
                files = []
                for l in lines:
                    m = GITSTATUS_SHORT_RE.match(l)
                    if m:
                        files.append({"xy": m.group(1), "path": m.group(2)})
                out.append({**base, "kind": "git_status_short", "text": text, "truncated_head_lines": cut,
                            "expected": {"files": files, "clean": not files}})
            else:
                joined = "\n".join(lines)
                branch = re.search(r"On branch (\S+)", joined)
                sections = [s for s in ("Changes to be committed", "Changes not staged for commit",
                                        "Untracked files", "Unmerged paths") if s in joined]
                files = re.findall(r"^\t(?:(new file|modified|deleted|renamed|both modified|both added):\s+)?(.+)$",
                                   joined, re.M)
                out.append({**base, "kind": "git_status", "text": text, "truncated_head_lines": cut,
                            "expected": {"branch": branch.group(1) if branch else None,
                                         "clean": "nothing to commit, working tree clean" in joined,
                                         "sections": sections,
                                         "files": [{"state": s or None, "path": p} for s, p in files]}})
    return out


# ----------------------------------------------------------------------------------------------- main
def main() -> int:
    trs = T.all_builder_logs() + T.all_capstone_logs()
    book = T.all_book()
    book_ch = [t for t in book if t.get("tag")]
    entries, excluded = build_ls_entries(trs + book_ch)
    # stable ids
    counters: Counter = Counter()
    for e in entries:
        pre = {"builder-log": "log", "capstone-log": "cap", "book": "book"}[e["origin"]]
        key = f"{pre}-{e['tag']}"
        counters[key] += 1
        e["id"] = f"{key}-{counters[key]:03d}"
    # keep verification results of an earlier golden_verify run (same id + same command)
    path = GOLDEN / "dbt-ls.json"
    if path.exists():
        old = {(o["id"], o["command"]): o.get("verification") for o in json.loads(path.read_text())}
        for e in entries:
            v = old.get((e["id"], e["command"]))
            if v:
                e["verification"] = v
    GOLDEN.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    outputs = build_outputs(trs + book)
    for i, o in enumerate(outputs, 1):
        o["id"] = f"out-{i:04d}"
    (GOLDEN / "outputs.json").write_text(json.dumps(outputs, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    rep = {
        "dbt_ls_entries": len(entries),
        "by_kind": dict(sorted(Counter(e["kind"] for e in entries).items())),
        "by_origin": dict(sorted(Counter(e["origin"] for e in entries).items())),
        "state_dependent": sum(1 for e in entries if e["state_dependent"]),
        "outputs": dict(sorted(Counter(o["kind"] for o in outputs).items())),
        "excluded": excluded,
    }
    (GOLDEN / "extract-report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in rep.items() if k != "excluded"}, indent=1))
    print("excluded:", len(excluded))
    return 0


if __name__ == "__main__":
    sys.exit(main())
