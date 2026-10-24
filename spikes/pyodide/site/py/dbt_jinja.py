"""dbt_jinja: a small, adapter-free, dbt-like Jinja engine for the dbt-academy playground.

Runs unchanged in CPython and in Pyodide. It is NOT dbt: it imitates what dbt-core 1.11 does when it
renders a model, so the playground can show the same compiled SQL and the same messages as the book.

What it imitates
  * the environment: SandboxedEnvironment + jinja2.ext.do + loopcontrols, macro names fuzzed to
    ``dbt_macro__<name>`` (so errors say "macro 'dbt_macro__x' takes not more than 2 argument(s)")
  * two renderings: a *parse* pass (execute=False, lenient undefined, collects ref/source/config/log)
    and an *execute* pass (execute=True, strict undefined) -> compiled SQL
  * project macros + package macros (namespaces), ``return()``, ``adapter.dispatch`` search order,
    ``{% call statement() %}`` / ``load_result`` / ``run_query`` / ``adapter.get_relation`` ...
  * ref / source / config / var / env_var / target / this / is_incremental / log / print / exceptions /
    modules / run_started_at / invocation_id / flags / graph / model / project_name / api

Database access (run_query, adapter.*) never blocks: a query whose result is not known raises
``PendingQuery``. The caller runs it (DuckDB-WASM in the browser, duckdb natively), adds the result
with ``add_query_result`` and renders again ("record and replay"). Rendering is deterministic, so
this converges in (number of distinct queries + 1) renders.
"""
import collections.abc
import datetime
import itertools
import json
import re
import sys
import time

import jinja2
import jinja2.ext
import jinja2.nodes
import jinja2.parser
import jinja2.sandbox

MACRO_PREFIX = "dbt_macro__"
EPHEMERAL_PREFIX = "__dbt__cte__"
_MISSING = object()


# =============================================================================== errors / control flow
class MacroReturn(Exception):
    def __init__(self, value):
        super().__init__("return")
        self.value = value


class DbtCompilationError(Exception):
    """A dbt 'Compilation Error'. `inside_macro` mirrors dbt's CaughtMacroError (no undefined-macro hint)."""

    def __init__(self, msg, inside_macro=False):
        super().__init__(msg)
        self.msg = msg
        self.inside_macro = inside_macro


class PendingQuery(BaseException):
    """BaseException on purpose: library code with `except Exception` must not swallow it."""

    def __init__(self, sql):
        super().__init__("pending query")
        self.sql = sql


class RenderTimeout(BaseException):
    """BaseException on purpose (like KeyboardInterrupt)."""


# =============================================================================== jinja environment
class _FuzzParser(jinja2.parser.Parser):
    def parse_macro(self):
        node = jinja2.nodes.Macro(lineno=next(self.stream).lineno)
        node.name = MACRO_PREFIX + self.parse_assign_target(name_only=True).name
        self.parse_signature(node)
        node.body = self.parse_statements(("name:endmacro",), drop_needle=True)
        return node


class DbtEnvironment(jinja2.sandbox.SandboxedEnvironment):
    def _parse(self, source, name, filename):
        return _FuzzParser(self, source, name, filename).parse()


class LenientUndefined(jinja2.Undefined):
    """dbt's parse-time undefined (dbt_common create_undefined): attributes, items and calls propagate."""

    def __init__(self, hint=None, obj=None, name=None, exc=None):
        super().__init__(hint=hint, name=name)
        self.unsafe_callable = False
        self.alters_data = False

    def __getitem__(self, name):
        return self

    def __getattr__(self, name):
        if name == "name" or (name.startswith("__") and name.endswith("__")):
            raise AttributeError(name)
        return self.__class__(hint=self._undefined_hint, name=name)

    def __call__(self, *args, **kwargs):
        return self


_TEXT_FILTERS = {"as_text": lambda x: x, "as_bool": lambda x: x, "as_native": lambda x: x,
                 "as_number": lambda x: x, "is_list": lambda x: isinstance(x, list)}


def make_env(lenient=False):
    env = DbtEnvironment(extensions=["jinja2.ext.do", "jinja2.ext.loopcontrols"],
                         undefined=LenientUndefined if lenient else jinja2.Undefined)
    env.filters.update(_TEXT_FILTERS)
    return env


