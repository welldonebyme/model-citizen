import hashlib

import pytest

from converter.tex.nodes import Cmd, ConvertError, Env, Group, Par, Space, Text
from converter.tex.parser import Parser, mask_comments
from converter.tex.nodes import Source

from .helpers import parse


def kinds(nodes):
    return [type(n).__name__ for n in nodes]


def test_space_after_control_word_is_skipped():
    nodes = parse(r"a\ldots b")
    assert kinds(nodes) == ["Text", "Cmd", "Text"]


def test_space_after_argument_is_kept():
    nodes = parse(r"\textbf{a} b")
    assert kinds(nodes) == ["Cmd", "Space", "Text"]


def test_single_newline_is_space_blank_line_is_par():
    assert kinds(parse("a\nb")) == ["Text", "Space", "Text"]
    assert kinds(parse("a\n\nb")) == ["Text", "Space", "Par", "Text"]
    # like TeX, every empty line is a \par (consecutive ones are harmless)
    assert kinds(parse("a\n   \n\n  b")) == ["Text", "Space", "Par", "Par", "Text"]


def test_comment_swallows_end_of_line_and_indentation():
    assert kinds(parse("a%comment\n   b")) == ["Text", "Text"]
    assert kinds(parse("a %c\nb")) == ["Text", "Space", "Text"]
    # a comment line between paragraphs keeps the paragraph break
    assert Par in map(type, parse("a\n% c\n\nb"))


def test_escaped_percent_is_not_a_comment():
    nodes = parse(r"50\% done")
    assert [n.name for n in nodes if isinstance(n, Cmd)] == ["%"]


def test_optional_argument_lookahead_and_star():
    (sec,) = [n for n in parse(r"\section*{Title}") if isinstance(n, Cmd)]
    assert sec.star and sec.args[1].raw == "Title"
    (br,) = [n for n in parse(r"a\\[0.3em] b") if isinstance(n, Cmd)]
    assert br.name == "\\" and br.args[0].raw == "0.3em"


def test_verbatim_code_body_is_exact():
    tex = "\\begin{sqlcode}[title={a\\_b}]\nselect '%' -- {x}\n  \\end not here\n\\end{sqlcode}\n"
    (env,) = [n for n in parse(tex) if isinstance(n, Env)]
    assert env.body == "select '%' -- {x}\n  \\end not here"
    assert env.args[0].raw == "title={a\\_b}"


def test_verbatim_multiline_options():
    tex = "\\begin{bashcode}[listing options={language=bashx,\n  keywordstyle=x}]\n$ ls\n\\end{bashcode}"
    (env,) = [n for n in parse(tex) if isinstance(n, Env)]
    assert env.body == "$ ls"


def test_text_after_verbatim_options_is_an_error():
    with pytest.raises(ConvertError, match="same line"):
        parse("\\begin{sqlcode} select 1\n\\end{sqlcode}")


def test_tikz_is_raw_with_exact_source():
    tex = "x\n\\begin{tikzpicture}[a]\n\\node {\\textbf{y}}; % \\end{tikzpicture}\n\\end{tikzpicture}\n"
    (env,) = [n for n in parse(tex) if isinstance(n, Env)]
    assert env.body.startswith("\\begin{tikzpicture}") and env.body.endswith("\\end{tikzpicture}")
    assert "% \\end{tikzpicture}" in env.body       # the commented \end is skipped
    assert hashlib.sha1(env.body.encode()).hexdigest()


def test_unknown_macro_is_a_hard_error_with_file_and_line():
    with pytest.raises(ConvertError, match=r"chap\.tex:2: unknown macro \\frobnicate"):
        Parser(Source("chap.tex", "a\n\\frobnicate{x}")).parse_seq()


def test_unknown_environment_is_a_hard_error():
    with pytest.raises(ConvertError, match="unknown environment 'verbatim'"):
        parse("\\begin{verbatim}x\\end{verbatim}")


def test_mismatched_end_is_an_error():
    with pytest.raises(ConvertError, match="does not match"):
        parse("\\begin{center}x\\end{itemize}")


def test_unescaped_underscore_is_an_error():
    with pytest.raises(ConvertError, match="unescaped"):
        parse("a_b")


def test_math_is_parsed():
    nodes = parse(r"$a \rightarrow b$")
    assert type(nodes[0]).__name__ == "Math"


def test_mask_comments_keeps_offsets():
    t = "ab % c\nd \\% e"
    m = mask_comments(t)
    assert len(m) == len(t) and m.startswith("ab ") and "\\%" in m
