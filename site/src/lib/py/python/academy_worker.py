"""Glue between the Web Worker (JavaScript) and dbt_jinja / dbt_yaml. Every call takes and returns JSON text.

From spikes/pyodide/site/py/academy_worker.py, plus `models()` (the project's models with their relation
names, used to create the models of the Chapter 11 project in DuckDB-WASM) and a pinned locale.
"""
import copy
import json
import os
import time

# messages and number formatting must not depend on the learner's computer (the worker gets LANG/LC_ALL too)
os.environ["LANG"] = "en_US.UTF-8"
os.environ["LC_ALL"] = "en_US.UTF-8"

import dbt_jinja
import dbt_yaml

_fixtures = {}
_engines = {}  # (fixture, target) -> DbtJinja without per-request macro overrides
_live = {}     # request id -> engine kept alive while the worker answers PendingQuery round trips


def load_fixture(name, text):
    _fixtures[name] = json.loads(text)
    return len(_fixtures[name].get("macro_files", {}))


def _engine_for(req):
    fixture, target = req.get("project", "ch11"), req.get("target")
    extra_models, extra_macros = req.get("extra_models"), req.get("extra_macro_files")
    if not extra_models and not extra_macros:
        key = (fixture, target)
        if key not in _engines:
            p = copy.deepcopy(_fixtures[fixture])
            if target:
                p["target"] = target
            _engines[key] = dbt_jinja.DbtJinja(p)
        return _engines[key]
    p = copy.deepcopy(_fixtures[fixture])
    if target:
        p["target"] = target
    p.setdefault("models", {}).update(extra_models or {})
    for path, src in (extra_macros or {}).items():
        p.setdefault("macro_files", {})[path] = {"package": p["name"], "source": src}
    return dbt_jinja.DbtJinja(p)


def render(req_json):
    req = json.loads(req_json)
    t0 = time.perf_counter()
    deadline = (req.get("deadlineMs") or 0) / 1000 or None
    try:
        if req.get("mode") == "plain":
            res = dbt_jinja.render_plain(req["template"], deadline_s=deadline)
        else:
            rid = req["id"]
            eng = _live.get(rid)
            if eng is None:
                try:
                    eng = _engine_for(req)
                except dbt_jinja.DbtCompilationError as e:
                    return json.dumps({"status": "error", "error": {"phase": "load", "message": e.msg}})
                eng.query_results = dict(req.get("query_results") or {})  # fresh cache per request
                _live[rid] = eng
            node = req.get("node") or {"name": "inline_query", "resource_type": "sql_operation"}
            res = eng.compile(req["template"], name=node["name"], resource_type=node["resource_type"],
                              path=node.get("path"), passes=tuple(req.get("passes") or ("parse", "execute")),
                              deadline_s=deadline)
            if res["status"] != "need_query":
                _live.pop(rid, None)
    except dbt_jinja.RenderTimeout as e:
        _live.pop(req.get("id"), None)
        res = {"status": "timeout", "soft": True, "error": {"message": str(e)}}
    except KeyboardInterrupt:  # SharedArrayBuffer interrupt from the main thread (cross-origin isolated pages only)
        _live.pop(req.get("id"), None)
        res = {"status": "cancelled", "error": {"message": "interrupted (KeyboardInterrupt)"}}
    except RecursionError as e:
        _live.pop(req.get("id"), None)
        res = {"status": "error", "error": {"kind": "recursion", "message": f"RecursionError: {e}"}}
    res["python_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    return json.dumps(res, default=str)


def add_query_result(rid, sql, answer_json):
    a = json.loads(answer_json)
    _live[rid].add_query_result(sql, a["columns"], a["rows"])


def drop(rid):
    _live.pop(rid, None)


def validate(req_json):
    req = json.loads(req_json)
    t0 = time.perf_counter()
    render = None
    if req.get("engine", "dbt") == "dbt" and req.get("project", "ch05") in _fixtures:
        eng = _engine_for({"project": req.get("project", "ch05"), "target": req.get("target")})
        render = lambda s: eng.compile(s, passes=("execute",))["compiled"]  # noqa: E731  (Jinja in config values)
    res = dbt_yaml.validate(req["text"], engine=req.get("engine", "dbt"), filename=req.get("filename"),
                            path=req.get("path"), project=req.get("project_name", "my_project"), render=render)
    if req.get("exprs") and res.get("ok"):
        # what Python prints for parts of the loaded data, e.g. data['models'][0]['config'] (exercises, parity).
        # The expressions come from the site's own exercise/case files, never from the learner.
        data = _loaded_data(req)
        out = []
        for e in req["exprs"]:
            try:
                v = eval(e["expr"], {"__builtins__": {"list": list}}, {"data": data})  # noqa: S307
                out.append({"expr": e["expr"], "text": str(v) if e.get("print") else repr(v)})
            except Exception as ex:  # noqa: BLE001
                out.append({"expr": e["expr"], "error": f"{type(ex).__name__}: {ex}"})
        res["values"] = out
    res["python_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    return json.dumps(res, default=str)


def _loaded_data(req):
    """The Python object of a valid file, as the engine loaded it (not the JSON copy: keeps tuples, ints...)."""
    import yaml
    if req.get("engine", "dbt") == "pyyaml":
        return yaml.safe_load(req["text"])
    return yaml.load(req["text"].strip(), Loader=dbt_yaml._make_checked_loader([]))


def models(req_json):
    """Every model of a project fixture: name, path, materialization, relation (as ref() renders it), raw code."""
    req = json.loads(req_json)
    eng = _engine_for({"project": req.get("project", "ch11"), "target": req.get("target")})
    state = {"logs": [], "refs": [], "sources": [], "config": {}, "stored": {}}
    node = {"name": "describe_models", "resource_type": "sql_operation", "materialized": "view",
            "path": "describe_models.sql", "describe": "SQL operation 'describe_models'"}
    ctx = eng._context(node, state, True)
    out = []
    for name, m in eng.models.items():
        rel = eng._model_relation(name, ctx)
        out.append({"name": name, "path": m.get("path"), "materialized": m.get("materialized", "view"),
                    "relation": str(rel), "database": rel.database, "schema": rel.schema,
                    "identifier": rel.identifier, "raw_code": m.get("raw_code", "")})
    return json.dumps({"status": "ok", "project": eng.name, "target": eng.target_name, "models": out})