# =============================================================================== small dbt objects
class Relation(collections.abc.Mapping):
    """Enough of dbt's BaseRelation for templates (DuckDB quoting)."""

    def __init__(self, database, schema, identifier, type="table", is_cte=False):
        self.database, self.schema, self.identifier = database, schema, identifier
        self.type, self.is_cte = type, is_cte
        self._d = {"database": database, "schema": schema, "identifier": identifier, "type": type,
                   "metadata": {"type": "DuckDBRelation"}, "path": {"database": database, "schema": schema,
                                                                    "identifier": identifier}}

    name = property(lambda self: self.identifier)
    table = property(lambda self: self.identifier)
    is_table = property(lambda self: self.type == "table")
    is_view = property(lambda self: self.type == "view")

    def render(self):
        if self.is_cte:
            return self.identifier
        return ".".join(f'"{p}"' for p in (self.database, self.schema, self.identifier) if p is not None)

    def include(self, database=True, schema=True, identifier=True):
        return Relation(self.database if database else None, self.schema if schema else None,
                        self.identifier if identifier else None, self.type, self.is_cte)

    def __str__(self):
        return self.render()

    def __repr__(self):
        return f"<DuckDBRelation {self.render()}>"

    def __getitem__(self, k):
        return self._d[k]

    def __iter__(self):
        return iter(self._d)

    def __len__(self):
        return len(self._d)

    def __eq__(self, other):
        return isinstance(other, Relation) and self.render() == other.render()

    def __hash__(self):
        return hash(self.render())


class Column:
    TYPE_LABELS = {"STRING": "TEXT", "TIMESTAMP": "TIMESTAMP", "FLOAT": "FLOAT", "INTEGER": "INT",
                   "BOOLEAN": "BOOLEAN"}

    def __init__(self, name, dtype, char_size=None, numeric_precision=None, numeric_scale=None):
        self.name, self.column, self.dtype = name, name, dtype
        self.char_size, self.numeric_precision, self.numeric_scale = char_size, numeric_precision, numeric_scale

    @classmethod
    def translate_type(cls, dtype):
        return cls.TYPE_LABELS.get(dtype.upper(), dtype)

    @property
    def quoted(self):
        return f'"{self.name}"'

    @property
    def data_type(self):  # same rules as dbt-adapters Column.data_type
        d = self.dtype.lower()
        if d in ("text", "character varying", "character", "varchar"):
            return f"character varying({self.char_size or 256})"
        if d in ("numeric", "decimal"):
            return f"{self.dtype}({self.numeric_precision},{self.numeric_scale})"
        return self.dtype

    def __repr__(self):
        return f"<Column {self.name} ({self.data_type})>"


class _Seq(list):
    """agate-like MappedSequence: index by position or by name."""

    def __init__(self, items, keys):
        super().__init__(items)
        self._keys = list(keys)

    def __getitem__(self, k):
        if isinstance(k, str):
            return list.__getitem__(self, self._keys.index(k))
        return list.__getitem__(self, k)

    def keys(self):
        return list(self._keys)


class _TableColumn:
    def __init__(self, name, values):
        self.name, self._values = name, tuple(values)

    def values(self):
        return self._values


class Table:
    """Minimal agate.Table: .columns[i].values(), .rows, .column_names, len()."""

    def __init__(self, column_names, rows):
        self.column_names = tuple(column_names)
        self.rows = _Seq([_Seq(r, column_names) for r in rows], range(len(rows)))
        self.columns = _Seq([_TableColumn(n, [r[i] for r in rows]) for i, n in enumerate(column_names)],
                            column_names)

    def __len__(self):
        return len(self.rows)

    def __iter__(self):
        return iter(self.rows)

    def print_table(self, *a, **k):
        return ""


class _Namespace(collections.abc.Mapping):
    """Members are reached through __getitem__ only. Jinja's sandbox checks attributes found by
    getattr() (and refuses names starting with '_'), but not items found by obj[name]: this is how
    `dbt_utils._is_ephemeral(...)` stays callable, like dbt's MacroNamespace."""

    def __init__(self, name, members):
        self._name, self._members = name, members

    def __getitem__(self, k):
        return self._members[k]

    def __iter__(self):
        return iter(self._members)

    def __len__(self):
        return len(self._members)

    def __repr__(self):
        return f"<namespace {self._name}>"


