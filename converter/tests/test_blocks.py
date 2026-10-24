import pytest

from converter.tex.nodes import ConvertError

from .helpers import blocks, make_ctx


def test_paragraphs_and_layout_groups():
    out = blocks("One\ntwo.\n\n{\\raggedright Three \\code{x}.\\par}\n\\medskip\nFour.")
    assert out == [{"t": "p", "c": ["One two."]}, {"t": "p", "c": ["Three ", {"t": "code", "v": "x"}, "."]},
                   {"t": "p", "c": ["Four."]}]


def test_paragraph_heading():
    out = blocks("\\paragraph{1. Multiple choice.} One answer.")
    assert out[0] == {"t": "h", "level": 4, "c": ["1. Multiple choice."]}
    assert out[1] == {"t": "p", "c": ["One answer."]}


def test_lists_with_enumitem_labels():
    out = blocks("\\begin{enumerate}[label=(\\alph*)]\n\\item a\n\\item b\n\\end{enumerate}")
    assert out[0]["kind"] == "ol" and out[0]["marker"] == "(a)" and len(out[0]["items"]) == 2
    out = blocks("\\begin{itemize}[label=\\checkbox]\n\\item a\n\\end{itemize}")
    assert out[0]["marker"] == "checkbox"
    out = blocks("\\begin{description}\n\\item[\\code{name}] Required.\n\\end{description}")
    assert out[0]["kind"] == "dl" and out[0]["items"][0]["term"] == [{"t": "code", "v": "name"}]


def test_list_series_resume():
    ctx = make_ctx()
    tex = ("\\begin{enumerate}[label={\\sffamily\\bfseries T\\arabic*},series=s]\n\\item a\\item b\n\\end{enumerate}"
           "\\begin{enumerate}[resume*=s]\n\\item c\n\\end{enumerate}")
    out = blocks(tex, ctx)
    assert out[0]["marker"] == "T1" and out[1]["marker"] == "T1" and out[1]["start"] == 3


def test_code_options():
    tex = ("\\begin{dbtcode}[title={models/stg\\_x.sql},listing options={language=dbtsql,numbers=left,"
           "numberstyle=\\tiny\\color{muted},numbersep=6pt},left=16pt]\nselect 1\n\n\n\\end{dbtcode}\n"
           "\\begin{outputcode}[listing options={language={},basicstyle=\\ttfamily\\scriptsize}]\n| n |\n\\end{outputcode}")
    a, b = blocks(tex)
    assert a == {"t": "code", "id": "ch99-c1", "lang": "dbt", "text": "select 1", "title": "models/stg_x.sql",
                 "lineNumbers": True, "expected": "ch99-c2"}
    assert b == {"t": "code", "id": "ch99-c2", "lang": "output", "text": "| n |", "small": True}


def test_code_title_is_monospace_no_ligature():
    (a,) = blocks("\\begin{outputcode}[title={Result: dbt ls --select x}]\nx\n\\end{outputcode}")
    assert a["title"] == "Result: dbt ls --select x"


def test_tabs_are_expanded_like_listings():
    (a,) = blocks("\\begin{plaincode}\n\tx\n\\end{plaincode}")
    assert a["text"] == "  x"


def test_unknown_code_option_is_error():
    with pytest.raises(ConvertError, match="unsupported code option"):
        blocks("\\begin{sqlcode}[fancy=1]\nx\n\\end{sqlcode}")


def test_local_code_style_sets_small():
    ctx = make_ctx()
    tex = ("\\tcbset{c8small/.style={listing options={language={},basicstyle=\\ttfamily\\scriptsize}}}\n"
           "\\begin{outputcode}[c8small]\nx\n\\end{outputcode}")
    (a,) = blocks(tex, ctx)
    assert a["small"] is True


def test_unknown_definition_is_error():
    with pytest.raises(ConvertError, match="unknown definition"):
        blocks("\\newcommand{\\foo}{bar}")


