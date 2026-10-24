"""fnmatch and pathlib.glob reference results from Python 3.12 (the interpreter of the verification env).

    .venv-verify/.venv/bin/python -I -B site/tests/selector/tools/pyfixtures.py <checkout of jaffle ch25>
"""
import fnmatch
import json
import sys
from pathlib import Path

FIX = Path(__file__).resolve().parents[1] / "fixtures"
names = ["stg_orders", "stg_jaffle_shop__orders", "fct_orders", "fct_order_items", "a.b", "a/b", "[x]", "x]", "-", "!",
         "abc", "ABC", "a-c", "b", "^x", "a\\b", "", ".hidden", "dim_customers_v1", "Ünïcode", "tab\tx", "a\nb", "z"]
patterns = ["*", "stg_*", "*orders", "?tg_*", "[sf]*", "[!s]*", "[a-c]*", "[z-a]*", "[]x]", "[!]x]", "[", "[abc", "a[", "*]",
            "[-]", "[a-]", "[!a-]", "[\\]*", "a\\b", "[^x]*", "[[]x]", "*.*", "a?b", "*_v?", "", "?", "**", "[!]", "[]",
            "[a-c-e]", "[--0]", "[!--0]*", "a*b*c", "[!!]", "ABC", "a[bc", "[a&&b]", "[a~~b]", "[a||b]", "*\n*"]
fn = [[n, p, fnmatch.fnmatch(n, p)] for n in names for p in patterns]

root = Path(sys.argv[1])
skip = ("target", "logs", "dbt_packages")
globs = ["models", "models/", "models/*", "models/**", "**", "**/", "models/**/*.sql", "models/*/*.yml", "*/*", "tests",
         "seeds/*.csv", "models/marts/*.sql", "models/marts/dim_*", "models/[ms]*", "models/**/", "*.yml", "**/*.py",
         "models/**/**/*.yml", "models/staging/../marts", "./models", "models//marts", ".git*", "*", "nope", "models/nope/*",
         "models/marts/fct_orders.sql", "models/marts/fct_orders.sql/", "M*", "**/_*", "a**b"]
gl = {}
for g in globs:
    try:
        res = sorted({str(p.relative_to(root)) for p in root.glob(g)})
        gl[g] = [r for r in res if r.split("/")[0] not in skip]
    except Exception as e:  # noqa: BLE001
        gl[g] = {"error": f"{type(e).__name__}: {e}"}
(FIX / "python-reference.json").write_text(json.dumps({"fnmatch": fn, "glob": gl}, ensure_ascii=False, indent=0) + "\n")
print(len(fn), len(gl))
