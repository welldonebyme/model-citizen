"""Run the frozen Jinja cases through dbt_jinja and compare with the book. Same code in CPython and Pyodide.

run(cases_json, fixtures_json, replay_json=None, query_fn=None) -> results_json
  replay_json: recorded query results {case_id: {sql: [columns, rows]}} (used in Pyodide: no DB there)
  query_fn:    a synchronous executor (native run with duckdb); the results are then recorded
"""
import copy
import json
import sys

import dbt_jinja
from compare import compare


def _engine(c, fixtures):
    project = copy.deepcopy(fixtures[c.get("project", "ch11")])
    if c.get("target"):
        project["target"] = c["target"]
    project.setdefault("models", {}).update(c.get("extra_models") or {})
    for path, src in (c.get("extra_macro_files") or {}).items():
        project.setdefault("macro_files", {})[path] = {"package": project["name"], "source": src}
    return dbt_jinja.DbtJinja(project)


def run_case(c, fixtures, replay=None, query_fn=None, deadline_s=None):
    e = c["expect"]
    rec = {}
    if c["mode"] == "plain":
        res = dbt_jinja.render_plain(c["template"], deadline_s=deadline_s)
    else:
        try:
            eng = _engine(c, fixtures)
        except dbt_jinja.DbtCompilationError as err:
            res = {"status": "error", "compiled": None, "logs": [], "parse_refs": [],
                   "error": {"phase": "load", "kind": "compilation", "message": err.msg,
                             "dbt_message": "Compilation Error\n  " + err.msg.replace("\n", "\n  ")}}
        else:
            if replay and c["id"] in replay:
                for sql, (cols, rows) in replay[c["id"]].items():
                    eng.add_query_result(sql, cols, rows)
            eng.query_fn = query_fn
            n = c["node"]
            res = eng.compile(c["template"], name=n["name"], resource_type=n["resource_type"], path=n.get("path"),
                              passes=tuple(c.get("passes") or ("parse", "execute")), deadline_s=deadline_s)
            rec = {k: v for k, v in eng.query_results.items()}
    err = res.get("error")
    got_text, book_text, match, passed = res.get("compiled"), None, None, False
    kind = e["kind"]
    if res.get("status") == "need_query":
        got_text = f"(needs a database: {res['pending_sql'][:80]}...)"
    if kind == "compiled":
        book_text = e["book"]
        mode = {"equal": "equal", "ws": "equal", "within": "within", "segments": "segments"}[e["cmp"]]
        match = compare(book_text, got_text, mode)
        passed = match["ws"] if e["cmp"] in ("ws", "segments", "within") else match["lines"]
    elif kind == "error":
        msg = (err or {}).get("message") or ""
        book_text = " / ".join(e["phrases"])
        got_text = msg
        passed = bool(err) and all(p in msg for p in e["phrases"]) and (
            "phase" not in e or err.get("phase") == e["phase"])
        if e.get("cmp_block") and err:
            match = compare(e["cmp_block"], err.get("dbt_message"), "within")
    elif kind == "logs":
        book_text = "\n".join(e["book"])
        got_lines = [l["msg"] for l in res.get("logs", []) if l["info"]]
        got_text = "\n".join(got_lines)
        match = compare(book_text, got_text)
        passed = match["lines"]
        if "compiled" in e:
            m2 = compare(e["compiled"], res.get("compiled"))
            passed = passed and m2["lines"]
            got_text += "\n--- compiled ---\n" + str(res.get("compiled"))
            book_text += "\n--- compiled ---\n" + e["compiled"]
    elif kind == "parents":
        parents = sorted({r["name"] for r in res.get("parse_refs", [])})
        book_text, got_text = ", ".join(e["book"]), ", ".join(parents)
        passed = parents == sorted(e["book"]) and e["compiled_contains"] in (res.get("compiled") or "")
        match = {"exact": passed, "lines": passed, "ws": passed}
    elif kind == "real_only":
        book_text = "(not in the book: compared with real dbt only)"
        passed = None
    return {"id": c["id"], "ref": c["ref"], "title": c["title"], "mode": c["mode"], "kind": kind,
            "status": res.get("status"), "book": book_text, "got": got_text, "compiled": res.get("compiled"),
            "error": err, "logs": res.get("logs", []), "match": match, "passed": passed,
            "recorded_queries": rec}


def run(cases_json, fixtures_json, replay_json=None, query_fn=None):
    import jinja2
    cases = json.loads(cases_json)
    fixtures = json.loads(fixtures_json)
    replay = json.loads(replay_json) if replay_json else None
    results = [run_case(c, fixtures, replay, query_fn) for c in cases]
    return json.dumps({"python": sys.version.split()[0], "platform": sys.platform, "jinja2": jinja2.__version__,
                       "results": results}, default=str)
