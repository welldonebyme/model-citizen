"""Jinja cases: Chapter 5 and Chapter 11 templates whose compiled output (or error) the book prints.

`python tests/cases/jinja_cases.py > results/jinja_cases.json`

mode    plain = jinja2.Template(text).render() (the book's render.py, Chapter 5)
        dbt   = dbt_jinja.DbtJinja(project).compile(...) (dbt compile / run-operation imitation)
expect  compiled  compare the compiled text with the book (cmp: equal | within | segments)
        error     the error message must contain the phrases (and phase, when given)
        logs      the info log lines must equal the book's lines (timestamps removed)
        parents   the refs found by the parse pass (dbt's DAG) must equal this set
real    how to reproduce it with the real dbt 1.11.16 (ground-truth/run_real_dbt_jinja.py)
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from book import CH05, CH11, block, ref  # noqa: E402

TS = re.compile(r"^\d\d:\d\d:\d\d  ")


def after(text, marker):
    i = text.index(marker)
    return text[i + len(marker):].lstrip("\n") if text[i + len(marker):].startswith("\n") else text[i + len(marker):]


def log_lines(text, skip=("...", "Running with", "Registered adapter", "Found ")):
    out = []
    for l in text.split("\n"):
        l = TS.sub("", l)
        if not l.strip() or l.strip().startswith(skip):
            continue
        out.append(l)
    return out


def inline_from_bash(begin_line, chapter=CH11):
    """The template inside `$ dbt compile --inline "..."` (possibly on several lines)."""
    b = block(chapter, begin_line)
    m = re.search(r'--inline "(.*)"', b, re.S)
    return m.group(1)


def cases():
    out = []

    def add(**kw):
        kw.setdefault("project", "ch11")
        kw.setdefault("node", {"name": "inline_query", "resource_type": "sql_operation"})
        out.append(kw)

    # =========================== Chapter 5, plain Jinja (render.py) ===========================
    for tpl_line, out_line, title in [
        (677, 683, "set + upper filter"), (697, 706, "filters: join, length, default, replace, lower"),
        (736, 747, "if / elif / else"), (772, 784, "pivot_broken.sql: for loop, trailing comma"),
        (837, 851, "pivot.sql: whitespace control + loop.last"), (881, 891, "macro cents_to_dollars"),
    ]:
        add(id=f"ch05-plain-{tpl_line}", ref=ref(CH05, tpl_line), title=title, mode="plain",
            template=block(CH05, tpl_line) + "\n",
            expect={"kind": "compiled", "cmp": "equal", "book": block(CH05, out_line)})
    add(id="ch05-plain-set-in-loop", ref="ch05:951", title="deepbox: set inside a loop -> total=0", mode="plain",
        template=block(CH05, 951) + "\n", expect={"kind": "compiled", "cmp": "ws", "book": "total=0"})
    add(id="ch05-plain-namespace", ref="ch05:956", title="deepbox: namespace() -> 6", mode="plain",
        template="{% set ns = namespace(total=0) %}{% for x in [1, 2, 3] %}{% set ns.total = ns.total + x %}"
                 "{% endfor %}{{ ns.total }}\n",
        expect={"kind": "compiled", "cmp": "ws", "book": "6"})
    add(id="ch05-plain-quiz9", ref="ch05:1341+1418", title="quiz: set in loop renders 0", mode="plain",
        template=block(CH05, 1341) + "\n", expect={"kind": "compiled", "cmp": "ws", "book": "0"})
    add(id="ch05-plain-tilde", ref="ch05:732", title="the ~ operator", mode="plain",
        template="{{ 'stg_' ~ 'orders' }}\n", expect={"kind": "compiled", "cmp": "equal", "book": "stg_orders"})

    # =========================== Chapter 5, dbt ===========================
    add(id="ch05-dbt-source", ref=ref(CH05, 985), title="stg_orders.sql: source() compiled", mode="dbt",
        project="ch05", node={"name": "stg_orders", "resource_type": "model", "path": "models/staging/stg_orders.sql"},
        template=block(CH05, 985) + "\n",
        expect={"kind": "compiled", "cmp": "equal", "book": after(block(CH05, 992), "Compiled node 'stg_orders' is:")},
        real={"kind": "model", "project": "ch05"})
    add(id="ch05-dbt-braces", ref="ch05:931+934", title="{{ }} inside {% %}: compilation error", mode="dbt",
        project="ch05", template="{% if {{ target.name }} == 'prod' %}select 1{% endif %}",
        expect={"kind": "error", "phrases": ["expected token ':', got '}'"]}, real={"kind": "inline", "project": "ch05"})
    add(id="ch05-dbt-undefined", ref="ch05:939", title="undefined variable renders as empty text", mode="dbt",
        project="ch05", template="select {{ my_colum }} from t",
        expect={"kind": "compiled", "cmp": "equal", "book": "select  from t"}, real={"kind": "inline", "project": "ch05"})
    add(id="ch05-dbt-quiz10", ref="ch05:1355+1419", title="quiz: typo order_dat compiles 'select  from ...'",
        mode="dbt", project="ch05", template=block(CH05, 1354),
        expect={"kind": "compiled", "cmp": "within", "book": "select  from"}, real={"kind": "inline", "project": "ch05"})

    # =========================== Chapter 11 ===========================
    add(id="ch11-context-inline", ref=ref(CH11, 85), title="run_started_at, flags.WHICH, project_name, modules",
        mode="dbt", template=inline_from_bash(85),
        expect={"kind": "compiled", "cmp": "equal", "book": after(block(CH11, 88), "Compiled inline node is:")},
        real={"kind": "inline"}, note="run_started_at pinned to the book's date (2026-10-21)")
    this_out = block(CH11, 111)
    dev_part = this_out.split("...")[0]
    add(id="ch11-this-dev", ref=ref(CH11, 100), title="{{ this }} in dev", mode="dbt",
        node={"name": "tmp_this_demo", "resource_type": "model", "path": "models/marts/tmp_this_demo.sql"},
        extra_models={"tmp_this_demo": {"path": "models/marts/tmp_this_demo.sql", "materialized": "table", "schema": "marts"}},
        template=block(CH11, 100) + "\n",
        expect={"kind": "compiled", "cmp": "equal", "book": after(dev_part, "Compiled node 'tmp_this_demo' is:").rstrip("\n")},
        real={"kind": "model"})
    add(id="ch11-this-prod", ref=ref(CH11, 100), title="{{ this }} with --target prod", mode="dbt", target="prod",
        node={"name": "tmp_this_demo", "resource_type": "model", "path": "models/marts/tmp_this_demo.sql"},
        extra_models={"tmp_this_demo": {"path": "models/marts/tmp_this_demo.sql", "materialized": "table", "schema": "marts"}},
        template=block(CH11, 100) + "\n",
        expect={"kind": "compiled", "cmp": "equal",
                "book": after(this_out.split("...")[1], "Compiled node 'tmp_this_demo' is:").rstrip("\n")},
        real={"kind": "model", "target": "prod"})
    add(id="ch11-log-twice", ref=ref(CH11, 166), title="log() printed in both renderings", mode="dbt",
        template=inline_from_bash(166),
        expect={"kind": "logs", "book": [l for l in log_lines(block(CH11, 169)) if l.startswith("execute is")],
                "compiled": after(block(CH11, 169), "Compiled inline node is:")},
        real={"kind": "inline"})
    add(id="ch11-ref-in-sql-comment", ref=ref(CH11, 193), title="ref() inside a SQL comment is a dependency",
        mode="dbt", node={"name": "tmp_comment_demo", "resource_type": "model", "path": "models/marts/tmp_comment_demo.sql"},
        extra_models={"tmp_comment_demo": {"path": "models/marts/tmp_comment_demo.sql", "materialized": "table", "schema": "marts"}},
        template=block(CH11, 193) + "\n",
        expect={"kind": "parents", "book": ["dim_customers"],
                "compiled_contains": '-- old version: select * from "practice"."dbt_adnane"."dim_customers"'},
        real={"kind": "model"})
    add(id="ch11-duplicate-macro", ref=ref(CH11, 237), title="two macros with the same name", mode="dbt",
        extra_macro_files={"macros/money.sql": "{% macro cents_to_dollars(x) %}{{ x }}{% endmacro %}\n"},
        template="select 1", expect={"kind": "error", "cmp_block": block(CH11, 237),
                                     "phrases": ['dbt found multiple macros named "cents_to_dollars"']},
        real={"kind": "inline"})
    add(id="ch11-macro-in-model", ref="ch11:254+274", title="{{ cents_to_dollars('amount') }} as amount,",
        mode="dbt", template="{{ cents_to_dollars('amount') }} as amount,",
        expect={"kind": "compiled", "cmp": "equal", "book": "cast(amount / 100 as decimal(16, 2)) as amount,"},
        real={"kind": "inline"})
    add(id="ch11-unquoted-arg", ref=ref(CH11, 284), title="unquoted argument -> empty text", mode="dbt",
        template=inline_from_bash(284),
        expect={"kind": "compiled", "cmp": "equal", "book": after(block(CH11, 287), "Compiled inline node is:")},
        real={"kind": "inline"})
    add(id="ch11-too-many-args", ref=ref(CH11, 330), title="too many arguments: parse error", mode="dbt",
        template=inline_from_bash(330),
        expect={"kind": "error", "phase": "parse", "phrases": [log_lines(block(CH11, 333))[1]]},
        real={"kind": "inline"})
    add(id="ch11-missing-arg", ref="ch11:340", title="missing required argument is silent", mode="dbt",
        template="{{ cents_to_dollars() }}",
        expect={"kind": "compiled", "cmp": "equal", "book": "cast( / 100 as decimal(16, 2))"}, real={"kind": "inline"})
    add(id="ch11-namespace-call", ref="ch11:360", title="jaffle_dbt.cents_to_dollars(column_name=..., scale=4)",
        mode="dbt", template="{{ jaffle_dbt.cents_to_dollars(column_name='amount', scale=4) }}",
        expect={"kind": "compiled", "cmp": "equal", "book": "cast(amount / 100 as decimal(16, 4))"}, real={"kind": "inline"})
    add(id="ch11-undefined-macro", ref=ref(CH11, 363), title="typo in a macro name", mode="dbt",
        template=inline_from_bash(363),
        expect={"kind": "error", "phrases": [block(CH11, 366).split("\n")[-1].strip()]}, real={"kind": "inline"})
    add(id="ch11-dateadd", ref="ch11:373", title="dbt.dateadd on DuckDB (real dbt-duckdb macro source)", mode="dbt",
        template="{{ dbt.dateadd('day', 7, \"date '2026-01-01'\") }}",
        expect={"kind": "compiled", "cmp": "ws", "book": "(date '2026-01-01' + cast(7 as bigint) * interval 1 day)"},
        real={"kind": "inline"})
    add(id="ch11-return", ref=ref(CH11, 384), title="printing is not returning", mode="dbt",
        extra_macro_files={"macros/zz_demo.sql": block(CH11, 384) + "\n"}, template=inline_from_bash(388),
        expect={"kind": "compiled", "cmp": "equal", "book": after(block(CH11, 392), "Compiled inline node is:")},
        real={"kind": "inline"})
    tmp_methods = {"tmp_methods": {"path": "models/tmp_methods.sql", "materialized": "view"}}
    add(id="ch11-run-query-no-guard", ref=ref(CH11, 486), title="run_query without {% if execute %}", mode="dbt",
        node={"name": "tmp_methods", "resource_type": "model", "path": "models/tmp_methods.sql"},
        extra_models=tmp_methods, extra_macro_files={"macros/get_payment_methods.sql": block(CH11, 486) + "\n"},
        template=block(CH11, 498) + "\n",
        expect={"kind": "error", "phase": "parse", "phrases": ["'None' has no attribute 'table'"],
                "cmp_block": "\n".join(block(CH11, 515).split("\n")[3:])},
        real={"kind": "model"})
    add(id="ch11-run-query-guarded", ref=ref(CH11, 530), title="run_query with the execute guard (needs the DB)",
        mode="dbt", node={"name": "tmp_methods", "resource_type": "model", "path": "models/tmp_methods.sql"},
        extra_models=tmp_methods, extra_macro_files={"macros/get_payment_methods.sql": block(CH11, 530) + "\n"},
        template=block(CH11, 498) + "\n",
        expect={"kind": "compiled", "cmp": "segments", "book": after(block(CH11, 548), "Compiled node 'tmp_methods' is:")},
        real={"kind": "model"}, db=True)
    add(id="ch11-raise-compiler-error", ref=ref(CH11, 584), title="exceptions.raise_compiler_error", mode="dbt",
        template=inline_from_bash(584),
        expect={"kind": "error", "phase": "parse", "phrases": [log_lines(block(CH11, 587))[1]]}, real={"kind": "inline"})
    add(id="ch11-adapter-describe", ref=ref(CH11, 613), title="adapter.get_columns_in_relation / get_relation (run-operation)",
        mode="dbt", passes=["execute"], extra_macro_files={"macros/zz_demo.sql": block(CH11, 613) + "\n"},
        template="{{ describe_relation(model_name='stg_stripe__payments') }}",
        expect={"kind": "logs", "book": log_lines(block(CH11, 628))},
        real={"kind": "run-operation", "macro": "describe_relation", "args": "{model_name: stg_stripe__payments}"}, db=True)
    add(id="ch11-print-row-counts", ref=ref(CH11, 685), title="print_row_counts: graph + adapter + run_query",
        mode="dbt", passes=["execute"], template="{{ print_row_counts() }}",
        expect={"kind": "logs", "book": log_lines(block(CH11, 688))},
        real={"kind": "run-operation", "macro": "print_row_counts", "args": None}, db=True)
    add(id="ch11-print-row-counts-views", ref=ref(CH11, 700), title="print_row_counts --args '{materializations: [view]}'",
        mode="dbt", passes=["execute"], template="{{ print_row_counts(materializations=['view']) }}",
        expect={"kind": "logs", "book": log_lines(block(CH11, 703))},
        real={"kind": "run-operation", "macro": "print_row_counts", "args": "{materializations: [view]}"}, db=True)
    add(id="ch11-pivot-model", ref=ref(CH11, 1070), title="int_orders__payment_methods_pivoted (loop unrolled)",
        mode="dbt", node={"name": "int_orders__payment_methods_pivoted", "resource_type": "model",
                          "path": "models/intermediate/int_orders__payment_methods_pivoted.sql"},
        template=block(CH11, 1070) + "\n",
        expect={"kind": "compiled", "cmp": "segments", "book": block(CH11, 1101)}, real={"kind": "model", "existing": True})
    add(id="ch11-get-column-values", ref=ref(CH11, 1150), title="dbt_utils.get_column_values (real dbt_utils source)",
        mode="dbt", template=re.search(r'--inline "(.*)"$', block(CH11, 1150), re.S).group(1),
        expect={"kind": "compiled", "cmp": "equal", "book": after(block(CH11, 1153), "Compiled inline node is:")},
        real={"kind": "inline"}, db=True)
    add(id="ch11-surrogate-key", ref=ref(CH11, 1183), title="dbt_utils.generate_surrogate_key in fct_order_items",
        mode="dbt", node={"name": "fct_order_items", "resource_type": "model", "path": "models/marts/fct_order_items.sql"},
        template=block(CH11, 1183) + "\n",
        expect={"kind": "compiled", "cmp": "within", "book": block(CH11, 1233)}, real={"kind": "model", "existing": True})
    add(id="ch11-star", ref=ref(CH11, 1261), title="dbt_utils.star (reads columns in the warehouse)", mode="dbt",
        template=inline_from_bash(1261),
        expect={"kind": "compiled", "cmp": "equal", "book": after(block(CH11, 1264), "Compiled inline node is:")},
        real={"kind": "inline"}, db=True)
    add(id="ch11-quiz-get-statuses", ref="ch11:1776+1895", title="quiz hotspot: run_query unguarded in a macro",
        mode="dbt", node={"name": "tmp_statuses", "resource_type": "model", "path": "models/tmp_statuses.sql"},
        extra_models={"tmp_statuses": {"path": "models/tmp_statuses.sql", "materialized": "view"}},
        extra_macro_files={"macros/get_statuses.sql": block(CH11, 1776) + "\n"},
        template="{% set statuses = get_statuses() %}\nselect {{ statuses | length }} as n\n",
        expect={"kind": "error", "phase": "parse", "phrases": ["'None' has no attribute 'table'"]}, real={"kind": "model"})
    add(id="ch11-quiz-deleted-ref", ref="ch11:1858+1914", title="quiz: ref() of a deleted model inside -- comment",
        mode="dbt", node={"name": "tmp_legacy", "resource_type": "model", "path": "models/tmp_legacy.sql"},
        extra_models={"tmp_legacy": {"path": "models/tmp_legacy.sql", "materialized": "view"}},
        template="-- select * from {{ ref('legacy_orders') }}\nselect 1 as x\n",
        expect={"kind": "error", "phrases": ["depends on a node named 'legacy_orders' which was not found"]},
        real={"kind": "model"})
    add(id="ch11-trap-macro-newline", ref="ch11:215", title="trap: a macro's leading newline escapes the -- comment",
        mode="dbt", extra_macro_files={"macros/tip_rule.sql": "{% macro tip_rule() %}\n    round(amount * 0.1, 2)\n{% endmacro %}\n"},
        template="select\n    amount,\n    -- old rule: {{ tip_rule() }} as tip\nfrom {{ ref('stg_stripe__payments') }}",
        expect={"kind": "compiled", "cmp": "within", "book": "-- old rule:\nround(amount * 0.1, 2)\nas tip"},
        reconstructed="the macro source is not printed in the book", real={"kind": "inline"})

    # =========================== synthetic (checked against real dbt only) ===========================
    add(id="syn-var-envvar-target", ref="synthetic", title="var(), env_var() with default, target.*", mode="dbt",
        template="select '{{ var(\"dev_start_date\") }}' as d, '{{ env_var(\"DBT_ACADEMY_X\", \"fallback\") }}' as e, "
                 "'{{ target.name }}/{{ target.schema }}/{{ target.type }}' as t",
        expect={"kind": "real_only"}, real={"kind": "inline"})
    add(id="syn-var-missing", ref="synthetic", title="var() without default and without value", mode="dbt",
        template="select '{{ var(\"no_such_var\") }}' as x",
        expect={"kind": "error", "phrases": ["Required var 'no_such_var' not found in config"]}, real={"kind": "inline"})
    add(id="syn-is-incremental", ref="synthetic", title="is_incremental() with an existing table", mode="dbt",
        node={"name": "syn_incr", "resource_type": "model", "path": "models/marts/syn_incr.sql"},
        extra_models={"syn_incr": {"path": "models/marts/syn_incr.sql", "materialized": "incremental", "schema": "marts"}},
        template="{{ config(materialized='incremental') }}\nselect 1 as x\n{% if is_incremental() %}"
                 "where x > (select max(x) from {{ this }}){% endif %}\n",
        expect={"kind": "real_only"}, real={"kind": "model", "run_first": True}, db=True)
    add(id="syn-config-get", ref="synthetic", title="config() then config.get()", mode="dbt",
        node={"name": "syn_cfg", "resource_type": "model", "path": "models/marts/syn_cfg.sql"},
        extra_models={"syn_cfg": {"path": "models/marts/syn_cfg.sql", "materialized": "table", "schema": "marts"}},
        template="{{ config(materialized='view', tags=['x']) }}\nselect '{{ config.get(\"materialized\") }}' as m\n",
        expect={"kind": "real_only"}, real={"kind": "model"})
    return out


if __name__ == "__main__":
    json.dump(cases(), sys.stdout, indent=1)
