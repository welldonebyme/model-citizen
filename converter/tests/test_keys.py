from converter.build import keys as K

OPTS = ["A", "B", "C", "D", "E"]


def test_mc():
    assert K.parse_mc("B.", OPTS).key == "B"
    assert K.parse_mc("B (8080).", OPTS).key == "B"
    assert K.parse_mc("F.", OPTS).status == "todo"
    assert K.parse_mc("B and C.", OPTS).status == "todo"


def test_ms():
    assert K.parse_ms("A and C.", OPTS, 2).key == ["A", "C"]
    assert K.parse_ms("A, C, E.", OPTS, 3).key == ["A", "C", "E"]
    assert K.parse_ms("B, D", OPTS, 2).key == ["B", "D"]          # mock form
    assert K.parse_ms("A and C.", OPTS, 3).status == "todo"         # wrong count
    assert K.parse_ms("A or C.", OPTS, 2).status == "todo"


def test_order():
    assert K.parse_order("b, d, e, a, c.", OPTS).key == ["B", "D", "E", "A", "C"]
    assert K.parse_order("B, D, A, C", ["A", "B", "C", "D"]).key == ["B", "D", "A", "C"]
    assert K.parse_order("B, D, A.", OPTS).status == "todo"         # not a permutation


def test_order_words():
    opts = [{"id": "A", "c": ["Test"]}, {"id": "B", "c": ["Do"]}, {"id": "C", "c": ["Review"]}, {"id": "D", "c": ["Read"]}]
    par = [{"t": "b", "c": ["Read, Do, Test, Review."]}]
    assert K.parse_order_words(par, opts).key == ["D", "B", "A", "C"]
    par = ["Read → Do → Test → Review. Then repeat."]
    assert K.parse_order_words(par, opts).key == ["D", "B", "A", "C"]
    assert K.parse_order_words([{"t": "b", "c": ["Read, Do, Sleep, Review."]}], opts).status == "todo"


def test_hotspot():
    assert K.parse_hotspot("Line 9.").key == 9
    assert K.parse_hotspot("Line 9").key == 9
    assert K.parse_hotspot("The second part.").status == "todo"


def test_match():
    assert K.parse_match("1-b, 2-c, 3-d, 4-a.", ["1", "2", "3", "4"], ["a", "b", "c", "d"]).key == \
        {"1": "b", "2": "c", "3": "d", "4": "a"}
    assert K.parse_match("1–d, 2–c, 3–b, 4–a.", ["1", "2", "3", "4"], list("abcd")).key["1"] == "d"
    assert K.parse_match("1-c 2-a 3-b", ["1", "2", "3"], ["A", "B", "C"]).key == {"1": "C", "2": "A", "3": "B"}
    assert K.parse_match("1-b, 2-b.", ["1", "2", "3"], ["a", "b"]).status == "todo"   # item 3 missing


def test_domc_forms():
    o = ["A", "B", "C", "D"]
    want = {"A": True, "B": False, "C": True, "D": False}
    assert K.parse_domc_text("YES, NO, YES, NO.", o).key == want
    assert K.parse_domc_text("A: YES, B: NO, C: YES, D: NO.", o).key == want
    assert K.parse_domc_text("A: YES. B: NO. C: YES. D: NO.", o).key == want
    assert K.parse_domc_text("A-YES, B-NO, C-YES, D-NO", o).key == want
    assert K.parse_domc_text("A YES, B NO, C YES, D NO", o).key == want
    assert K.parse_domc_text("A:Y B:N C:Y D:N", o).key == want
    assert K.parse_domc_text("YES, NO, YES.", o).status == "todo"
    par = [{"t": "b", "c": ["A: NO"]}, " (why). ", {"t": "b", "c": ["B: YES"]}, " (why)."]
    assert K.parse_domc_bolds(par, ["A", "B"]).key == {"A": False, "B": True}


def test_fill():
    b = lambda *c: {"t": "b", "c": list(c)}
    code = lambda v: {"t": "code", "v": v}
    assert K.parse_fill([b("table."), " For example ..."], 1).key == {"accepted": ["table"]}
    assert K.parse_fill([b(code("having"), "."), " filters groups"], 1).key == {"accepted": ["having"]}
    assert K.parse_fill([b("65, 2, 65.")], 3).key == {"blanks": [["65"], ["2"], ["65"]]}
    assert K.parse_fill([b("3"), " and ", b("2"), "."], 2).key == {"blanks": [["3"], ["2"]]}
    r = K.parse_fill([b(code("-{}-full-refresh")), " (short form ", code("-f"), ")."], 1)
    assert r.status == "todo" and r.key == {"accepted": ["-{}-full-refresh"]}
    assert K.parse_fill([b(code("a"), " or ", code("b"), ".")], 1).status == "todo"
    assert K.parse_fill(["no bold"], 1).status == "todo"
    assert K.parse_fill([b("x.")], 2).status == "todo"


def test_mock_fill():
    code = lambda v: {"t": "code", "v": v}
    assert K.parse_mock_fill([code("shop"), ", ", code("orders_raw")], 2).key == {"blanks": [["shop"], ["orders_raw"]]}
    assert K.parse_mock_fill(["3 ; 2026-10-19"], 2).key == {"blanks": [["3"], ["2026-10-19"]]}
    assert K.parse_mock_fill(["database"], 1).key == {"accepted": ["database"]}
    assert K.parse_mock_fill(["test"], 2).status == "todo"


def test_validate():
    q = {"format": "match", "key": {"1": "a", "2": "a"}, "match": {"left": [{"id": "1"}, {"id": "2"}],
                                                                     "right": [{"id": "a"}, {"id": "b"}]}}
    assert "bijection" in K.validate(q)
    q["match"]["right"] = [{"id": "a"}]
    q["match"]["reuse"] = True
    assert K.validate(q) is None
    assert K.validate({"format": "hotspot", "key": 11, "hotspot": {"lines": 10}}) is not None
    assert K.validate({"format": "hotspot", "key": 10, "hotspot": {"lines": 10}}) is None
    assert K.validate({"format": "fill", "key": {"blanks": [["a"]]}, "blanks": 2}) is not None
