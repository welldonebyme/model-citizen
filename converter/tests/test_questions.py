from converter.build.questions import QuestionBuilder, count_blanks, embedded_numbers
from converter.render.blocks import BlockRenderer
from converter.tex.nodes import Env

from .helpers import make_ctx, parse


def build(tex: str, answers: str | None = None):
    ctx = make_ctx()
    r = BlockRenderer(ctx)
    qb = QuestionBuilder(r)
    (env,) = [n for n in parse(tex) if isinstance(n, Env)]
    drafts = qb.build(env)
    if answers:
        (aenv,) = [n for n in parse(answers) if isinstance(n, Env)]
        qb.attach_answers(drafts, aenv)
    return drafts


def test_label_forms_and_choices():
    tex = ("\\begin{questions}\n\\item {[Multiple choice]} Q?\n\\begin{choices}\\item a \\item b\\end{choices}\n"
           "\\item \\textbf{[Multiple select --- choose 2]} R?\n\\begin{choices}\\item a\\item b\\item c\\end{choices}\n"
           "\\item \\textsf{\\textbf{[DOMC — judge each option YES/NO independently]}}\\enspace S\n"
           "\\begin{choices}\\item x\\item y\\end{choices}\n\\end{questions}")
    ans = "\\begin{answers}\n\\item \\textbf{B.} Because.\n\\item \\textbf{A and C.} x\n\\item \\textbf{NO, YES.}\n\\end{answers}"
    a, b, c = build(tex, ans)
    assert (a.format, a.key, a.key_status) == ("mc", "B", "ok")
    assert [o["id"] for o in a.options] == ["A", "B"] and a.stem == [{"t": "p", "c": ["Q?"]}]
    assert (b.format, b.choose, b.format_label, b.key) == ("ms", 2, "Multiple select \u2014 choose 2", ["A", "C"])
    assert c.format == "domc" and c.key == {"A": False, "B": True}
    assert a.key_raw == "\\textbf{B.}"


def test_matching_table_with_markers():
    tex = ("\\begin{questions}\n\\item {[Matching]} Match.\n\\begin{center}\n\\begin{tabular}{ll}\n"
           "1. \\code{inner join} & a. all customers \\\\\n2. \\code{left join} & b. only matches \\\\\n"
           "\\end{tabular}\n\\end{center}\n\\end{questions}")
    (d,) = build(tex, "\\begin{answers}\n\\item \\textbf{1-b, 2-a.}\n\\end{answers}")
    assert d.match["left"] == [{"id": "1", "c": [{"t": "code", "v": "inner join"}]},
                               {"id": "2", "c": [{"t": "code", "v": "left join"}]}]
    assert [x["id"] for x in d.match["right"]] == ["a", "b"]
    assert d.key == {"1": "b", "2": "a"} and d.stem == [{"t": "p", "c": ["Match."]}]


def test_matching_two_lists_and_reuse():
    tex = ("\\begin{questions}\n\\item {[Matching]} Type?\n\\begin{multicols}{2}\n"
           "\\begin{enumerate}[label=\\arabic*.]\\item x\\item y\\item z\\end{enumerate}\\columnbreak\n"
           "\\begin{enumerate}[label=\\alph*.]\\item fact\\item dim\\end{enumerate}\n\\end{multicols}\n\\end{questions}")
    (d,) = build(tex, "\\begin{answers}\n\\item \\textbf{1-b, 2-a, 3-b.}\n\\end{answers}")
    assert d.key == {"1": "b", "2": "a", "3": "b"} and d.match["reuse"] is True


def test_matching_inline_markers():
    tex = ("\\begin{questions}\n\\item {[Matching]} Match each symbol: (1) \\code{.}, (2) \\code{..} --- (a) parent, "
           "(b) current.\n\\end{questions}")
    (d,) = build(tex, "\\begin{answers}\n\\item \\textbf{1-b, 2-a.}\n\\end{answers}")
    assert d.match["left"][1]["c"] == [{"t": "code", "v": ".."}]
    assert d.match["right"][1]["c"] == ["current"]
    assert d.stem == [{"t": "p", "c": ["Match each symbol:"]}]


def test_inline_build_list():
    tex = ("\\begin{questions}\n\\item {[Build list --- put in order]} Order: (a) push; (b) branch; (c) commit.\n"
           "\\end{questions}")
    (d,) = build(tex, "\\begin{answers}\n\\item \\textbf{b, c, a.}\n\\end{answers}")
    assert [o["c"] for o in d.options] == [["push"], ["branch"], ["commit"]]
    assert d.key == ["B", "C", "A"]


def test_hotspot_listing_and_embedded_numbers():
    tex = ("\\begin{questions}\n\\item {[Hotspot --- which line]} Which?\n"
           "\\begin{yamlcode}[listing options={language=yamlx,numbers=left}]\na: 1\nb: 2\n\\end{yamlcode}\n"
           "\\item {[Hotspot --- which line]} Which?\n\\begin{plaincode}\n1  mkdir x\n2  rm -r x\n\\end{plaincode}\n"
           "\\end{questions}")
    a, b = build(tex, "\\begin{answers}\n\\item \\textbf{Line 2.}\n\\item \\textbf{Line 2.}\n\\end{answers}")
    assert a.hotspot == {"codeId": "ch99-c1", "lines": 2, "numbering": "listing"} and a.key == 2
    assert b.hotspot == {"codeId": "ch99-c2", "lines": 2, "numbering": "text"} and b.key == 2


def test_embedded_numbers():
    assert embedded_numbers(" 1| a\n 2|\n 3| c") == [1, 2, 3]
    assert embedded_numbers(" 7| a\n 8| b") == [7, 8]
    assert embedded_numbers("1 a\n3 b") is None
    assert embedded_numbers("select 1") is None


def test_blanks_are_counted_in_prose_code_and_listings():
    tex = ("\\begin{questions}\n\\item {[Fill in the blank]} The \\_\\_\\_ and \\underline{\\hspace{1cm}} and "
           "\\code{git \\_\\_\\_\\_ x}\n\\begin{dbtcode}\n{{ source('____', '____') }}\n\\end{dbtcode}\n\\end{questions}")
    (d,) = build(tex)
    assert d.blanks == 5 == count_blanks(d.stem)


def test_wrong_answer_count_is_error():
    import pytest
    from converter.tex.nodes import ConvertError
    tex = "\\begin{questions}\n\\item {[Multiple choice]} Q\n\\begin{choices}\\item a\\end{choices}\n\\end{questions}"
    with pytest.raises(ConvertError, match="answers for"):
        build(tex, "\\begin{answers}\n\\item \\textbf{A.}\n\\item \\textbf{B.}\n\\end{answers}")


def test_unknown_format_label_is_error():
    import pytest
    from converter.tex.nodes import ConvertError
    with pytest.raises(ConvertError, match="unknown question format"):
        build("\\begin{questions}\n\\item {[Essay]} Write.\n\\end{questions}")
