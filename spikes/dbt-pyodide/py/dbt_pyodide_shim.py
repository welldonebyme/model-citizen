"""Make dbt-core importable/runnable under Pyodide (no threads, no _multiprocessing).

Import this module BEFORE importing dbt.
  1. multiprocessing.synchronize needs the C module _multiprocessing (POSIX semaphores) -> threading-based stand-ins.
  2. multiprocessing.pool.ThreadPool starts worker threads in __init__ (Pyodide cannot start threads)
     -> a synchronous pool that runs each job immediately in the caller (dbt's DbtThreadPool subclasses it).
     Each job runs in a "virtual thread" (contextvar) so dbt-adapters gives it its own connection, exactly as
     with real worker threads (dbt's hidden --single-threaded mode is NOT usable: it fails natively too with
     "Connection Error: Connection already closed!" on dbt-duckdb 1.11.0).
  3. concurrent.futures executor used by dbt-adapters (relation cache, catalog) -> same synchronous scheme.
  4. env defaults: no anonymous usage stats (network), no colours, no version check.
"""
import contextvars
import itertools
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
_VTID_COUNTER = itertools.count(1)


def run_in_virtual_thread(fn, *args, **kwargs):
    token = _VTID.set(next(_VTID_COUNTER))
    try:
        return fn(*args, **kwargs)
    finally:
        _VTID.reset(token)


class SyncThreadPool:
    """Drop-in for multiprocessing.pool.ThreadPool that runs every job synchronously."""

    def __init__(self, processes=None, initializer=None, initargs=(), *args, **kwargs):
        self._processes = processes or 1
        if initializer is not None:
            initializer(*initargs)

    def apply_async(self, func, args=(), kwds=None, callback=None, error_callback=None):
        try:
            value = run_in_virtual_thread(func, *args, **(kwds or {}))
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


_mpp.ThreadPool = SyncThreadPool

# ---- 3. connection identity per virtual thread + synchronous concurrent.futures executor -------------
import concurrent.futures  # noqa: E402

from dbt.adapters.base.connections import BaseConnectionManager  # noqa: E402


def _get_thread_identifier():
    return os.getpid(), threading.get_ident(), _VTID.get()


BaseConnectionManager.get_thread_identifier = staticmethod(_get_thread_identifier)

import importlib  # noqa: E402

_ex = importlib.import_module("dbt_common.utils.executor")  # (dbt_common.utils re-exports a function named executor)


class SyncConnectingExecutor(_ex.ConnectingExecutor):
    """Replaces dbt_common's MultiThreadedExecutor (a ThreadPoolExecutor): same connection_named, no threads."""

    def __init__(self, max_workers=None, initializer=None, initargs=()):
        if initializer is not None:
            initializer(*initargs)

    def submit(self, fn, /, *args, **kwargs):
        fut = concurrent.futures.Future()
        try:
            fut.set_result(run_in_virtual_thread(fn, *args, **kwargs))
        except Exception as exc:
            fut.set_exception(exc)
        return fut

    def connection_named(self, adapter, name):
        return adapter.connection_named(name)

    def shutdown(self, wait=True, *, cancel_futures=False):
        pass


_ex.MultiThreadedExecutor = SyncConnectingExecutor

# ---- 4. environment defaults ------------------------------------------------------------------------
for k, v in {
    "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
    "DBT_USE_COLORS": "false",
    "DBT_VERSION_CHECK": "false",
}.items():
    os.environ.setdefault(k, v)
