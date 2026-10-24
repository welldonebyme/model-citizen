"""Run the frozen YAML cases (results/yaml_cases.json) through dbt_yaml and compare with the book.

Same code in CPython (native) and Pyodide: `run(cases_json) -> results_json`.
"""
import json
import sys

import dbt_yaml
from compare import compare


def _value_text(data, expr, use_print):
    v = eval(expr, {"__builtins__": {"list": list}}, {"data": data})  # expressions come from our own cases file
    return str(v) if use_print else repr(v)


def run_case(c):
    e = c["expect"]
    kind = e["kind"]
    if c["engine"] == "pyyaml":
        res = dbt_yaml.load_pyyaml(c["text"], filename=c.get("filename"))
    else:
        res = dbt_yaml.load_dbt(c["text"], path=c["path"] if c["path"].startswith("models/") else "models/" + c["path"],
                                project=c.get("project", "my_project"))
    err = res.get("error")
    out = {"id": c["id"], "ref": c["ref"], "title": c["title"], "engine": c["engine"], "kind": kind,
           "ok": res["ok"], "error": err, "warnings": res.get("warnings", [])}
    book, got, mode, extra = None, None, "equal", {}
    if kind == "dbt_block":
        lines = e["book"].split("\n")[e.get("skip_lines", 0):]
        book = "\n".join(lines)
        got = err and err.get("dbt_message")
        mode = "within"
        raw_got = err and err.get("message")
        extra["raw_error"] = {"book": e["raw_error"], "got": raw_got, "match": compare(e["raw_error"], raw_got)}
        pm = err and err.get("problem_mark")
        extra["near_line_ok"] = bool(pm and pm["line"] == e["near_line"])
        passed = extra["raw_error"]["match"]["exact"] and extra["near_line_ok"]
    elif kind == "traceback":
        book, got = e["book"], err and err.get("traceback_tail")
        passed = compare(book, got)["exact"]
    elif kind == "contains":
        msg = (err or {}).get("message") or ""
        book = " ... ".join(e["phrases"])
        if "line" in e:
            book += f" (line {e['line']}, column {e['column']})"
        got = msg
        pm = (err or {}).get("problem_mark")
        phr = all(p in msg for p in e["phrases"])
        pos = ("line" not in e) or bool(pm and pm["line"] == e["line"] and pm["column"] == e["column"])
        extra.update(phrases_ok=phr, position_ok=pos)
        passed = (not res["ok"]) and phr and pos
    elif kind == "warning":
        book = e["book"]
        got = "\n".join(w["dbt_message"] for w in res.get("warnings", []))
        passed = compare(book, got)["exact"]
    elif kind == "value":
        book = e["book"]
        got = _value_text(res["data"], e["expr"], e.get("print")) if res["ok"] else None
        passed = compare(book, got)["ws"]
    elif kind == "error_any":
        book, got = "(an error)", (err or {}).get("message")
        passed = not res["ok"]
    elif kind == "valid":
        book, got = "(valid YAML)", "valid YAML" if res["ok"] else (err or {}).get("message")
        passed = res["ok"]
    else:
        raise ValueError(kind)
    out.update(book=book, got=got, match=compare(book, got, mode) if kind in
               ("dbt_block", "traceback", "warning", "value") else None, passed=bool(passed), **extra)
    return out


def run(cases_json):
    cases = json.loads(cases_json)
    results = [run_case(c) for c in cases]
    import yaml
    return json.dumps({"python": sys.version.split()[0], "platform": sys.platform,
                       "pyyaml": yaml.__version__, "libyaml": dbt_yaml.HAS_LIBYAML, "results": results})


if __name__ == "__main__":
    print(run(open(sys.argv[1]).read()))
