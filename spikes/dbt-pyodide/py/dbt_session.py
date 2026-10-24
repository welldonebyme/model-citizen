"""Helpers run inside Pyodide (Node and browser drivers): project checkout from a bundle, practice data, dbt calls.

Bundle layout in the virtual FS (written by the driver):  /bundle/projects/<tag>/...  /bundle/dbt_packages/...
/bundle/labs/{setup.sql,data/*.csv,updates/*.sql}  /bundle/profiles/{default.yml,ch10.yml}
"""
import os
import shlex
import shutil
import time

import duckdb

BUNDLE = "/bundle"
COURSE = "/home/pyodide/dbt-course"
PROJECT = COURSE + "/jaffle_dbt"
DB = COURSE + "/practice/practice.duckdb"


def _copytree(src, dst):
    for root, dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for f in files:
            shutil.copyfile(os.path.join(root, f), os.path.join(dst, rel, f))


def setup_course():
    """Copy the practice kit (labs/) next to the project, like the learner's ~/dbt-course."""
    if not os.path.isdir(COURSE + "/labs"):
        _copytree(BUNDLE + "/labs", COURSE + "/labs")
    os.makedirs(COURSE + "/practice", exist_ok=True)


def checkout(tag):
    """Like `git checkout <tag>` in the learner's repo: tracked files replaced, target/ and logs/ kept."""
    os.makedirs(PROJECT, exist_ok=True)
    for n in os.listdir(PROJECT):
        if n not in ("target", "logs"):
            p = os.path.join(PROJECT, n)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    _copytree(f"{BUNDLE}/projects/{tag}", PROJECT)
    if os.path.exists(PROJECT + "/packages.yml"):  # `dbt deps` result, pre-installed (no network in the sandbox)
        _copytree(BUNDLE + "/dbt_packages", PROJECT + "/dbt_packages")
    os.makedirs("/home/pyodide/.dbt", exist_ok=True)
    prof = "ch10.yml" if int(tag[2:]) >= 10 else "default.yml"
    shutil.copyfile(f"{BUNDLE}/profiles/{prof}", "/home/pyodide/.dbt/profiles.yml")
    print(f"[spike] checkout {tag}")


def copy_file(tag, rel):
    shutil.copyfile(f"{BUNDLE}/projects/{tag}/{rel}", f"{PROJECT}/{rel}")
    print(f"[spike] copied {rel} from {tag}")


def run_sql_file(path, db=DB):
    """Equivalent of `duckdb practice.duckdb < file.sql` (run from the file's folder)."""
    os.makedirs(os.path.dirname(db), exist_ok=True)
    cwd = os.getcwd()
    os.chdir(os.path.dirname(path))
    t = time.time()
    con = duckdb.connect(db)
    try:
        con.execute(open(path).read())
    finally:
        con.close()
        os.chdir(cwd)
    return time.time() - t


def query(sql, db=DB):
    con = duckdb.connect(db)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def dbt(cmdline, prelude=False):
    """Run one dbt command line (without the leading 'dbt') from the project folder. Returns (success, seconds)."""
    from dbt.cli.main import dbtRunner

    os.chdir(PROJECT)
    args = shlex.split(cmdline)
    if args and args[0] == "dbt":
        args = args[1:]
    print(f"$ {'[prelude] ' if prelude else ''}dbt {cmdline}")
    t = time.time()
    res = dbtRunner().invoke(args)
    dt = time.time() - t
    if res.exception is not None:
        import traceback
        print("dbtRunner exception:", "".join(traceback.format_exception(res.exception)))
    print(f"[spike] success={res.success} wall={dt:.2f}s")
    return res.success, dt


def step(line):
    """One scenario line: dbt command, or  sql:<labs file>  q:<sql>  checkout:<tag>  copy:<tag>:<path>  !<setup dbt cmd>"""
    t = time.time()
    if line.startswith("sql:"):
        print("[spike] ran %s: %.2fs" % (line[4:], run_sql_file(f"{COURSE}/labs/{line[4:]}")))
        return None
    if line.startswith("q:"):
        print("[spike] query:", line[2:])
        for r in query(line[2:]):
            print("   ", r)
        return None
    if line.startswith("checkout:"):
        checkout(line[9:])
        return None
    if line.startswith("copy:"):
        _, tag, rel = line.split(":", 2)
        copy_file(tag, rel)
        return None
    if line.startswith("!"):
        ok, _ = dbt(line[1:], prelude=True)
    else:
        ok, _ = dbt(line)
    return {"cmd": line, "ok": ok, "ms": round((time.time() - t) * 1000)}
