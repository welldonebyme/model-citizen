"""Make dbt-core importable/runnable under Pyodide (no threads, no _multiprocessing).

Import this module BEFORE importing dbt.
  1. multiprocessing.synchronize needs the C module _multiprocessing (POSIX semaphores) -> threading-based stand-ins.
  2. multiprocessing.pool.ThreadPool starts worker threads in __init__ (Pyodide cannot start threads)
     -> a synchronous pool that runs each job immediately in the caller (dbt's DbtThreadPool subclasses it).
     Each job runs in a "virtual thread" (contextvar) so dbt-adapters gives it its own connection, exactly as
     with real worker threads (dbt's hidden --single-threaded mode is NOT usable: it fails natively too with
     "Connection Error: Connection already closed!" on dbt-duckdb 1.11.0).
  3. concurrent.futures executor used by dbt-adapters (relation cache, catalog) -> same synchronous scheme.
  4. no processes: optional fake `git --help` for dbt debug (off by default).
  5. YAML: libyaml 0.1.7 (Pyodide) -> fall back to the pure-Python parser where libyaml 0.2.5 would succeed.
  6. env default: no anonymous usage stats (no network in the sandbox).
"""
import contextvars
import os
import sys
import threading
import types

# ---- 1. multiprocessing.synchronize ---------------------------------------------------------------
_sync = types.ModuleType("multiprocessing.synchronize")


def _wrap(factory, name):
    class _Prim:
        def __init__(self, *args, ctx=None, **kwargs):
            self._p = factory(*args, **kwargs)

        def __getattr__(self, item):
            return getattr(self._p, item)

        def __enter__(self):
            return self._p.__enter__()

        def __exit__(self, *exc):
            return self._p.__exit__(*exc)

    _Prim.__name__ = _Prim.__qualname__ = name
    return _Prim


_sync.Lock = _wrap(threading.Lock, "Lock")
_sync.RLock = _wrap(threading.RLock, "RLock")
_sync.Semaphore = _wrap(threading.Semaphore, "Semaphore")
_sync.BoundedSemaphore = _wrap(threading.BoundedSemaphore, "BoundedSemaphore")
_sync.Condition = _wrap(threading.Condition, "Condition")
_sync.Event = _wrap(threading.Event, "Event")
_sync.Barrier = _wrap(threading.Barrier, "Barrier")
sys.modules["multiprocessing.synchronize"] = _sync
import multiprocessing  # noqa: E402

multiprocessing.synchronize = _sync

# ---- 2. synchronous ThreadPool ----------------------------------------------------------------------
import multiprocessing.pool as _mpp  # noqa: E402


class _SyncResult:
    def __init__(self, value=None, exc=None):
        self._value, self._exc = value, exc

    def ready(self):
        return True

    def successful(self):
        return self._exc is None

    def wait(self, timeout=None):
        return None

    def get(self, timeout=None):
        if self._exc is not None:
            raise self._exc
        return self._value


_VTID = contextvars.ContextVar("dbt_pyodide_virtual_thread", default=0)


class _Slots:
    """N virtual worker identities (1..N), handed out round-robin, like the N threads of a real pool.
    Ids are reused across pools/executors, as OS thread idents are reused after a thread exits, so a worker
    keeps (and dbt re-uses) one connection, exactly like a real worker thread."""

    def __init__(self, n):
        self.n, self.i = max(1, int(n or 1)), 0

    def next(self):
        self.i += 1
        return 1 + (self.i - 1) % self.n


def run_in_virtual_thread(slot, fn, *args, **kwargs):
    token = _VTID.set(slot)
    try:
        return fn(*args, **kwargs)
    finally:
        _VTID.reset(token)


