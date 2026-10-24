"""Integration: the real book (read only). Slow-ish (~10 s)."""
import json

import pytest

from converter.config import BOOK, INVENTORY, OVERRIDES, RULES


@pytest.fixture(scope="module")
def built():
    from converter.build.book import run
    from converter.build.output import assemble
    files, info = assemble(run(BOOK, OVERRIDES), BOOK, RULES, OVERRIDES)
    return None, files, info


def test_acceptance_on_the_real_book(built):
    from converter.check import run_checks
    _, files, _ = built
    R = run_checks(files, json.loads(INVENTORY.read_text()))
    failed = [i for i in R.items if not i["ok"]]
    assert not failed, failed


def test_build_is_deterministic(built):
    from converter.__main__ import dump
    from converter.build.book import run
    from converter.build.output import assemble
    _, files, _ = built
    res2 = run(BOOK, OVERRIDES)
    files2, _ = assemble(res2, BOOK, RULES, OVERRIDES)
    assert sorted(files) == sorted(files2)
    for k in files:
        assert dump(files[k]) == dump(files2[k]), k


def test_book_is_internally_consistent(built):
    _, _, info = built
    assert info["problems"] == []


def test_every_book_path_occurrence_is_rewritten(built):
    _, files, info = built
    blob = json.dumps({k: v for k, v in files.items()}, ensure_ascii=False)
    # outside textBook/titleBook/keyRaw copies, no book-local path remains
    import re
    for k, v in files.items():
        def walk(o):
            if isinstance(o, dict):
                for kk, vv in o.items():
                    if kk in ("textBook", "titleBook", "keyRaw", "alt", "description"):  # alt: figure text, owned by the figure agent
                        continue
                    walk(vv)
            elif isinstance(o, list):
                for x in o:
                    walk(x)
            elif isinstance(o, str):
                assert "Documents/Adnane" not in o and not re.search(r"/Users/mac\b", o), (k, o[:120])
        walk(v)
    assert info["pathOccurrences"] and blob
