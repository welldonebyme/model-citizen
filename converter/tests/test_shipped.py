import json
import subprocess
import sys

from converter.config import ACADEMY
from converter.tools.check_shipped import PRIVATE, _hits_in_text, scan


def test_private_pattern():
    for s in ["/Users/mac/x", "/Users/mac", "cd ~/Documents/Adnane/dbt-bible", "dbt-bible/labs/setup.sql"]:
        assert PRIVATE.search(s), s
    for s in ["/Users/machine/x", "/Users/you/dbt-course", "the dbt bible", "~/dbt-course/kit/updates"]:
        assert not PRIVATE.search(s), s


def test_hits_report_line_numbers():
    out = []
    _hits_in_text("ok\ncp -r ~/Documents/Adnane/dbt-bible/labs/updates .\n", "f.md", out)
    assert len(out) == 1 and out[0].startswith("f.md:2:")


def test_book_paths_tool_applies_the_rules():
    src = {"updates/README.md": "cp -r ~/Documents/Adnane/dbt-bible/labs/updates ~/dbt-course/practice/\n"}
    r = subprocess.run([sys.executable, "-m", "converter.tools.book_paths"], cwd=ACADEMY, input=json.dumps(src),
                       capture_output=True, text=True, check=True)
    assert json.loads(r.stdout) == {"updates/README.md": "cp -r ~/dbt-course/kit/updates ~/dbt-course/practice/\n"}


def test_shipped_files_are_clean():
    hits, counts = scan()
    assert counts["bundles"] == 2 and counts["zip_members"] > 0 and counts["files"] > 0
    assert hits == []