def _attrs(**kw):
    return _Namespace("obj", kw)


# =============================================================================== the engine
class DbtJinja:
    """One project = models + sources + macro files + targets. Thread-free, deterministic."""

    def __init__(self, project):
        p = dict(project)
        self.name = p.get("name", "my_project")
        self.database = p.get("database", "practice")
        self.adapter_type = p.get("adapter_type", "duckdb")
        self.targets = p.get("targets") or {"dev": {"schema": "dbt_dev", "threads": 1}}
        self.target_name = p.get("target") or next(iter(self.targets))
        self.vars = dict(p.get("vars") or {})
        self.env_vars = dict(p.get("env") or {})
        self.models = dict(p.get("models") or {})
        self.sources = dict(p.get("sources") or {})
        rs = p.get("run_started_at") or "2026-10-21T22:13:33+00:00"
        self.run_started_at = datetime.datetime.fromisoformat(rs)
        self.invocation_id = p.get("invocation_id", "00000000-0000-0000-0000-000000000000")
        self.which = p.get("which", "compile")
        self.full_refresh = bool(p.get("full_refresh", False))
        self.query_results = {}
        self.query_fn = None  # optional synchronous executor (native tests)
        self.queries_seen = []
        self._env_strict = make_env(lenient=False)
        self._env_lenient = make_env(lenient=True)
        self._tmpl = {}
        # macros: package -> {name: (path, source)}
        self.packages = collections.OrderedDict()
        self.package_order = [self.name]
        self.packages[self.name] = {}
        # dbt + adapter plugin macros live in the "dbt" namespace. Order = dispatch search order:
        # adapter plugin first (dbt_duckdb), the global project ("dbt") last, like
        # get_adapter_package_names() in dbt-core.
        self.internal_packages = list(p.get("internal_packages", [])) + ["dbt"]
        self._macro_files = []
        for path, info in (p.get("macro_files") or {}).items():
            if isinstance(info, str):
                info = {"package": self.name, "source": info}
            self.add_macro_file(path, info["source"], info.get("package", self.name))

    # ------------------------------------------------------------------ macros
    def add_macro_file(self, path, source, package=None):
        package = package or self.name
        bucket = self.packages.setdefault(package, {})
        if package not in self.package_order and package not in self.internal_packages:
            self.package_order.append(package)
        try:
            tree = self._env_strict.parse(source)
        except jinja2.TemplateSyntaxError as e:
            raise DbtCompilationError(f"{e.message}\n  line {e.lineno}\n    {path}")
        for m in tree.find_all(jinja2.nodes.Macro):
            name = m.name[len(MACRO_PREFIX):]
            if name in bucket and bucket[name][0] != path:
                where = self.name if package == self.name else package
                raise DbtCompilationError(
                    f'dbt found multiple macros named "{name}" in the project\n  "{where}".\n'
                    "   All macros require unique names, to fix this error rename or remove any\n"
                    "  duplicates. They can be found in these files:\n"
                    f"      - {path}\n      - {bucket[name][0]}")
            bucket[name] = (path, source)
        self._macro_files.append((package, path))

    def _template(self, env, key, source, filename):
        k = (id(env), key)
        t = self._tmpl.get(k)
        if t is None or t[0] != source:
            code = env.compile(source, name=filename, filename=filename)
            t = (source, env.template_class.from_code(env, code, env.make_globals(None), None))
            self._tmpl[k] = t
        return t[1]

    def _macro_callable(self, package, name, ctx):
        path, source = self.packages[package][name]
        engine = self

        def call(*args, **kwargs):
            tmpl = engine._template(engine._env_strict, ("macro", package, path), source, path)
            module = tmpl.make_module(vars=ctx)
            macro = getattr(module, MACRO_PREFIX + name)
            try:
                return macro(*args, **kwargs)
            except MacroReturn as r:
                return r.value
            except (TypeError, jinja2.exceptions.TemplateRuntimeError) as e:
                raise DbtCompilationError(str(e), inside_macro=True) from e

        call.__name__ = name
        return call

    def _dispatch(self, ctx):
        def dispatch(macro_name, macro_namespace=None, packages=None):
            if "." in macro_name:
                macro_namespace, macro_name = macro_name.split(".", 1)
            if macro_namespace is None:
                search = [self.name]
            elif macro_namespace in self.internal_packages:
                search = [self.name] + self.internal_packages
            else:
                search = [self.name, macro_namespace]
            prefixes = [f"{self.adapter_type}__", "default__"]
            tried = []
            for pkg in search:
                for pre in prefixes:
                    tried.append(f"{pkg}.{pre}{macro_name}")
                    if macro_name and (pre + macro_name) in self.packages.get(pkg, {}):
                        return self._macro_callable(pkg, pre + macro_name, ctx)
            raise DbtCompilationError(f"No macro named '{macro_name}' found within namespace: "
                                      f"'{macro_namespace}'\n    Searched for: {', '.join(repr(t) for t in tried)}")
        return dispatch

    # ------------------------------------------------------------------ queries
    @staticmethod
    def _qkey(sql):
        return re.sub(r"\s+", " ", str(sql)).strip()

    def add_query_result(self, sql, column_names, rows):
        self.query_results[self._qkey(sql)] = (list(column_names), [list(r) for r in rows])

    def _query(self, sql):
        key = self._qkey(sql)
        if key not in self.queries_seen:
            self.queries_seen.append(key)
        if key not in self.query_results:
            if self.query_fn is None:
                raise PendingQuery(str(sql))
            cols, rows = self.query_fn(str(sql))
            self.add_query_result(sql, cols, rows)
        cols, rows = self.query_results[key]
        return Table(cols, [tuple(r) for r in rows])

    # ------------------------------------------------------------------ relations
    def _target(self):
        t = dict(self.targets[self.target_name])
        t.setdefault("database", self.database)
        t.setdefault("type", self.adapter_type)
        t.setdefault("threads", 1)
        t.update(name=self.target_name, target_name=self.target_name, profile_name=self.name)
        return t

    def _schema_for(self, node, ctx):
        custom = node.get("schema")
        if "generate_schema_name" in self.packages[self.name]:
            out = self._macro_callable(self.name, "generate_schema_name", ctx)(custom, node)
            return str(out).strip()
        default = ctx["target"]["schema"]
        return default if custom is None else f"{default}_{custom.strip()}"

    def _model_relation(self, name, ctx):
        node = self._node(name)
        if node.get("materialized") == "ephemeral":
            return Relation(None, None, EPHEMERAL_PREFIX + name, type="cte", is_cte=True)
        schema = self._schema_for(node, ctx)
        return Relation(node.get("database") or self.database, schema, node.get("alias") or name,
                        type="view" if node.get("materialized") == "view" else "table")

    def _node(self, name):
        n = dict(self.models.get(name) or {})
        n.setdefault("name", name)
        n.setdefault("resource_type", "model")
        n.setdefault("materialized", "view")
        n.setdefault("path", f"models/{name}.sql")
        return n

    # ------------------------------------------------------------------ context
    def _context(self, node, state, execute):
        ctx = {}
        logs, refs, srcs, cfg, stored = state["logs"], state["refs"], state["sources"], state["config"], state["stored"]
        phase = "execute" if execute else "parse"
        target = self._target()
        ctx["target"] = target  # needed by generate_schema_name while the context is being built
        engine = self

        def ref(*args, **kwargs):
            version = kwargs.get("v", kwargs.get("version"))
            if len(args) == 2:
                package, name = args
            elif len(args) == 1:
                package, name = None, args[0]
            else:
                raise DbtCompilationError(f"ref() takes at most two arguments ({len(args)} given)")
            refs.append({"package": package, "name": name, "version": version})
            if name not in self.models:
                if not execute:
                    return Relation(self.database, target["schema"], name)
                raise DbtCompilationError(
                    f"{node['describe']} depends on a node named '{name}' which was not found")
            return self._model_relation(name, ctx)

        def source(source_name, table_name):
            srcs.append([source_name, table_name])
            s = self.sources.get(source_name)
            t = s and s.get("tables", {}).get(table_name)
            if t is None:
                if not execute:
                    return Relation(self.database, source_name, table_name)
                raise DbtCompilationError(
                    f"{node['describe']} depends on a source named '{source_name}.{table_name}' which was not found")
            t = t or {}
            return Relation(s.get("database", self.database), s.get("schema", source_name),
                            t.get("identifier", table_name))

        class _Config:
            def __call__(self, *args, **kwargs):
                if args and isinstance(args[0], dict):
                    kwargs = {**args[0], **kwargs}
                cfg.update(kwargs)
                return ""

            def get(self, key, default=None):
                return cfg.get(key, node.get(key, default))

            def require(self, key):
                if key not in cfg and key not in node:
                    raise DbtCompilationError(f"Required config key '{key}' not found")
                return cfg.get(key, node.get(key))

        def var(name, default=_MISSING):
            if name in self.vars:
                return self.vars[name]
            if default is not _MISSING:
                return default
            if not execute:
                return None  # dbt does not fail on missing vars while parsing
            supplied = json.dumps(self.vars, indent=4, sort_keys=True)
            raise DbtCompilationError(
                f"Required var '{name}' not found in config:\nVars supplied to {node['name']} = {supplied}")

        def env_var(name, default=_MISSING):
            if name in self.env_vars:
                return self.env_vars[name]
            if default is not _MISSING:
                return default
            raise DbtCompilationError(f"Env var required but not provided: '{name}'")

        def log(msg, info=False):
            logs.append({"phase": phase, "info": bool(info), "msg": str(msg)})
            return ""

        def _print(msg):
            logs.append({"phase": phase, "info": True, "msg": str(msg), "print": True})
            return ""

        def _return(value):
            raise MacroReturn(value)

        def raise_compiler_error(msg, node_=None):
            raise DbtCompilationError(str(msg))

        def warn(msg, node_=None):
            logs.append({"phase": phase, "info": True, "msg": f"[WARNING]: {msg}"})
            return ""

        def statement(name=None, fetch_result=False, auto_begin=True, language="sql", caller=None):
            sql = caller() if caller is not None else ""
            if execute:
                table = engine._query(sql)
                if name is not None:
                    stored[name] = {"response": "OK", "table": table,
                                    "data": [tuple(r) for r in table.rows] if fetch_result else []}
            return ""

        def store_result(name, response, agate_table=None):
            stored[name] = {"response": response, "table": agate_table,
                            "data": [tuple(r) for r in agate_table.rows] if agate_table else []}
            return ""

        def load_result(name):
            return stored.get(name)

        def run_query(sql):
            if not execute:
                # what dbt's run_query macro gives back while parsing: load_result(...) is None,
                # so `.table` is an undefined -> using it fails with "'None' has no attribute 'table'"
                return self._env_strict.undefined(obj=None, name="table")
            return engine._query(sql)

        def get_relation(database=None, schema=None, identifier=None):
            if not execute:
                return None
            t = engine._query(
                "select table_type from information_schema.tables where table_catalog = "
                f"'{database}' and table_schema = '{schema}' and table_name = '{identifier}'")
            if not len(t):
                return None
            kind = str(t.rows[0][0]).upper()
            return Relation(database, schema, identifier, type="view" if "VIEW" in kind else "table")

        def get_columns_in_relation(relation):
            if not execute:
                return []
            t = engine._query(
                "select column_name, data_type, character_maximum_length, numeric_precision, numeric_scale "
                f"from information_schema.columns where table_catalog = '{relation.database}' and "
                f"table_schema = '{relation.schema}' and table_name = '{relation.identifier}' "
                "order by ordinal_position")
            return [Column(*r) for r in t.rows]

        def load_relation(relation):
            return get_relation(relation.database, relation.schema, relation.identifier)

        def is_incremental():
            if not execute:
                return False
            mat = cfg.get("materialized", node.get("materialized"))
            rel = get_relation(this.database, this.schema, this.identifier) if this is not None else None
            return bool(rel is not None and rel.type == "table" and mat == "incremental" and not self.full_refresh)

        def create_relation(database=None, schema=None, identifier=None, type="table"):
            return Relation(database, schema, identifier, type=type)

        # `this`
        if node["resource_type"] == "model" and node["name"] in self.models:
            this = self._model_relation(node["name"], ctx)
        else:
            this = Relation(self.database, target["schema"], node["name"])

        graph_nodes = {}
        for mname in self.models:
            n = self._node(mname)
            graph_nodes[f"model.{self.name}.{mname}"] = {
                "name": mname, "resource_type": "model", "unique_id": f"model.{self.name}.{mname}",
                "database": self.database, "schema": None, "alias": n.get("alias") or mname,
                "config": {"materialized": n["materialized"]}, "package_name": self.name,
            }

        ctx.update({
            "ref": ref, "source": source, "config": _Config(), "var": var, "env_var": env_var,
            "target": target, "this": this, "is_incremental": is_incremental, "log": log, "print": _print,
            "return": _return, "execute": execute, "run_query": run_query, "statement": statement,
            "load_result": load_result, "store_result": store_result, "load_relation": load_relation,
            "project_name": self.name, "invocation_id": self.invocation_id,
            "run_started_at": self.run_started_at, "flags": _attrs(WHICH=self.which, FULL_REFRESH=self.full_refresh),
            "modules": _attrs(datetime=datetime, re=re, itertools=itertools),
            "exceptions": _attrs(raise_compiler_error=raise_compiler_error, warn=warn),
            "adapter": _attrs(dispatch=self._dispatch(ctx), get_relation=get_relation,
                              get_columns_in_relation=get_columns_in_relation,
                              quote=lambda s: f'"{s}"', type=lambda: self.adapter_type),
            "api": _attrs(Relation=_attrs(create=create_relation,
                                          add_ephemeral_prefix=lambda n: EPHEMERAL_PREFIX + n),
                          Column=Column),
            "model": node, "fromjson": json.loads, "tojson": json.dumps, "zip": zip, "set": set,
        })
        # graph: schemas filled lazily (generate_schema_name needs the context)
        for gid, g in graph_nodes.items():
            g["schema"] = self._schema_for(self._node(g["name"]), ctx)
        ctx["graph"] = {"nodes": graph_nodes, "sources": {}}
        # macros: internal (global) first, then the root project overrides; packages by namespace
        for pkg in reversed(self.internal_packages):  # global first, plugin overrides
            for mname in self.packages.get(pkg, {}):
                ctx[mname] = self._macro_callable(pkg, mname, ctx)
        for mname in self.packages.get(self.name, {}):
            ctx[mname] = self._macro_callable(self.name, mname, ctx)
        ns = {}
        for pkg, macros in self.packages.items():
            ns[pkg] = {m: self._macro_callable(pkg, m, ctx) for m in macros}
        ns.setdefault("dbt", {})
        for pkg in self.internal_packages[:-1]:
            ns["dbt"].update(ns.get(pkg, {}))
        for pkg, members in ns.items():
            ctx[pkg] = _Namespace(pkg, members)
        return ctx

    # ------------------------------------------------------------------ compile
    def compile(self, sql, name="inline_query", resource_type="sql_operation", path=None,
                passes=("parse", "execute"), deadline_s=None, strip=True):
        """Render like `dbt compile` (both passes). Returns a JSON-friendly dict, never raises
        (except RenderTimeout when `deadline_s` is exceeded)."""
        if resource_type == "model":
            node = self._node(name)
            if path:
                node["path"] = path
            node["describe"] = f"Model 'model.{self.name}.{name}' ({node['path']})"
        else:
            node = {"name": name, "resource_type": resource_type, "materialized": "view",
                    "path": path or "from remote system.sql", "describe": f"SQL operation '{name}'"}
        source = sql.strip() if strip else sql  # dbt reads files with strip=True
        state = {"logs": [], "refs": [], "sources": [], "config": {}, "stored": {}}
        result = {"status": "ok", "compiled": None, "logs": state["logs"], "refs": state["refs"],
                  "sources": state["sources"], "config": state["config"], "error": None, "pending_sql": None}
        result["parse_refs"] = state.setdefault("parse_refs", [])
        for phase in passes:
            execute = phase == "execute"
            try:
                out = _with_deadline(lambda: self._render(source, node, state, execute), deadline_s)
            except PendingQuery as q:
                result.update(status="need_query", pending_sql=q.sql)
                return result
            except RenderTimeout:
                raise
            except Exception as e:  # noqa: BLE001 - turn everything into a dbt-like message
                result.update(status="error", error=self._format_error(e, node, phase))
                return result
            if execute:
                result["compiled"] = out
                result["parse_refs"] = state["parse_refs"]
                result["parse_sources"] = state["parse_sources"]
            elif "execute" in passes:
                # after the parse pass dbt knows the DAG: unknown refs/sources fail here
                for r in state["refs"]:
                    if r["name"] not in self.models:
                        e = DbtCompilationError(f"{node['describe']} depends on a node named '{r['name']}' "
                                                "which was not found")
                        result.update(status="error", error=self._format_error(e, node, "parse"))
                        return result
                state["logs_parse_done"] = True
            else:
                result["compiled"] = out
        return result

    def _render(self, source, node, state, execute):
        state["stored"].clear()
        if execute:  # keep what the parse pass found (that is what builds dbt's DAG)
            state["parse_refs"] = list(state["refs"])
            state["parse_sources"] = list(state["sources"])
            state["refs"].clear(), state["sources"].clear()
        ctx = self._context(node, state, execute)
        env = self._env_strict if execute else self._env_lenient
        tmpl = self._template(env, ("node", node["name"]), source, node["path"])
        return tmpl.render(ctx)

    def _format_error(self, e, node, phase):
        lineno = None
        if isinstance(e, jinja2.TemplateSyntaxError):
            msg = e.message
            lineno = e.lineno
            kind = "syntax"
        elif isinstance(e, jinja2.UndefinedError):
            msg = (f"{e}. This can happen when calling a macro that does not exist. Check for typos and/or "
                   'install package dependencies with "dbt deps".')
            kind = "undefined"
        elif isinstance(e, DbtCompilationError):
            msg, kind = e.msg, "compilation"
        elif isinstance(e, RecursionError):
            msg, kind = f"maximum recursion depth exceeded: {e}", "recursion"
        else:
            msg, kind = str(e), type(e).__name__
        if lineno is None:  # find the template line in the traceback (jinja rewrites frames)
            tb = e.__traceback__
            while tb is not None:
                if tb.tb_frame.f_code.co_filename == node["path"]:
                    lineno = tb.tb_lineno
                tb = tb.tb_next
        if node["resource_type"] == "sql_operation":
            if phase == "parse":
                dbt_message = f"Error while parsing node: {node['name']}\n{msg}"
            else:
                dbt_message = ("Runtime Error\n  Compilation Error in sql_operation inline_query "
                               f"(from remote system.sql)\n    {msg}")
        else:
            dbt_message = f"Compilation Error in model {node['name']} ({node['path']})\n  {msg}"
        return {"phase": phase, "kind": kind, "type": type(e).__name__, "message": msg,
                "lineno": lineno, "dbt_message": dbt_message}


