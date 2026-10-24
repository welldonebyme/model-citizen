"""Key=value option lists (tcolorbox / listings / enumitem), parsed without guessing."""
from __future__ import annotations

from ..tex.nodes import ConvertError


def split_top(s: str, sep: str = ",") -> list[str]:
    """Split on sep at brace depth 0."""
    parts, depth, cur = [], 0, []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            cur.append(s[i:i + 2])
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        if c == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def strip_braces(v: str) -> str:
    v = v.strip()
    while v.startswith("{") and v.endswith("}") and _balanced_outer(v):
        v = v[1:-1].strip()
    return v


def _balanced_outer(v: str) -> bool:
    depth = 0
    for i, c in enumerate(v):
        if c == "{" and (i == 0 or v[i - 1] != "\\"):
            depth += 1
        elif c == "}" and (i == 0 or v[i - 1] != "\\"):
            depth -= 1
            if depth == 0 and i != len(v) - 1:
                return False
    return depth == 0


def keyvals(s: str, where: str) -> list[tuple[str, str | None]]:
    """"a=1,b={x,y},flag" -> [("a","1"),("b","{x,y}"),("flag",None)] (values keep their braces)."""
    out = []
    for part in split_top(s):
        if "=" in part:
            k, v = part.split("=", 1)
            out.append((k.strip(), v.strip()))
        else:
            out.append((part.strip(), None))
    for k, _ in out:
        if not k:
            raise ConvertError(f"{where}: empty option key in [{s}]")
    return out
