"""YAML cases from the book (Chapter 5 and Chapter 22) that show a PyYAML or dbt message.

Run `python tests/cases/yaml_cases.py > results/yaml_cases.json` to freeze them as JSON
(the JSON is what the Pyodide runners read: they never touch the book).

expect kinds
  dbt_block   full "Parsing Error ..." block printed by `dbt parse` (book outputcode)
  raw_error   only the "Raw Error" part (the libyaml message, used by dbt)
  traceback   last lines of a Python traceback of yaml.safe_load(open(file)) (pure-Python loader)
  contains    the message must contain these phrases, and the problem mark must be line/column
  warning     dbt warning text (duplicate keys)
  value       the loaded value, printed with Python's print() / repr()
  error_any   the book only says "this is an error"
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from book import CH05, CH22, block, ref  # noqa: E402

BUG2_FILE = Path("/Users/mac/Documents/Adnane/dbt-academy/spikes/pyodide/ground-truth/_stripe__models.ch22.yml")


def _lab_broken():
    return block(CH05, 571) + "\n"


def _raw_error_part(dbt_block):
    """The lines after 'Raw Error:' + dashes, dedented."""
    lines = dbt_block.split("\n")
    i = next(k for k, l in enumerate(lines) if l.strip() == "Raw Error:")
    body = lines[i + 2:]
    ind = min(len(l) - len(l.lstrip()) for l in body if l.strip())
    return "\n".join(l[ind:] for l in body).strip("\n")


def cases():
    out = []

    def add(**kw):
        out.append(kw)

    # ---------------- Chapter 5: Reading YAML error messages ----------------
    m1 = block(CH05, 316)
    add(id="ch05-m1-tab", ref=ref(CH05, 316), title="Mistake 1: a tab instead of spaces (dbt parse)",
        engine="dbt", project="jaffle_practice", path="staging/_stg_models.yml",
        text='version: 2\n\nmodels:\n  - name: stg_orders\n\tdescription: "Orders"\n',
        reconstructed="file rebuilt from the context lines; line 5 starts with a TAB",
        expect={"kind": "dbt_block", "book": m1, "raw_error": _raw_error_part(m1), "near_line": 5})

    m2 = block(CH05, 341)
    add(id="ch05-m2-nospace", ref=ref(CH05, 341), title="Mistake 2: missing space after the colon (dbt parse)",
        engine="dbt", project="jaffle_practice", path="staging/_stg_models.yml",
        text='version: 2\n\nmodels:\n  - name:stg_orders\n    description: "Orders"\n',
        reconstructed="file rebuilt from the context lines",
        expect={"kind": "dbt_block", "book": m2, "raw_error": _raw_error_part(m2), "near_line": 5})

    m3 = block(CH05, 357)
    add(id="ch05-m3-jinja", ref=ref(CH05, 357), title="Mistake 3: unquoted Jinja (dbt parse)",
        engine="dbt", project="jaffle_practice", path="staging/_stg_models.yml",
        text="version: 2\n\nmodels:\n  - name: stg_orders\n    config:\n      schema: {{ target.schema }}\n",
        reconstructed="file rebuilt from the context lines",
        expect={"kind": "dbt_block", "book": m3, "raw_error": _raw_error_part(m3), "near_line": 6})

    m4_text = "version: 2\n\nmodels:\n  - name: stg_payments\n    description: Payments: from Stripe\n"
    col = m4_text.split("\n")[4].index(": from") + 1
    add(id="ch05-m4-colon-dbt", ref="ch05:377", title="Mistake 4: a colon inside a value (dbt / libyaml words)",
        engine="dbt", project="jaffle_practice", path="staging/_stg_models.yml", text=m4_text,
        reconstructed="book gives only the phrase and 'the column points at the second colon'",
        expect={"kind": "contains", "phrases": ["mapping values are not allowed in this context"],
                "line": 5, "column": col})
    add(id="ch05-m4-colon-pyyaml", ref="ch05:377", title="Mistake 4 with yaml.safe_load (pure-Python words)",
        engine="pyyaml", filename="broken.yml", text=m4_text,
        expect={"kind": "contains", "phrases": ["mapping values are not allowed here"], "line": 5, "column": col})

    add(id="ch05-m5-dupkey", ref=ref(CH05, 396), title="Mistake 5: duplicated key (dbt 1.11 warning)",
        engine="dbt", project="jaffle_practice", path="models/staging/_stg_models.yml",
        text=block(CH05, 384) + "\n",
        expect={"kind": "warning", "book": block(CH05, 396)})
    add(id="ch05-m5-dupkey-value", ref="ch05:393", title="Mistake 5: a plain reader keeps the last value",
        engine="pyyaml", text=block(CH05, 384) + "\n",
        expect={"kind": "value", "expr": "data['models'][0]['description']", "print": True, "book": "Second"})

    # ---------------- Chapter 5 lab: Fix a broken YAML file ----------------
    broken = _lab_broken()
    add(id="ch05-lab-step3", ref=ref(CH05, 598), title="Lab step 3: python -c yaml.safe_load(open('broken.yml'))",
        engine="pyyaml", filename="broken.yml", text=broken,
        expect={"kind": "traceback", "book": block(CH05, 598)})
    step4 = broken.replace("    description: Payments from Stripe: one row per payment",
                           '    description: "Payments from Stripe: one row per payment"')
    add(id="ch05-lab-step4", ref=ref(CH05, 605), title="Lab step 4: after quoting the description",
        engine="pyyaml", filename="broken.yml", text=step4,
        expect={"kind": "traceback", "book": block(CH05, 605)})
    step5 = step4.replace("     - name: amount_usd", "      - name: amount_usd")
    add(id="ch05-lab-step5", ref=ref(CH05, 615), title="Lab step 5: valid YAML, but config is a text",
        engine="pyyaml", filename="broken.yml", text=step5,
        expect={"kind": "value", "expr": "data['models'][0]['config']", "print": True,
                "book": block(CH05, 615).split("\n")[1]})
    final = (step5.replace("      schema:{{ target.schema }}", '      schema: "{{ target.schema }}"')
                  .replace("values: [success, fail]", "values: ['success', 'fail']"))
    add(id="ch05-lab-final", ref=ref(CH05, 624), title="Lab expected result: config is a mapping",
        engine="pyyaml", filename="broken.yml", text=final,
        expect={"kind": "value", "expr": "data['models'][0]['config']", "print": True,
                "book": block(CH05, 624).split("\n")[-1]})
    add(id="ch05-lab-final-valid", ref=ref(CH05, 624), title="Lab expected result: 'valid YAML'",
        engine="pyyaml", filename="broken.yml", text=final, expect={"kind": "valid"})

    # ---------------- Chapter 5 quiz ----------------
    q2 = block(CH05, 1278) + "\n"
    add(id="ch05-quiz2", ref="ch05:1278+1411", title="Quiz 2: which line fails (answer: line 10, column 33)",
        engine="dbt", project="jaffle_practice", path="staging/_stg_models.yml", text=q2,
        expect={"kind": "contains", "phrases": ["mapping values are not allowed in this context"],
                "line": 10, "column": 33})
    add(id="ch05-quiz-folded", ref="ch05:1421", title="Quiz: zip_code: >01234 'even causes a YAML error'",
        engine="pyyaml", text="vars:\n  zip_code: >01234\n", expect={"kind": "error_any"})
    add(id="ch05-trap-jinja", ref=ref(CH05, 258), title="Trap: schema: {{ target.schema }} is a parsing error",
        engine="pyyaml", text=block(CH05, 258) + "\n", expect={"kind": "error_any"})

    # ---------------- Chapter 5: values YAML reads (no error, but printed by Python) ----------------
    scalars = [
        ("status: completed", "'completed'"), ("count: 300", "300"), ("enabled: true", "True"),
        ("enabled: yes", "True"), ("answer: 'yes'", "'yes'"), ("version: 1.10", "1.1"),
        ("zip: 01234", "668"), ("zip: '01234'", "'01234'"), ("value: null", "None"),
        ("value: ~", "None"), ("value:", "None"), ("enabled: no", "False"),
    ]
    for i, (line, book_repr) in enumerate(scalars):
        add(id=f"ch05-scalar-{i:02d}", ref="ch05:211" if i < 11 else "ch05:1412", title=f"Scalar: {line}",
            engine="pyyaml", text=line + "\n",
            expect={"kind": "value", "expr": "list(data.values())[0]", "book": book_repr})
    add(id="ch05-list-of-mappings", ref=ref(CH05, 166), title="A list of mappings, printed by Python",
        engine="pyyaml", text=block(CH05, 153) + "\n",
        expect={"kind": "value", "expr": "data", "print": True, "book": block(CH05, 166)})
    add(id="ch05-multiline", ref="ch05:283", title="Literal | and folded > blocks",
        engine="pyyaml", text=block(CH05, 274) + "\n",
        expect={"kind": "value", "expr": "(data['literal'], data['folded'])",
                "book": "('line one\\nline two\\n', 'line one line two\\n')"})
    add(id="ch05-anchor-merge", ref="ch05:303", title="Anchor + merge key",
        engine="pyyaml", text=block(CH05, 295) + "\n",
        expect={"kind": "value", "expr": "data['model_a']", "book": "{'materialized': 'view', 'schema': 'marts'}"})

    # ---------------- Chapter 22 ----------------
    if BUG2_FILE.exists():
        bug2 = block(CH22, 324)
        add(id="ch22-bug2-indent", ref=ref(CH22, 324), title="Bug 2: 7 spaces instead of 8 (dbt parse)",
            engine="dbt", project="jaffle_dbt", path="staging/stripe/_stripe__models.yml",
            text=BUG2_FILE.read_text(),
            reconstructed="reference repo tag ch22 + bugs/02-yaml-bad-indentation.patch",
            expect={"kind": "dbt_block", "book": bug2, "raw_error": _raw_error_part(bug2), "near_line": 15,
                    "skip_lines": 1})
    add(id="ch22-table-colon", ref="ch22:367", title="Table: description: Status: paid",
        engine="dbt", project="jaffle_dbt", path="staging/stripe/_stripe__models.yml",
        text="version: 2\n\nmodels:\n  - name: stg_stripe__payments\n    columns:\n      - name: status\n        description: Status: paid\n",
        reconstructed="minimal file around the book's example value",
        expect={"kind": "contains", "phrases": ["mapping values are not allowed in this context"]})
    add(id="ch22-table-flow", ref="ch22:368", title="Table: schema: {{ env_var('S', 'stripe') }}",
        engine="dbt", project="jaffle_dbt", path="staging/stripe/_stripe__sources.yml",
        text="version: 2\n\nsources:\n  - name: stripe\n    schema: {{ env_var('S', 'stripe') }}\n    tables:\n      - name: payments\n",
        reconstructed="minimal sources file around the book's example value",
        expect={"kind": "contains", "phrases": ["while parsing a flow mapping", "did not find expected ',' or '}'"]})
    add(id="ch22-table-tab", ref="ch22:369", title="Table: a tab instead of spaces",
        engine="dbt", project="jaffle_dbt", path="staging/stripe/_stripe__models.yml",
        text="version: 2\n\nmodels:\n  - name: stg_stripe__payments\n\tdescription: One row per payment.\n",
        reconstructed="minimal file",
        expect={"kind": "contains", "phrases": ["found a tab character that violates indentation"]})
    add(id="ch22-shape-columns", ref="ch22:377", title="dbt shape check: columns written as a dictionary",
        engine="dbt", project="jaffle_dbt", path="staging/stripe/_stripe__models.yml",
        text="version: 2\n\nmodels:\n  - name: stg_stripe__payments\n    columns:\n      payment_id:\n        description: Primary key.\n",
        reconstructed="minimal file; this is dbt's JSON-schema check, not PyYAML",
        expect={"kind": "contains", "phrases": ["at path ['columns']", "is not of type 'array'"]})
    add(id="ch05-shape-config", ref="ch05:415+620", title="dbt shape check: config is a text (lab step 5 file)",
        engine="dbt", project="jaffle_practice", path="staging/_stg_models.yml", text=step5,
        reconstructed="lab file after step 4; book paraphrases the message",
        expect={"kind": "contains", "phrases": ["at path ['config']", "is not of type 'object'"]})
    add(id="ch22-bug9-typo", ref="ch22:514", title="Bug 9: desciption: is valid YAML (silent on DuckDB)",
        engine="dbt", project="jaffle_dbt", path="marts/_marts__models.yml",
        text="version: 2\n\nmodels:\n  - name: fct_monthly_revenue\n    desciption: Monthly revenue per country.\n",
        reconstructed="minimal file", expect={"kind": "valid"})
    return out


if __name__ == "__main__":
    json.dump(cases(), sys.stdout, indent=1)
