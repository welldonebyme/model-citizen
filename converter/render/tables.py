"""tabular / tabularx / longtable -> {t:"table"} (booktabs rules, \\multicolumn, longtable heads)."""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..tex.nodes import Cmd, Env, Group, Par, Space, Special, Text
from ..tex.parser import Parser
from ..tex.nodes import Source


@dataclass
class Col:
    align: str      # l | c | r
    mono: bool = False


def parse_colspec(spec: str, where: str) -> list[Col]:
    """l c r L X p{..} m{..} b{..} with >{..} prefixes, @{..}, | and *{n}{..}."""
    cols: list[Col] = []
    i = 0
    pending_pre = ""

    def group_at(j: int) -> tuple[str, int]:
        if j >= len(spec) or spec[j] != "{":
            raise ValueError(f"{where}: bad column spec {spec!r}")
        depth = 0
        for k in range(j, len(spec)):
            if spec[k] == "{":
                depth += 1
            elif spec[k] == "}":
                depth -= 1
                if depth == 0:
                    return spec[j + 1:k], k + 1
        raise ValueError(f"{where}: unbalanced column spec {spec!r}")

    while i < len(spec):
        c = spec[i]
        if c.isspace() or c == "|":
            i += 1
        elif c == "@":
            _, i = group_at(i + 1)
        elif c == ">":
            pending_pre, i = group_at(i + 1)
        elif c == "<":
            _, i = group_at(i + 1)
        elif c == "*":
            n, j = group_at(i + 1)
            body, j = group_at(j)
            spec = spec[:i] + body * int(n) + spec[j:]
        elif c in "lcrLX":
            align = {"l": "l", "c": "c", "r": "r", "L": "l", "X": "l"}[c]
            align, mono = _pre(pending_pre, align, where)
            cols.append(Col(align, mono))
            pending_pre = ""
            i += 1
        elif c in "pmb":
            _, i = group_at(i + 1)
            align, mono = _pre(pending_pre, "l", where)
            cols.append(Col(align, mono))
            pending_pre = ""
        else:
            raise ValueError(f"{where}: unsupported column type {c!r} in {spec!r}")
    return cols


def _pre(pre: str, align: str, where: str) -> tuple[str, bool]:
    mono = False
    for m in re.findall(r"\\[A-Za-z]+", pre):
        if m == "\\centering":
            align = "c"
        elif m == "\\raggedleft":
            align = "r"
        elif m == "\\raggedright":
            align = "l"
        elif m == "\\ttfamily":
            mono = True
        elif m == "\\arraybackslash":
            pass
        else:
            raise ValueError(f"{where}: unsupported column declaration {m} in >{{{pre}}}")
    return align, mono


RULES = {"toprule", "midrule", "bottomrule", "hline"}