# =============================================================================== plain jinja (Chapter 5)
def render_plain(text, deadline_s=None):
    """What the book's render.py does: jinja2.Template(text).render() (no dbt, no sandbox)."""
    try:
        out = _with_deadline(lambda: jinja2.Template(text).render(), deadline_s)
        return {"status": "ok", "compiled": out, "error": None}
    except RenderTimeout:
        raise
    except jinja2.TemplateSyntaxError as e:
        return {"status": "error", "compiled": None,
                "error": {"kind": "syntax", "type": type(e).__name__, "message": e.message, "lineno": e.lineno}}
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "compiled": None,
                "error": {"kind": type(e).__name__, "type": type(e).__name__, "message": str(e), "lineno": None}}


# =============================================================================== soft deadline
def _with_deadline(fn, seconds):
    """Cooperative timeout without SharedArrayBuffer: a trace function checks the clock.

    Works for pure-Python loops (Jinja templates compile to Python). It cannot stop one long C call
    (e.g. a huge `**` on integers): the worker must then be terminated by the main thread.
    """
    if not seconds:
        return fn()
    deadline = time.monotonic() + seconds
    count = [0]

    def tracer(frame, event, arg):
        count[0] += 1
        if (count[0] & 255) == 0 and time.monotonic() > deadline:
            raise RenderTimeout(f"render took more than {seconds:g}s")
        return tracer

    old = sys.gettrace()
    sys.settrace(tracer)
    try:
        return fn()
    finally:
        sys.settrace(old)
