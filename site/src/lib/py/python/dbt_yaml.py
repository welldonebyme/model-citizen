"""dbt_yaml: YAML validation for the dbt-academy playground (runs in Pyodide and in CPython).

Two engines, matching the two kinds of messages the book shows:

* ``pyyaml`` -- ``yaml.safe_load`` with the pure-Python ``SafeLoader``: the book's lab command
  ``python -c "import yaml; yaml.safe_load(open('broken.yml'))"``. Words like
  "mapping values are not allowed here".
* ``dbt``    -- what dbt-core 1.11 does (dbt/clients/checked_load.py + yaml_helper.py): libyaml's
  ``CSafeLoader`` ("mapping values are not allowed in this context"), the duplicate-key deprecation,
  the "Syntax error near line N" context, plus a *small* imitation of dbt's shape check
  (``config`` must be a mapping, ``columns`` a list...). The shape check is an approximation.

Everything returned is JSON-friendly (dicts, lists, str, int, bool, None).
"""
import collections.abc
import io
import textwrap

import yaml

try:  # libyaml bindings: present in Pyodide's pyyaml 6.0.3 and in the PyPI wheels
    from yaml import CSafeLoader as _CSafeLoader

    HAS_LIBYAML = True
except ImportError:  # pragma: no cover
    _CSafeLoader = yaml.SafeLoader
    HAS_LIBYAML = False

PRINTER_WIDTH = 80

try:
    import yaml._yaml as _cyaml

    LIBYAML_VERSION = _cyaml.get_version()  # Pyodide 314.0.7: (0, 1, 7); PyPI wheels: (0, 2, 5)
except Exception:  # pragma: no cover
    LIBYAML_VERSION = None

# libyaml < 0.2.3 has a typo that 0.2.5 (the version dbt users get from PyPI) fixed.
# Found by a differential fuzz (3000 mutants of the book's files): this is the only wording difference.
_OLD_LIBYAML_WORDING = {
    "found a tab character that violate indentation": "found a tab character that violates indentation",
}


def _modernize(e):
    """Make libyaml 0.1.7 messages read like libyaml 0.2.5. Returns True when something was changed."""
    if not LIBYAML_VERSION or LIBYAML_VERSION >= (0, 2, 3):
        return False
    changed = False
    for attr in ("problem", "context"):
        v = getattr(e, attr, None)
        if v in _OLD_LIBYAML_WORDING:
            setattr(e, attr, _OLD_LIBYAML_WORDING[v])
            changed = True
    return changed


# --------------------------------------------------------------------------- helpers
def _mark(m):
    if m is None:
        return None
    return {"line": m.line + 1, "column": m.column + 1, "index": m.index}


def _error_info(e):
    info = {
        "type": f"{type(e).__module__}.{type(e).__name__}",
        "message": str(e),
        "context": getattr(e, "context", None),
        "problem": getattr(e, "problem", None),
        "context_mark": _mark(getattr(e, "context_mark", None)),
        "problem_mark": _mark(getattr(e, "problem_mark", None)),
    }
    # what a Python traceback prints on its last lines
    info["traceback_tail"] = f"{info['type']}: {info['message']}"
    return info


def to_jsonable(obj):
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(v) for v in obj]
    return repr(obj)


# --------------------------------------------------------------------------- engine: pyyaml
def load_pyyaml(text, filename=None):
    """yaml.safe_load(text) -- or yaml.safe_load(open(filename)) when a filename is given.

    With a file object PyYAML names the stream after the file ('in "broken.yml"') and prints no
    snippet, exactly like the book's lab. With a str it says '"<unicode string>"' plus a snippet.
    """
    stream = text
    if filename:
        stream = io.StringIO(text)
        stream.name = filename
    try:
        data = yaml.safe_load(stream)
    except yaml.YAMLError as e:
        return {"ok": False, "engine": "pyyaml", "error": _error_info(e)}
    return {"ok": True, "engine": "pyyaml", "data": data}


# --------------------------------------------------------------------------- engine: dbt
_YAML_ERROR_MESSAGE = (
    "Syntax error near line {line_number}\n"
    "------------------------------\n"
    "{nice_error}\n\n"
    "Raw Error:\n"
    "------------------------------\n"
    "{raw_error}"
)


def _line_no(i, line, width=3):
    return "{}| {}".format(str(i).ljust(width), line)


def contextualized_yaml_error(raw_contents, error):
    """Same layout as dbt-core 1.11 yaml_helper.contextualized_yaml_error."""
    mark = error.problem_mark
    lo, hi = max(mark.line - 3, 0), mark.line + 4
    lines = raw_contents.split("\n")
    nice = "\n".join(_line_no(i + 1, l) for i, l in zip(range(lo, hi), lines[lo:hi]))
    return _YAML_ERROR_MESSAGE.format(line_number=mark.line + 1, nice_error=nice, raw_error=error)


def _make_checked_loader(failures):
    class CheckedLoader(_CSafeLoader):
        def construct_mapping(self, node, deep=False):
            if not isinstance(node, yaml.MappingNode):
                raise yaml.constructor.ConstructorError(
                    None, None, "expected a mapping node, but found %s" % node.id, node.start_mark)
            is_override = (len(node.value) > 0 and len(node.value[0]) > 0
                           and getattr(node.value[0][0], "value") == "<<")
            self.flatten_mapping(node)
            mapping = {}
            for key_node, value_node in node.value:
                key = self.construct_object(key_node, deep=deep)
                if not isinstance(key, collections.abc.Hashable):
                    raise yaml.constructor.ConstructorError(
                        "while constructing a mapping", node.start_mark,
                        "found unhashable key", key_node.start_mark)
                value = self.construct_object(value_node, deep=deep)
                if not is_override and key in mapping:
                    sm = str(key_node.start_mark)
                    where = sm.lstrip() if sm.startswith("  in") else f"at {key_node.start_mark}"
                    failures.append({
                        "kind": "duplicate_key", "key": str(key),
                        "line": key_node.start_mark.line + 1, "column": key_node.start_mark.column + 1,
                        "message": f"Duplicate key '{key}' {where}",
                    })
                mapping[key] = value
            return mapping

    CheckedLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
                                  CheckedLoader.construct_mapping)
    return CheckedLoader