class TableRenderer:
    """Splits the environment body into rows/cells; cell contents are rendered by the block renderer."""

    def __init__(self, blocks):
        self.blocks = blocks          # BlockRenderer
        self.ctx = blocks.ctx

    def render(self, env: Env) -> dict:
        ctx = self.ctx
        spec = env.args[-1].raw
        try:
            cols = parse_colspec(spec, env.where())
        except ValueError as e:
            ctx.error(env, str(e))
        items = self.split(env)
        # items: ("rule", name) | ("mark", name) | ("row", [cells as node lists]) ; build structure
        head_rows: list = []
        body: list = []
        rules: list[int] = []
        has_mark = any(k == "mark" for k, _ in items)
        if has_mark:
            marks = [v for k, v in items if k == "mark"]
            section = "head"
            for k, v in items:
                if k == "mark":
                    section = "cont" if v == "endfirsthead" else "body"
                elif k == "row":
                    if section == "head":
                        head_rows.append(v)
                    elif section == "body":
                        body.append(v)
                    else:
                        ctx.stats["table:continuation-head-rows-dropped"] += 1
                elif k == "rule" and section == "body" and body and v in ("midrule", "hline"):
                    rules.append(len(body))
            if "endhead" not in marks:
                ctx.error(env, "longtable with \\endfirsthead but no \\endhead")
        else:
            rows_only = [v for k, v in items if k == "row"]
            seq = [(k, v) for k, v in items if k in ("row", "rule")]
            first_rule_before_rows = seq and seq[0][0] == "rule"
            top = seq[0][1] if first_rule_before_rows else None
            # booktabs: \toprule head \midrule body
            if top == "toprule":
                idx = next((i for i, (k, v) in enumerate(seq) if k == "rule" and v == "midrule"), None)
                n_before = sum(1 for k, _ in seq[:idx] if k == "row") if idx is not None else 0
                if idx is not None and n_before >= 1:
                    head_rows = [v for k, v in seq[:idx] if k == "row"]
                    rest = seq[idx + 1:]
                else:
                    rest = seq[1:]
            elif top is None and len(seq) >= 2 and seq[0][0] == "row" and seq[1] == ("rule", "hline") \
                    and sum(1 for k, v in seq if k == "rule") == 1:
                head_rows = [seq[0][1]]
                rest = seq[2:]
            else:
                rest = seq[1:] if first_rule_before_rows else seq
            for k, v in rest:
                if k == "row":
                    body.append(v)
                elif v in ("midrule", "hline") and body and k == "rule":
                    rules.append(len(body))
            del rows_only
        # drop rules that only close the table
        rules = sorted({r for r in rules if r < len(body)})
        head = [self.row(r, cols, env, header=True) for r in head_rows]
        rows = [self.row(r, cols, env, header=False) for r in body]
        ncols = len(cols)
        group_rows = [i for i, r in enumerate(rows)
                      if len(r) == 1 and r[0].get("colspan") == ncols and ncols > 1]
        out: dict = {"t": "table", "rows": rows}
        if head:
            out["head"] = head
        if group_rows:
            out["groupRows"] = group_rows
        if rules:
            out["rules"] = rules
        ctx.stats["env:" + env.name] += 1
        return out

    def split(self, env: Env) -> list:
        items: list = []
        row: list = []
        cell: list = []

        def end_cell():
            nonlocal cell
            row.append(cell)
            cell = []

        def end_row(force: bool):
            nonlocal row, cell
            end_cell()
            if force or any(_significant(c) for c in row):
                items.append(("row", row))
            row = []

        for n in env.children:
            if isinstance(n, Cmd) and n.name in RULES:
                if _significant_cells(row, cell):
                    self.ctx.error(n, f"\\{n.name} in the middle of a row")
                row, cell = [], []
                items.append(("rule", n.name))
            elif isinstance(n, Cmd) and n.name in ("endhead", "endfirsthead"):
                if _significant_cells(row, cell):
                    self.ctx.error(n, f"\\{n.name} in the middle of a row")
                row, cell = [], []
                items.append(("mark", n.name))
            elif isinstance(n, Special) and n.ch == "&":
                end_cell()
            elif isinstance(n, Cmd) and n.name == "\\":
                end_row(True)
            else:
                cell.append(n)
        if _significant_cells(row, cell):
            end_row(False)
        return items

    def row(self, cells: list, cols: list[Col], env: Env, header: bool) -> list[dict]:
        out = []
        ci = 0
        for nodes in cells:
            nodes = _strip(nodes)
            colspan = 1
            align = cols[ci].align if ci < len(cols) else "l"
            mono = cols[ci].mono if ci < len(cols) else False
            mc = [n for n in nodes if isinstance(n, Cmd) and n.name == "multicolumn"]
            if mc:
                if len(nodes) != 1:
                    self.ctx.error(mc[0], "\\multicolumn must be the whole cell")
                m = mc[0]
                colspan = int(m.args[0].raw.strip())
                sub = parse_colspec(m.args[1].raw, m.where())
                align = sub[0].align if sub else "l"
                mono = sub[0].mono if sub else False
                nodes = m.args[2].nodes
            if ci >= len(cols):
                self.ctx.error(env, f"row has more cells than columns ({len(cols)})")
            content = self.blocks.cell(nodes, mono)
            cell: dict = {"c": content}
            if colspan > 1:
                cell["colspan"] = colspan
            if align != "l":
                cell["align"] = align
            if header:
                cell["header"] = True
            out.append(cell)
            ci += colspan
        return out


def _significant(nodes: list) -> bool:
    return any(not isinstance(n, (Space, Par)) for n in nodes)


def _significant_cells(row: list, cell: list) -> bool:
    return any(_significant(c) for c in row) or _significant(cell)


def _strip(nodes: list) -> list:
    while nodes and isinstance(nodes[0], (Space, Par)):
        nodes = nodes[1:]
    while nodes and isinstance(nodes[-1], (Space, Par)):
        nodes = nodes[:-1]
    return nodes
