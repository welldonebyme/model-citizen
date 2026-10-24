import pytest
import yaml

from converter.build.output import load_question_map
from converter.config import OVERRIDES
from converter.tex.nodes import ConvertError

QIDS = ["q-ch07-01", "q-ch07-02", "q-ch07-03"]
LESSONS = {"ch07-s1", "ch07-s2", "ch08-s1"}
OBJS = {"1.2", "1.3", "PLAN"}


def write(tmp_path, questions):
    (tmp_path / "question-map.yaml").write_text(yaml.safe_dump({"questions": questions}))
    return tmp_path


def good():
    return {"q-ch07-01": {"lesson": "ch07-s1", "objective": "1.2"},
            "q-ch07-02": {"lesson": "ch07-s2", "objective": "1.3"},
            "q-ch07-03": {"lesson": "ch07-s1", "objective": "PLAN"}}


def test_valid_map_is_returned(tmp_path):
    m = load_question_map(write(tmp_path, good()), QIDS, LESSONS, OBJS)
    assert m["q-ch07-02"]["lesson"] == "ch07-s2"


@pytest.mark.parametrize("change,message", [
    (lambda m: m.update({"q-ch07-09": {"lesson": "ch07-s1", "objective": "1.2"}}), "unknown chapter question"),
    (lambda m: m["q-ch07-01"].update(lesson="ch07-s9"), "unknown lesson"),
    (lambda m: m["q-ch07-01"].update(lesson="ch08-s1"), "another chapter"),
    (lambda m: m["q-ch07-01"].update(objective="9.9"), "unknown objective"),
    (lambda m: m.pop("q-ch07-03"), "not mapped"),
])
def test_invalid_maps_fail(tmp_path, change, message):
    m = good()
    change(m)
    with pytest.raises(ConvertError, match=message):
        load_question_map(write(tmp_path, m), QIDS, LESSONS, OBJS)


def test_the_real_map_covers_the_487_chapter_questions():
    data = yaml.safe_load((OVERRIDES / "question-map.yaml").read_text())["questions"]
    assert len(data) == 487
    for qid, e in data.items():
        assert e["lesson"].split("-")[0] == qid.split("-")[1]
        assert e["objective"] and e["confidence"] in ("high", "medium", "low")
