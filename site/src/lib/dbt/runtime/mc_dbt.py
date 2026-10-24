"""Model Citizen: the dbt sandbox runtime. Runs inside Pyodide (Web Worker in the browser, or Node for the checks).

The TypeScript session (src/lib/dbt/session.ts) calls these functions. Everything they print goes to the terminal.
Each function returns an exit code like the real program would (0 = success).
"""
import contextlib
import gc
import io
import os
import sys
import traceback

_booted = False


def boot():
    """Import dbt once (about 2 s), so that the first command is fast."""
    global _booted
    if _booted:
        return
    import dbt_pyodide_shim  # noqa: F401  (threads / _multiprocessing shims: must come before dbt)
    import dbt.cli.main  # noqa: F401
    import dbt.adapters.duckdb  # noqa: F401
    import duckdb  # noqa: F401
    _booted = True


def versions():
    import importlib.metadata as m
    import duckdb
    return {
        "python": sys.version.split()[0],
        "dbt-core": m.version("dbt-core"),
        "dbt-duckdb": m.version("dbt-duckdb"),
        "duckdb": duckdb.__version__,
    }


# ---- dbt ---------------------------------------------------------------------------------------------------

def _reset_process_state():
    """On a computer every dbt command is a new process. Here all commands share one Python process, so reset the
    few process-wide 'only once' caches that would otherwise make a later command print less than the first one."""
    try:
        import dbt.deprecations as deprecations
        deprecations.reset_deprecations()
        deprecations.buffered_deprecations.clear()
    except Exception:
        pass
    try:
        from dbt.adapters.duckdb.connections import DuckDBConnectionManager
        DuckDBConnectionManager._LOGGED_MESSAGES.clear()
    except Exception:
        pass


def _repair_zipimport_cache():
    """After pyodide.loadPackage() (pandas), Python's import caches are invalidated, and zipimport forgets the
    directory of the standard library zip. pkgutil.iter_modules() (dbt's plugin discovery) then fails with
    KeyError: '/lib/python314.zip'. Reading the directory again fixes it."""
    try:
        import zipimport
        for imp in list(sys.path_importer_cache.values()):
            if isinstance(imp, zipimport.zipimporter):
                try:
                    imp._get_files()
                except Exception:
                    pass
    except Exception:
        pass


def _close_databases():
    """Close dbt-duckdb's database handle (the process 'exits'), so DuckDB writes its WAL into the database file."""
    try:
        from dbt.adapters.duckdb.connections import DuckDBConnectionManager
        env = DuckDBConnectionManager._ENV
        DuckDBConnectionManager._ENV = None
        if env is not None:
            try:
                env.close()
            except Exception:
                pass
    except Exception:
        pass
    gc.collect()


def _with_env(env, fn):
    env = {str(k): str(v) for k, v in dict(env or {}).items()}
    saved = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        return fn()
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def run_dbt(argv, env=None, cwd=None):
    """Exactly what the `dbt` console script does (click standalone mode: same messages, same exit codes 0/1/2)."""
    from dbt.cli.main import cli

    argv = [str(a) for a in argv]
    _reset_process_state()
    _repair_zipimport_cache()
    if cwd:
        os.chdir(cwd)

    def go():
        try:
            cli.main(args=argv, prog_name="dbt", standalone_mode=True)
            return 0
        except SystemExit as e:
            return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        except BaseException:
            traceback.print_exc()
            return 1

    try:
        return _with_env(env, go)
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        _close_databases()


# ---- duckdb (the DuckDB command line, through the duckdb Python module) ------------------------------------

def _split_script(text):
    """Split a DuckDB CLI script into ('sql', text) and ('dot', line) parts. Dot commands start a line."""
    parts, buf = [], []
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith(".") and not "".join(buf).strip():
            parts.append(("dot", line.strip()))
        elif line.lstrip().startswith(".") and _sql_complete("".join(buf)):
            parts.append(("sql", "".join(buf)))
            buf = []
            parts.append(("dot", line.strip()))
        else:
            buf.append(line)
    if "".join(buf).strip():
        parts.append(("sql", "".join(buf)))
    return parts


def _sql_complete(text):
    return text.strip() == "" or text.rstrip().endswith(";")


def _print_error(e):
    msg = str(e).strip()
    print(msg if msg else type(e).__name__, file=sys.stderr)


def _run_sql(con, text, width, bail):
    import duckdb
    errors = 0
    try:
        statements = duckdb.extract_statements(text)
    except Exception as e:  # parser error: the CLI reports it and runs nothing of this chunk
        _print_error(e)
        return 1, True
    for st in statements:
        try:
            rel = con.sql(st.query)
            if rel is not None:
                # the same "duckbox" renderer as the DuckDB CLI; captured to drop the blank lines around the table
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    rel.show(max_width=max(40, int(width)), max_rows=40)
                print(buf.getvalue().strip("\n"))
        except Exception as e:
            _print_error(e)
            errors += 1
            if bail:
                return errors, True
    return errors, False


def duckdb_cli(db, script, cwd=None, width=100, bail=True, read_only=False):
    """`duckdb <db> -c "<sql>"` (bail=True: stop at the first error) or `duckdb <db> < file.sql` (bail=False:
    report each error and go on, like the CLI reading a script). Results are printed in DuckDB's 'duckbox'
    format, by the same renderer as the CLI. Returns 1 if any statement failed."""
    import duckdb

    if cwd:
        os.chdir(cwd)
    try:
        con = duckdb.connect(db, read_only=bool(read_only))
    except Exception as e:
        _print_error(e)
        return 1
    errors = 0
    try:
        stack = [(script, os.getcwd())]
        while stack:
            text, base = stack.pop(0)
            for kind, part in _split_script(text):
                if kind == "sql":
                    n, stop = _run_sql(con, part, width, bail)
                    errors += n
                    if stop and bail:
                        return 1
                    continue
                words = part.split(None, 1)
                cmd = words[0]
                arg = words[1].strip().strip("'\"") if len(words) > 1 else ""
                if cmd in (".quit", ".exit", ".q"):
                    return 1 if errors else 0
                if cmd == ".read" and arg:
                    path = arg if os.path.isabs(arg) else os.path.join(base, arg)
                    try:
                        with open(path, encoding="utf-8") as f:
                            n, stop = _run_sql(con, f.read(), width, bail)
                    except FileNotFoundError:
                        print(f'Error: cannot open "{arg}"', file=sys.stderr)
                        n, stop = 1, True
                    errors += n
                    if stop and bail:
                        return 1
                    continue
                print(f'Error: unknown command or invalid arguments: "{cmd[1:]}". In this browser terminal only'
                      ' .read and .quit work.', file=sys.stderr)
                errors += 1
                if bail:
                    return 1
        return 1 if errors else 0
    finally:
        try:
            con.close()
        except Exception:
            pass
        sys.stdout.flush()
        sys.stderr.flush()
        gc.collect()


def query_rows(db, sql):
    """Small helper for checks: list of tuples (read-only connection, closed afterwards)."""
    import duckdb
    con = duckdb.connect(db, read_only=True)
    try:
        return [list(r) for r in con.execute(sql).fetchall()]
    finally:
        con.close()
        gc.collect()