def _wrap(msg):
    chunks = textwrap.dedent(msg).split("\n\n")
    return "\n".join(textwrap.fill(c, width=PRINTER_WIDTH, break_on_hyphens=False) for c in chunks)


def _deprecation(event, msg):
    return _wrap(f"[WARNING][{event}]: Deprecated functionality\n\n{msg}")


def _indent(text, n):
    pad = " " * n
    return "\n".join(pad + l for l in text.split("\n"))


_SHAPES = {  # (yaml key of the list, property) -> expected JSON type
    "config": "object", "columns": "array", "data_tests": "array", "tests": "array",
    "tables": "array", "meta": "object", "constraints": "array",
}
_PY_TYPE = {"object": dict, "array": list}


def _render_simple_jinja(value, render):
    if render is None:
        return value
    if isinstance(value, str) and ("{{" in value or "{%" in value):
        try:
            return render(value)
        except Exception:  # keep the raw text when rendering fails
            return value
    if isinstance(value, dict):
        return {k: _render_simple_jinja(v, render) for k, v in value.items()}
    if isinstance(value, list):
        return [_render_simple_jinja(v, render) for v in value]
    return value


def _shape_errors(data, path, project, render=None):
    """Very small subset of dbt's JSON-schema validation of properties files (approximation)."""
    errors = []
    if not isinstance(data, dict):
        return errors
    for yaml_key in ("models", "sources", "seeds", "snapshots", "analyses", "macros"):
        entries = data.get(yaml_key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            for prop, kind in _SHAPES.items():
                if prop in entry and not isinstance(entry[prop], _PY_TYPE[kind]):
                    shown = dict(entry)
                    if "config" in shown:
                        shown["config"] = _render_simple_jinja(shown["config"], render)
                    shown.update({"original_file_path": path, "yaml_key": yaml_key, "package_name": project})
                    bad = shown.get(prop, entry[prop])
                    errors.append({
                        "kind": "shape", "property": prop,
                        "message": (f"Invalid {yaml_key} config given in {path} @ {yaml_key}: {shown!r} - "
                                    f"at path [{prop!r}]: {bad!r} is not of type {kind!r}"),
                    })
                    return errors  # dbt stops at the first invalid entry
    return errors


def load_dbt(text, path="models/schema.yml", project="my_project", render=None):
    """Imitates `dbt parse` reading one properties file.

    path: the file path relative to the project root (e.g. 'models/staging/_stg_models.yml').
    render: optional callable(str)->str used to render Jinja in config values (shape messages only).
    """
    failures = []
    rel_models = path[len("models/"):] if path.startswith("models/") else path
    full_path = path if path.startswith("models/") else "models/" + path
    # dbt reads files with load_file_contents(strip=True): leading blank lines are removed, so
    # dbt's line numbers are shifted by `line_offset` compared with the learner's editor.
    line_offset = text[: len(text) - len(text.lstrip())].count("\n")
    text = text.strip()
    try:
        data = yaml.load(text, Loader=_make_checked_loader(failures))
    except yaml.YAMLError as e:
        patched = _modernize(e)
        info = _error_info(e)
        info["line_offset"] = line_offset
        info["wording_patched"] = patched
        if getattr(e, "problem_mark", None) is not None:
            body = contextualized_yaml_error(text, e)
        else:
            body = str(e)
        info["dbt_message"] = ("Parsing Error\n"
                               f"  Error reading {project}: {rel_models} - Runtime Error\n"
                               + _indent(body, 4))
        return {"ok": False, "engine": "dbt", "error": info, "warnings": []}
    warnings = []
    for f in failures:
        warnings.append({**f, "dbt_message": _deprecation("DuplicateYAMLKeysDeprecation",
                                                          f"{f['message']} in file `{full_path}`")})
    shape = _shape_errors(data, full_path, project, render=render)
    if shape:
        err = {"type": "dbt.ParsingError", "message": shape[0]["message"], "problem_mark": None,
               "context_mark": None, "dbt_message": "Parsing Error\n  " + shape[0]["message"]}
        return {"ok": False, "engine": "dbt", "error": err, "warnings": warnings, "data": data}
    return {"ok": True, "engine": "dbt", "data": data, "warnings": warnings}


# --------------------------------------------------------------------------- public entry point
def validate(text, engine="dbt", filename=None, path=None, project="my_project", render=None):
    if engine == "pyyaml":
        res = load_pyyaml(text, filename=filename)
    elif engine == "dbt":
        res = load_dbt(text, path=path or (filename and "models/" + filename) or "models/schema.yml",
                       project=project, render=render)
    else:
        raise ValueError(f"unknown engine {engine!r}")
    if "data" in res:
        res["repr"] = repr(res["data"])
        res["data"] = to_jsonable(res["data"])
    res["libyaml"] = HAS_LIBYAML
    res["libyaml_version"] = ".".join(map(str, LIBYAML_VERSION)) if LIBYAML_VERSION else None
    res["pyyaml_version"] = yaml.__version__
    return res
