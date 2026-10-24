import re

import pytest

from converter.config import BOOK, RULES
from converter.rewrite import DETECT, PathRewriter, scan_book

RW = PathRewriter(RULES / "paths.yaml")


def r(s):
    return RW.apply(s)[0]


# Every distinct path form of the book -> what the website shows (kit layout of converter/reference/kit).
MAPPING = [
    ("cp -R ~/Documents/Adnane/dbt-bible/labs/data ~/dbt-course/practice/",
     "cp -R ~/dbt-course/kit/data ~/dbt-course/practice/"),
    ("cp ~/Documents/Adnane/dbt-bible/labs/setup.sql ~/dbt-course/practice/",
     "cp ~/dbt-course/kit/setup.sql ~/dbt-course/practice/"),
    ("cp -r ~/Documents/Adnane/dbt-bible/labs/updates ~/dbt-course/practice/",
     "cp -r ~/dbt-course/kit/updates ~/dbt-course/practice/"),
    ("cp ~/Documents/Adnane/dbt-bible/labs/data/*.csv ci/raw/data/", "cp ~/dbt-course/kit/data/*.csv ci/raw/data/"),
    ("Open the five CSV files in ~/Documents/Adnane/dbt-bible/labs/data/ with",
     "Open the five CSV files in ~/dbt-course/kit/data/ with"),
    ("or directly in ~/Documents/Adnane/dbt-bible/labs.", "or directly in ~/dbt-course/kit."),
    ("$ git remote add reference ~/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt   # once only",
     "$ git remote add reference ~/dbt-course/kit/jaffle_dbt.bundle   # once only"),
    ("From /Users/mac/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt",
     "From /Users/you/dbt-course/kit/jaffle_dbt.bundle"),
    ("$ B=~/Documents/Adnane/dbt-bible/labs/practice-project/bugs", "$ B=~/dbt-course/kit/bugs"),
    ("$ git remote add --no-tags solution ~/Documents/Adnane/dbt-bible/labs/capstone/shopflow_dbt",
     "$ git remote add --no-tags solution ~/dbt-course/kit/capstone/shopflow_dbt.bundle"),
    ("From /Users/mac/Documents/Adnane/dbt-bible/labs/capstone/shopflow_dbt",
     "From /Users/you/dbt-course/kit/capstone/shopflow_dbt.bundle"),
    ("$ python -I ~/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb \"select 1\"",
     "$ python -I ~/dbt-course/kit/tools/run_sql.py --db ../practice/practice.duckdb \"select 1\""),
    ("(~/Documents/Adnane/dbt-bible).", "(~/dbt-course/kit)."),
    # relative paths written in the prose (inline code)
    ("labs/updates/day2.sql", "updates/day2.sql"),
    ("labs/practice-project/bugs/", "~/dbt-course/kit/bugs/"),
    ("labs/capstone/", "~/dbt-course/kit/capstone/"),
    ("labs/capstone/seeds/", "~/dbt-course/kit/capstone/seeds/"),
    ("labs/capstone", "~/dbt-course/kit/capstone"),
    # the author's home folder
    ("Catalog written to /Users/mac/dbt-course/jaffle_dbt/target/catalog.json",
     "Catalog written to /Users/you/dbt-course/jaffle_dbt/target/catalog.json"),
    ("'profiles_dir': '/Users/mac/.dbt'", "'profiles_dir': '/Users/you/.dbt'"),
    ("home folder (/Users/mac), and", "home folder (/Users/you), and"),
    ("project path </Users/mac/dbt-course/dbt_project.yml>", "project path </Users/you/dbt-course/dbt_project.yml>"),
    ("/Users/mac", "/Users/you"),
    # prose that names the book folder
    (" from the bible folder into your workspace:", " from the kit folder into your workspace:"),
    (" in your bible folder simulates the next loading day", " in your kit folder simulates the next loading day"),
    (" of the bible (", " of the practice kit ("),
    ("in the folder labs/practice-project/bugs/ of the bible", "in the folder ~/dbt-course/kit/bugs/ of the practice kit"),
    (" The bible contains the finished project, with one Git tag per chapter.",
     " The practice kit contains the finished project, with one Git tag per chapter."),
    (" remote is the bible's read-only copy.", " remote is the kit's read-only copy."),
    (" (the helper of the bible; you can also use ", " (the helper of the kit; you can also use "),
    ("The bible folder contains everything you need in ", "The capstone kit contains everything you need in "),
    (" the bible folder: it would write ", " the kit folder: it would write "),
]


@pytest.mark.parametrize("book,web", MAPPING)
def test_mapping(book, web):
    assert r(book) == web
    assert not DETECT.search(web)


def test_unrelated_text_is_untouched():
    for s in ["/Users/macro/x", "~/dbt-course/jaffle_dbt", "dbt_adnane", "Documents/Adnane is mine",
              "dbt-labs/codegen", "https://github.com/dbt-labs/dbt-utils", "this bible", "The bible has ten parts",
              "github.com/dbt-labs/capstone", "mylabs/updates/x", "~/dbt-course/kit/data"]:
        assert r(s) == s


def test_idempotent():
    for book, web in MAPPING:
        assert r(web) == web


def test_tree_keeps_the_book_text():
    log = []
    tree = {"t": "code", "id": "ch02-c1", "lang": "bash", "text": "$ cd ~/Documents/Adnane/dbt-bible/labs"}
    RW.tree(tree, log, "x")
    assert tree["text"] == "$ cd ~/dbt-course/kit"
    assert tree["textBook"] == "$ cd ~/Documents/Adnane/dbt-bible/labs"
    inl = {"t": "code", "v": "/Users/mac"}
    RW.tree(inl, log, "x")
    assert inl == {"t": "code", "v": "/Users/you", "textBook": "/Users/mac"}
    assert len(log) == 2
    keep = {"keyRaw": "/Users/mac", "href": "/Users/mac"}
    RW.tree(keep, log, "x")
    assert keep == {"keyRaw": "/Users/mac", "href": "/Users/mac"}


def test_every_book_occurrence_is_mapped_and_every_rule_used():
    occ = scan_book(BOOK, RULES / "paths.yaml")
    assert len(occ) >= 96
    bad = [o for o in occ if o.get("unmapped") and not o.get("allowed")]
    assert not bad, bad[:5]
    used = {x for o in occ for x in o["rules"]}
    assert {rule.id for rule in RW.rules} <= used
    # the only allowed leftovers are the lines of the ch02-fig1 TikZ source (replaced by a site figure)
    allowed = {o["where"] for o in occ if o.get("allowed")}
    assert all(re.match(r"parts/part1/ch02-command-line\.tex:\d+$", w) for w in allowed)


def test_created_by_labs_entries_say_which_step():
    for c in RW.created:
        assert c["path"].startswith("~/") and c["by"]