def test_booktabs_table_with_group_row_and_multicolumn():
    tex = ("\\begin{tabularx}{\\linewidth}{lLr}\n\\toprule\n\\textbf{A} & \\textbf{B} & C \\\\\n\\midrule\n"
           "\\multicolumn{3}{l}{\\textbf{Group}}\\\\\nx & y & 1 \\\\\n\\midrule\nz & w & 2 \\\\\n\\bottomrule\n\\end{tabularx}")
    (t,) = blocks(tex)
    assert t["head"] == [[{"c": [{"t": "b", "c": ["A"]}], "header": True},
                          {"c": [{"t": "b", "c": ["B"]}], "header": True},
                          {"c": ["C"], "align": "r", "header": True}]]
    assert t["rows"][0] == [{"c": [{"t": "b", "c": ["Group"]}], "colspan": 3}]
    assert t["groupRows"] == [0] and t["rules"] == [2]
    assert t["rows"][2][2] == {"c": ["2"], "align": "r"}


def test_longtable_head_and_hline_head():
    tex = ("\\begin{longtable}{ll}\n\\toprule\nH1 & H2 \\\\\n\\midrule\n\\endhead\na & b \\\\\n\\bottomrule\n"
           "\\end{longtable}")
    (t,) = blocks(tex)
    assert len(t["head"]) == 1 and t["rows"] == [[{"c": ["a"]}, {"c": ["b"]}]]
    (t,) = blocks("\\begin{tabular}{rr}\nid & user\\\\\\hline\n1 & 2\\\\\n\\end{tabular}")
    assert t["head"][0][0] == {"c": ["id"], "align": "r", "header": True}


def test_monospace_column_with_textrm_header():
    tex = ("\\begin{tabularx}{\\linewidth}{>{\\ttfamily}l L}\n\\toprule\n\\textrm{\\textbf{Table}} & B\\\\\n"
           "\\midrule\nraw.orders & x \\\\\n\\bottomrule\n\\end{tabularx}")
    (t,) = blocks(tex)
    assert t["head"][0][0]["c"] == [{"t": "b", "c": ["Table"]}]
    assert t["rows"][0][0]["c"] == [{"t": "code", "v": "raw.orders"}]


def test_callout_with_title_and_lab_with_labtag():
    out = blocks("\\begin{tipbox}[title={My tip}]\nHello.\n\\end{tipbox}\n"
                 "\\begin{labbox}{Do it}\\label{lab:x}\n\\labtag{1.1, CP0-SQL}\nStep.\n\\end{labbox}")
    assert out[0] == {"t": "callout", "kind": "tip", "title": ["My tip"], "blocks": [{"t": "p", "c": ["Hello."]}]}
    assert out[1] == {"t": "lab", "id": "ch99-lab1", "title": ["Do it"], "objectives": ["1.1", "CP0-SQL"],
                      "blocks": [{"t": "p", "c": ["Step."]}], "anchor": "lab-x"}


def test_exambox_objectives():
    out = blocks("\\begin{exambox}\n\\begin{itemize}\n\\item \\objective{1.1} Sources.\n"
                 "\\item \\objective{1.4}\\objective{EXAM} Two.\n\\item \\textbf{Setup:} none.\n\\end{itemize}\n\\end{exambox}")
    assert out == [{"t": "objectives", "items": [
        {"id": "1.1", "c": ["Sources."]}, {"id": "1.4", "ids": ["1.4", "EXAM"], "c": ["Two."]},
        {"id": None, "c": [{"t": "b", "c": ["Setup:"]}, " none."]}]}]


def test_tikz_figure_record():
    ctx = make_ctx()
    (f,) = blocks("\\begin{center}\n\\begin{tikzpicture}\n\\node {a};\n\\end{tikzpicture}\n\\end{center}", ctx)
    assert f == {"t": "figure", "id": "ch99-fig1", "src": "figures/ch99-fig1.svg", "alt": ""}
    assert ctx.figures[0]["line"] == 2 and len(ctx.figures[0]["sha1"]) == 40


def test_figure_env_caption_and_label():
    out = blocks("\\begin{figure}[ht]\n\\centering\n\\begin{tikzpicture}\n\\end{tikzpicture}\n"
                 "\\caption{Two paths.}\\label{fig:a}\n\\end{figure}")
    assert out[0]["caption"] == ["Two paths."] and out[0]["anchor"] == "fig-a"
