from converter.config import RULES
from converter.rewrite import PathRewriter

RW = PathRewriter(RULES / "paths.yaml")


def r(s):
    return RW.apply(s)[0]


def test_book_folder_becomes_the_kit():
    assert r("cp -R ~/Documents/Adnane/dbt-bible/labs/data ~/dbt-course/practice/") == \
        "cp -R ~/dbt-course/kit/labs/data ~/dbt-course/practice/"
    assert r("python -I ~/Documents/Adnane/dbt-bible/tools/run_sql.py --db x") == \
        "python -I ~/dbt-course/kit/tools/run_sql.py --db x"
    assert r("(~/Documents/Adnane/dbt-bible).") == "(~/dbt-course/kit)."


def test_absolute_paths():
    assert r("From /Users/mac/Documents/Adnane/dbt-bible/labs/capstone/shopflow_dbt") == \
        "From /Users/you/dbt-course/kit/labs/capstone/shopflow_dbt"
    assert r("Catalog written to /Users/mac/dbt-course/jaffle_dbt/target/catalog.json") == \
        "Catalog written to /Users/you/dbt-course/jaffle_dbt/target/catalog.json"
    assert r("'profiles_dir': '/Users/mac/.dbt'") == "'profiles_dir': '/Users/you/.dbt'"
    assert r("home folder (/Users/mac), and") == "home folder (/Users/you), and"
    assert r("project path </Users/mac/dbt-course/dbt_project.yml>") == \
        "project path </Users/you/dbt-course/dbt_project.yml>"


def test_unrelated_text_is_untouched():
    for s in ["/Users/macro/x", "~/dbt-course/jaffle_dbt", "dbt_adnane", "Documents/Adnane is mine"]:
        assert r(s) == s


def test_tree_keeps_the_book_text():
    log = []
    tree = {"t": "code", "id": "ch02-c1", "lang": "bash", "text": "$ cd ~/Documents/Adnane/dbt-bible/labs"}
    RW.tree(tree, log, "x")
    assert tree["text"] == "$ cd ~/dbt-course/kit/labs"
    assert tree["textBook"] == "$ cd ~/Documents/Adnane/dbt-bible/labs"
    inl = {"t": "code", "v": "/Users/mac"}
    RW.tree(inl, log, "x")
    assert inl == {"t": "code", "v": "/Users/you", "textBook": "/Users/mac"}
    assert len(log) == 2
    keep = {"keyRaw": "/Users/mac", "href": "/Users/mac"}
    RW.tree(keep, log, "x")
    assert keep == {"keyRaw": "/Users/mac", "href": "/Users/mac"}
