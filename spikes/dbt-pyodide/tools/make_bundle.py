"""Pack the practice kit + project tags + pre-installed dbt packages into one JSON {path: text} for the browser.
  python3 tools/make_bundle.py ch07 ch13 ch14 ch22   -> web/bundle.json
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABS = "/Users/mac/Documents/Adnane/dbt-bible/labs"
out = {}


def add(src, prefix, skip=()):
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in skip]
        for f in files:
            p = os.path.join(root, f)
            out[prefix + "/" + os.path.relpath(p, src)] = open(p, encoding="utf-8").read()


for tag in sys.argv[1:]:
    add(os.path.join(ROOT, "projects", tag), f"projects/{tag}")
add(os.path.join(ROOT, "packages", "dbt_packages"), "dbt_packages")
add(os.path.join(ROOT, "profiles"), "profiles")
out["labs/setup.sql"] = open(os.path.join(LABS, "setup.sql")).read()
add(os.path.join(LABS, "data"), "labs/data")
add(os.path.join(LABS, "updates"), "labs/updates")
for f in os.listdir(os.path.join(ROOT, "scenarios")):
    out["scenarios/" + f] = open(os.path.join(ROOT, "scenarios", f)).read()
out["py/dbt_session.py"] = open(os.path.join(ROOT, "py", "dbt_session.py")).read()
json.dump(out, open(os.path.join(ROOT, "web", "bundle.json"), "w"))
print(len(out), "files,", round(os.path.getsize(os.path.join(ROOT, "web", "bundle.json")) / 1e6, 2), "MB")
