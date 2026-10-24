"""Pure-Python stand-in for dbt-extractor (the real one is a Rust/pyo3 extension with no wasm wheel).

Supports only what dbt needs to stay correct:
  - a source made of plain text and {{ ref(...) }} / {{ source(...) }} / {{ config(...) }} blocks with literal args
Anything else (control blocks, comments, filters, variables, non-literal args) raises ExtractionError, which makes
dbt fall back to full Jinja rendering (the static parser is also turned off by the runner, so models never rely on it).
Output format copied from dbt-extractor 0.6.0 (probed in the real env).
"""
import ast
import re

__all__ = ["ExtractionError", "py_extract_from_source"]


class ExtractionError(Exception):
    pass


_BLOCK = re.compile(r"\{\{(.*?)\}\}", re.S)


def _lit(node):
    try:
        return ast.literal_eval(node)
    except Exception:
        raise ExtractionError("Source Error: non-literal argument")


def py_extract_from_source(source):
    if "{%" in source or "{#" in source:
        raise ExtractionError("Source Error: Syntax error in source")
    rest = _BLOCK.sub("", source)
    if "{{" in rest or "}}" in rest:
        raise ExtractionError("Source Error: Syntax error in source")
    refs, sources, configs = [], set(), []
    for m in _BLOCK.finditer(source):
        expr = m.group(1).strip()
        try:
            tree = ast.parse(expr, mode="eval").body
        except SyntaxError:
            raise ExtractionError("Source Error: Syntax error in source")
        if not (isinstance(tree, ast.Call) and isinstance(tree.func, ast.Name)):
            raise ExtractionError("Source Error: Syntax error in source")
        fn = tree.func.id
        args = [_lit(a) for a in tree.args]
        kwargs = {k.arg: _lit(k.value) for k in tree.keywords if k.arg is not None}
        if any(k.arg is None for k in tree.keywords):
            raise ExtractionError("Source Error: **kwargs not supported")
        if fn == "ref":
            if not (1 <= len(args) <= 2) or not all(isinstance(a, str) for a in args):
                raise ExtractionError("Source Error: bad ref")
            r = {"name": args[-1]}
            if len(args) == 2:
                r["package"] = args[0]
            v = kwargs.pop("version", kwargs.pop("v", None))
            if kwargs:
                raise ExtractionError("Source Error: bad ref kwargs")
            if v is not None:
                r["version"] = v
            refs.append(r)
        elif fn == "source":
            if len(args) != 2 or kwargs or not all(isinstance(a, str) for a in args):
                raise ExtractionError("Source Error: bad source")
            sources.add((args[0], args[1]))
        elif fn == "config":
            if args:
                raise ExtractionError("Source Error: positional config args")
            configs.extend(kwargs.items())
        else:
            raise ExtractionError("Source Error: unsupported call " + fn)
    return {"refs": refs, "sources": sources, "configs": configs}
