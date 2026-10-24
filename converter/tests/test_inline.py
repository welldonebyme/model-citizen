import pytest

from converter.render.inline import glossary_key, lig, term_slug
from converter.tex.nodes import ConvertError

from .helpers import inline, make_ctx

NBSP = " "


def test_ligatures_in_prose():
    assert inline("weeks 1--3 --- and ``quoted'' text") == ["weeks 1–3 — and \"quoted\" text"]
    assert lig("`code'") == "'code'"


def test_no_ligatures_in_code_and_anti_ligature_group():
    assert inline(r"\code{--select} and \code{-{}-full-refresh}") == [
        {"t": "code", "v": "--select"}, " and ", {"t": "code", "v": "--full-refresh"}]
    assert inline("a -{}- b") == ["a -- b"]


def test_escapes_and_symbols():
    assert inline(r"\code{stg\_orders} \{\{ x \}\} 50\% \$200 \textasciitilde/x \textbackslash d") == [
        {"t": "code", "v": "stg_orders"}, " {{ x }} 50% $200 ~/x \\d"]
    assert inline(r"a\ldots{} b\ldots\ c") == ["a… b… c"]
    assert inline(r"a~b\,c") == ["a" + NBSP + "b c"]


def test_math_symbols():
    assert inline(r"a $\rightarrow$ b $\geq$ 80\% $46 + 93 = 139$ $-25.99$") == [
        "a → b ≥ 80% 46 + 93 = 139 −25.99"]


def test_math_unknown_is_error():
    with pytest.raises(ConvertError):
        inline(r"$\int x$")


def test_formatting_nodes():
    assert inline(r"\textbf{a \emph{b}} \textsf{c} \underline{d}") == [
        {"t": "b", "c": ["a ", {"t": "i", "c": ["b"]}]}, " ", {"t": "sf", "c": ["c"]}, " ", {"t": "u", "c": ["d"]}]


def test_blank_and_blank_inside_code():
    assert inline(r"the \underline{\hspace{2.5cm}} name") == ["the ", {"t": "blank"}, " name"]
    assert inline(r"\code{dbt seed \underline{\hspace{1cm}} -s x}") == [
        {"t": "code", "v": "dbt seed "}, {"t": "blank"}, {"t": "code", "v": " -s x"}]


def test_term_node_and_occurrence():
    ctx = make_ctx()
    out = inline(r"a \term{data pipelines}{pipeline de données}", ctx)
    t = out[1]
    assert t == {"t": "term", "en": ["data pipelines"], "fr": "pipeline de données", "id": "term-data-pipeline"}
    assert ctx.term_occurrences[0]["key"] == "data pipeline"


def test_glossary_key_matches_make_glossary():
    assert glossary_key(r"\code{dbt\_project.yml}") == "dbt_project.yml"
    assert glossary_key("Tables") == "table"
    assert glossary_key("class") == "class"     # -ss is not plural
    assert term_slug("dbt_project.yml") == "term-dbt-project-yml"


def test_ref_absorbs_the_label_word():
    assert inline(r"see Chapter~\ref{ch:sql} and Section~\ref{sec:sql-null}.") == [
        "see ", {"t": "ref", "label": "ch:sql", "text": "Chapter 4", "href": "/learn/ch04/"}, " and ",
        {"t": "ref", "label": "sec:sql-null", "text": "Section 4.4", "href": "/learn/ch04/ch04-s4/"}, "."]
    out = inline(r"Chapters~\ref{ch:sql} and~\ref{ch:sql}")
    assert out[0]["text"] == "Chapters 4" and out[1] == " and" + NBSP and out[2]["text"] == "4"


def test_unknown_ref_is_error():
    with pytest.raises(ConvertError, match="unknown label"):
        inline(r"\ref{nope}")


def test_objective_and_icons():
    assert inline(r"\objective{1.11} \checkbox\faCheck") == [
        {"t": "obj", "id": "1.11"}, " ", {"t": "icon", "name": "checkbox"}, {"t": "icon", "name": "check"}]
    with pytest.raises(ConvertError, match="unknown objective"):
        inline(r"\objective{9.9}")


def test_declarations_restyle_the_rest_of_the_group():
    assert inline(r"{\bfseries x} y {\small\color{muted} z}") == [{"t": "b", "c": ["x"]}, " y z"]


def test_textrm_inside_monospace_declaration():
    assert inline(r"{\ttfamily raw.orders \textrm{(table)}}") == [{"t": "code", "v": "raw.orders "}, "(table)"]


def test_url_and_key():
    assert inline(r"\url{https://github.com} \key{Ctrl+C}") == [
        {"t": "link", "href": "https://github.com", "c": ["https://github.com"]}, " ", {"t": "key", "v": "Ctrl+C"}]