class SyncThreadPool:
    """Drop-in for multiprocessing.pool.ThreadPool that runs every job synchronously."""

    def __init__(self, processes=None, initializer=None, initargs=(), *args, **kwargs):
        self._processes = processes or 1
        self._slots = _Slots(self._processes)
        if initializer is not None:
            initializer(*initargs)

    def apply_async(self, func, args=(), kwds=None, callback=None, error_callback=None):
        try:
            value = run_in_virtual_thread(self._slots.next(), func, *args, **(kwds or {}))
        except BaseException as exc:  # same contract as ThreadPool: error_callback, no callback
            if error_callback is not None:
                error_callback(exc)
            return _SyncResult(exc=exc)
        if callback is not None:
            callback(value)
        return _SyncResult(value=value)

    def apply(self, func, args=(), kwds=None):
        return func(*args, **(kwds or {}))

    def map(self, func, iterable, chunksize=None):
        return [func(x) for x in iterable]

    def imap(self, func, iterable, chunksize=1):
        return (func(x) for x in iterable)

    imap_unordered = imap

    def close(self):
        pass

    def terminate(self):
        pass

    def join(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.terminate()


if os.environ.get("DBT_PYODIDE_SHIM_REAL_THREADS") != "1":  # (=1 only to reproduce the original blocker)
    _mpp.ThreadPool = SyncThreadPool

# ---- 3. connection identity per virtual thread + synchronous concurrent.futures executor -------------
import concurrent.futures  # noqa: E402

from dbt.adapters.base.connections import BaseConnectionManager  # noqa: E402


def _get_thread_identifier():
    return os.getpid(), threading.get_ident(), _VTID.get()


if os.environ.get("DBT_PYODIDE_SHIM_NO_VTID") != "1":  # (=1 only to reproduce the original blocker)
    BaseConnectionManager.get_thread_identifier = staticmethod(_get_thread_identifier)

import importlib  # noqa: E402

_ex = importlib.import_module("dbt_common.utils.executor")  # (dbt_common.utils re-exports a function named executor)


class SyncConnectingExecutor(_ex.ConnectingExecutor):
    """Replaces dbt_common's MultiThreadedExecutor (a ThreadPoolExecutor): same connection_named, no threads."""

    def __init__(self, max_workers=None, initializer=None, initargs=()):
        self._slots = _Slots(max_workers)
        if initializer is not None:
            initializer(*initargs)

    def submit(self, fn, /, *args, **kwargs):
        fut = concurrent.futures.Future()
        try:
            fut.set_result(run_in_virtual_thread(self._slots.next(), fn, *args, **kwargs))
        except Exception as exc:
            fut.set_exception(exc)
        return fut

    def connection_named(self, adapter, name):
        return adapter.connection_named(name)

    def shutdown(self, wait=True, *, cancel_futures=False):
        pass


if os.environ.get("DBT_PYODIDE_SHIM_REAL_THREADS") != "1":
    _ex.MultiThreadedExecutor = SyncConnectingExecutor

# ---- 4. no processes in WebAssembly: `git --help` (dbt debug) -------------------------------------------
# Emscripten cannot start processes ("[Errno 138] emscripten does not support processes"). dbt only shells out for
# `dbt debug` (git check), `dbt deps` from git packages and `dbt init`. With DBT_PYODIDE_FAKE_GIT=1 the git check of
# dbt debug is answered as if git were installed (a lab sandbox decision, documented, off by default).
import dbt_common.clients.system as _system  # noqa: E402

_real_run_cmd = _system.run_cmd


def _run_cmd(cwd, cmd, env=None):
    if os.environ.get("DBT_PYODIDE_FAKE_GIT") == "1" and list(cmd) == ["git", "--help"]:
        return b"usage: git [-v | --version] [-h | --help] ...", b""
    return _real_run_cmd(cwd, cmd, env)


_system.run_cmd = _run_cmd

# ---- 5. YAML: Pyodide's PyYAML is linked with libyaml 0.1.7, dbt users get libyaml 0.2.5 -------------------------
# dbt parses YAML with yaml.CSafeLoader (libyaml). libyaml 0.1.7 rejects some documents that 0.2.5 accepts, for
# example a colon inside a plain scalar of a flow mapping ({order_at: 2025-07-15 10:00:00}, the capstone's unit
# tests), and it misspells one message ("violate indentation"). So: libyaml first, exactly like dbt on a computer;
# if libyaml 0.1.7 fails but the pure-Python parser of the same PyYAML (same rules as libyaml 0.2.5 for these cases)
# reads the text, use that result; if both fail, keep libyaml's error, so dbt prints the same messages as on a
# computer ("mapping values are not allowed in this context", ...).
import yaml  # noqa: E402

_C_LOADERS = tuple(c for c in (getattr(yaml, "CSafeLoader", None), getattr(yaml, "CLoader", None), getattr(yaml, "CBaseLoader", None)) if c)
_pure_cache = {}


def _pure_twin(loader):
    """The same loader class (constructors, resolvers, dbt's CheckedLoader overrides) on the pure-Python parser."""
    if not isinstance(loader, type) or not issubclass(loader, _C_LOADERS):
        return None
    twin = _pure_cache.get(loader)
    if twin is None:
        def __init__(self, stream):  # what yaml.SafeLoader.__init__ does
            yaml.reader.Reader.__init__(self, stream)
            yaml.scanner.Scanner.__init__(self)
            yaml.parser.Parser.__init__(self)
            yaml.composer.Composer.__init__(self)
            yaml.constructor.BaseConstructor.__init__(self)
            yaml.resolver.BaseResolver.__init__(self)
        bases = (yaml.reader.Reader, yaml.scanner.Scanner, yaml.parser.Parser, yaml.composer.Composer, loader)
        twin = type(loader.__name__ + "PurePython", bases, {"__init__": __init__})
        _pure_cache[loader] = twin
    return twin


_real_yaml_load = yaml.load


def _yaml_load(stream, Loader=None, **kwargs):  # noqa: N803 (PyYAML's own argument name)
    try:
        return _real_yaml_load(stream, Loader, **kwargs)
    except yaml.MarkedYAMLError as err:
        twin = _pure_twin(Loader) if isinstance(stream, (str, bytes)) else None
        if twin is not None:
            try:
                return _real_yaml_load(stream, twin, **kwargs)
            except yaml.YAMLError:
                pass
        if isinstance(getattr(err, "problem", None), str):
            err.problem = err.problem.replace("that violate indentation", "that violates indentation")
        raise


if os.environ.get("DBT_PYODIDE_SHIM_RAW_LIBYAML") != "1":  # (=1 only to reproduce the original blocker)
    yaml.load = _yaml_load

# ---- 6. environment defaults ------------------------------------------------------------------------
# No network in the sandbox: anonymous usage stats would try to reach a tracking server.
# (Colours and the require-dbt-version check keep dbt's own defaults.)
os.environ.setdefault("DBT_SEND_ANONYMOUS_USAGE_STATS", "false")
