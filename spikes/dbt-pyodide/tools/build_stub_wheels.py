"""Build two tiny pure-Python wheels from py/:
  dbt_extractor-0.6.0+pyodidestub-py3-none-any.whl  (pure-Python stand-in for the Rust dbt-extractor)
  dbt_pyodide_shim-0.1.0-py3-none-any.whl            (threads / _multiprocessing shims, import before dbt)
Usage: python3 tools/build_stub_wheels.py  -> writes wheels/
"""
import base64
import hashlib
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "wheels")


def build(dist, version, files, summary):
    os.makedirs(OUT, exist_ok=True)
    tag = "py3-none-any"
    name = f"{dist}-{version}-{tag}.whl"
    distinfo = f"{dist}-{version}.dist-info"
    entries = dict(files)
    entries[f"{distinfo}/METADATA"] = f"Metadata-Version: 2.1\nName: {dist.replace('_', '-')}\nVersion: {version}\nSummary: {summary}\n".encode()
    entries[f"{distinfo}/WHEEL"] = f"Wheel-Version: 1.0\nGenerator: dbt-pyodide-spike\nRoot-Is-Purelib: true\nTag: {tag}\n".encode()
    entries[f"{distinfo}/top_level.txt"] = ("\n".join(sorted({p.split("/")[0].removesuffix(".py") for p in files})) + "\n").encode()
    record = []
    for p, data in entries.items():
        h = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record.append(f"{p},sha256={h},{len(data)}")
    record.append(f"{distinfo}/RECORD,,")
    entries[f"{distinfo}/RECORD"] = ("\n".join(record) + "\n").encode()
    with zipfile.ZipFile(os.path.join(OUT, name), "w", zipfile.ZIP_DEFLATED) as z:
        for p, data in entries.items():
            z.writestr(p, data)
    print("wrote", os.path.join(OUT, name))


rd = lambda p: open(os.path.join(ROOT, "py", p), "rb").read()
build("dbt_extractor", "0.6.0+pyodidestub", {"dbt_extractor/__init__.py": rd("dbt_extractor/__init__.py")},
      "Pure-Python stand-in for dbt-extractor (static parser subset) for Pyodide")
build("dbt_pyodide_shim", "0.1.0", {"dbt_pyodide_shim.py": rd("dbt_pyodide_shim.py")},
      "Threads/_multiprocessing shims that let dbt-core run in Pyodide")
