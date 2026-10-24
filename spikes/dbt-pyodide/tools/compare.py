"""Compare dbt outputs captured in Pyodide with the golden builder logs.

  python3 tools/compare.py <golden chNN.md> <spike log> [--show-diff]

Golden blocks: ```bash\n$ dbt ...\n``` followed by ```text ... ```. Spike log: "$ dbt ..." ... "[spike] success=".
Normalisation (only what the brief allows to differ): timestamps, durations, the "N of M" start index and the dot
padding that depends on it, home folder, thread interleaving (lines compared as a multiset; order reported apart).
"""
import re
import sys
from collections import Counter


def golden_blocks(path):
    text = open(path).read()
    out = []
    for m in re.finditer(r"```bash\n\$ (dbt [^\n]*)\n```\n```text\n(.*?)```", text, re.S):
        out.append((m.group(1).strip(), m.group(2).rstrip("\n").split("\n")))
    return out


def spike_blocks(path):
    out, cur, lines = [], None, []
    for line in open(path).read().split("\n"):
        if line.startswith("$ dbt "):
            cur, lines = line[2:].strip(), []
        elif line.startswith("[spike] success=") and cur:
            out.append((cur, lines, line))
            cur = None
        elif cur is not None:
            if line.startswith("dbtRunner exception:"):
                cur_exc = True
            lines.append(line)
    return out


TS = re.compile(r"^\d\d:\d\d:\d\d  ")
def norm(line):
    line = TS.sub("", line)
    line = re.sub(r" in \d+\.\d+s\]", " in Ns]", line)
    line = re.sub(r"in 0 hours \d+ minutes and \d+\.\d+ seconds \(\d+\.\d+s\)", "in T", line)
    line = re.sub(r"^\d+ of (\d+) ", r"# of \1 ", line)
    line = re.sub(r" \.{3,} ", " ... ", line)
    line = line.replace("/home/pyodide", "/Users/adnane")
    # the order of the items in the "Found ..." line depends on partial-parse state, not on the engine
    m = re.match(r"^Found (.*)$", line)
    if m:
        line = "Found " + ", ".join(sorted(m.group(1).split(", ")))
    return line.rstrip()


def main():
    golden, spike = golden_blocks(sys.argv[1]), spike_blocks(sys.argv[2])
    show = "--show-diff" in sys.argv
    used = set()
    total_ok = 0
    for cmd, lines, status in spike:
        idx = next((i for i, (c, _) in enumerate(golden) if c == cmd and i not in used), None)
        if idx is None:
            print(f"?? {cmd!r}: no golden block with this exact command")
            continue
        used.add(idx)
        g = [norm(l) for l in golden[idx][1] if norm(l) != ""]
        s = [norm(l) for l in lines if norm(l) != ""]
        cg, cs = Counter(g), Counter(s)
        only_g, only_s = cg - cs, cs - cg
        same_set = not only_g and not only_s
        same_order = g == s
        total_ok += same_set
        tag = "MATCH" if same_set else "DIFF "
        print(f"{tag} {'(same order)' if same_order else '(order differs)' if same_set else ''} {cmd}")
        if not same_set:
            for l in only_g.elements():
                print("     golden only:", l[:200])
            for l in only_s.elements():
                print("     spike  only:", l[:200])
    print(f"== {total_ok}/{len(spike)} commands match the golden output (multiset of normalised lines)")


main()
