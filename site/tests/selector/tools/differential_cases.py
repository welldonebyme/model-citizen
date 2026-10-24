"""The `dbt ls` argument lists of the differential test (engine vs real dbt 1.11.16), per project.

Kept in Python so the generator can loop; written to site/tests/selector/fixtures/differential-cases.json.
"""
from __future__ import annotations

import itertools
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "differential-cases.json"

COMMON = [
    # bare words, fqn, wildcards
    ["-s", "*"], ["-s", "*", "--resource-type", "all"], ["-s", "stg_*"], ["-s", "*__orders"], ["-s", "?tg_*"],
    ["-s", "[sf]*"], ["-s", "[!s]*", "--resource-type", "model"], ["-s", "*[_]orders*"], ["-s", "[]"], ["-s", "[z-a]*"],
    ["-s", "marts"], ["-s", "marts.*"], ["-s", "staging"], ["-s", "staging.*"], ["-s", "*.staging.*"],
    ["-s", "fqn:*"], ["-s", "fqn:marts"], ["-s", "MARTS"], ["-s", ""], ["-s", "+"], ["-s", "@"],
    # package / path / file
    ["-s", "package:this"], ["-s", "package:dbt_utils"], ["-s", "package:*"], ["-s", "package:dbt_*"],
    ["-s", "path:models"], ["-s", "path:models/"], ["-s", "path:models/*"], ["-s", "path:models/**"], ["-s", "path:**"],
    ["-s", "path:models/**/*.sql"], ["-s", "path:models/*/*.yml"], ["-s", "path:tests"], ["-s", "path:seeds"],
    ["-s", "path:snapshots"], ["-s", "path:analyses"], ["-s", "path:macros"], ["-s", "path:models/marts/"],
    ["-s", "path:nonexistent"], ["-s", "models/marts"], ["-s", "./models/staging"], ["-s", "models//marts"],
    ["-s", "file:*.yml"], ["-s", "file:*.sql", "--resource-type", "test"], ["-s", "file:*.py"], ["-s", "file:_*"],
    ["-s", "file:*sources*"], ["-s", "*.csv"], ["-s", "*.sql"],
    # resource_type, test_type, test_name
    ["-s", "resource_type:model"], ["-s", "resource_type:test"], ["-s", "resource_type:source"], ["-s", "resource_type:seed"],
    ["-s", "resource_type:unit_test"], ["-s", "resource_type:exposure"], ["-s", "resource_type:analysis"],
    ["-s", "resource_type:analysis", "--resource-type", "all"], ["-s", "resource_type:macro"],
    ["-s", "test_type:generic"], ["-s", "test_type:singular"], ["-s", "test_type:data"], ["-s", "test_type:unit"],
    ["-s", "test_type:schema"], ["-s", "test_type:"], ["-s", "test_type:t"], ["-s", "test_type:sing"], ["-s", "test_type:it"],
    ["-s", "test_type:u"], ["-s", "test_name:unique"], ["-s", "test_name:not_null"], ["-s", "test_name:*"],
    ["-s", "test_name:relationships"], ["-s", "test_name:accepted_*"], ["-s", "test_name:test_*"], ["-s", "unit_test:*"],
    # config
    ["-s", "config.materialized:view"], ["-s", "config.materialized:table"], ["-s", "config.materialized:incremental"],
    ["-s", "config.materialized:ephemeral"], ["-s", "config.materialized:seed"], ["-s", "config.materialized:test"],
    ["-s", "config.enabled:true"], ["-s", "config.enabled:True"], ["-s", "config.enabled:false"], ["-s", "config.severity:error"],
    ["-s", "config.severity:warn"], ["-s", "config.severity:ERROR"], ["-s", "config.tags:marts"], ["-s", "config.tags:*"],
    ["-s", "config.schema:marts"], ["-s", "config.meta.owner:finance-team"], ["-s", "config.meta.contains_pii:true"],
    ["-s", "config.contract.enforced:true"], ["-s", "config.docs.show:true"], ["-s", "config.lookback:1"],
    ["-s", "config.persist_docs.relation:true"], ["-s", "config.incremental_strategy:microbatch"], ["-s", "config:view"],
    ["-s", "config.access:private"], ["-s", "config.group:finance"], ["-s", "config.unique_key:order_id"],
    ["-s", "config.on_schema_change:ignore"], ["-s", "config.full_refresh:false"], ["-s", "config.post_hook:x"],
    ["-s", "config.materialized.x:view"],
    # tag / group / access / version / exposure / source
    ["-s", "tag:*"], ["-s", "tag:fin*"], ["-s", "tag:staging"], ["-s", "tag:marts"], ["-s", "tag:finance"], ["-s", "tag:marketing"],
    ["-s", "group:*"], ["-s", "group:finance"], ["-s", "group:marketing"], ["-s", "access:private"], ["-s", "access:public"],
    ["-s", "access:protected"], ["-s", "access:*"], ["-s", "version:latest"], ["-s", "version:old"], ["-s", "version:none"],
    ["-s", "version:prerelease"], ["-s", "exposure:*"], ["-s", "+exposure:*"], ["-s", "exposure:*.x"], ["-s", "source:*"],
    ["-s", "source:*+"], ["-s", "source:*.*"], ["-s", "source:*.*.*"], ["-s", "+source:*"], ["-s", "@source:*"],
    ["-s", "metric:*"], ["-s", "semantic_model:*"], ["-s", "saved_query:*"],
    # set operators
    ["-s", "tag:marts,tag:finance"], ["-s", "tag:marts tag:finance"], ["-s", "tag:marts, tag:finance"],
    ["-s", "tag:marts", "tag:finance"], ["-s", "tag:marts", "-s", "tag:finance"], ["-s", "tag:marts,"], ["-s", ",tag:marts"],
    ["-s", "tag:marts  tag:finance"], ["-s", "tag:marts,resource_type:test"], ["-s", "resource_type:test,tag:marts"],
    ["-s", "*", "--exclude", "tag:marts"], ["-s", "*", "--exclude", "tag:marts", "tag:staging"],
    ["--exclude", "resource_type:test"], ["--exclude", "*"], ["--exclude", "does_not_exist"],
    ["-s", "tag:marts", "--exclude", "tag:marts"], ["-s", "tag:marts,config.materialized:table", "tag:staging"],
    # resource type flags
    ["--resource-type", "model"], ["--resource-type", "test"], ["--resource-type", "source"], ["--resource-type", "all"],
    ["--resource-type", "default"], ["--resource-type", "analysis"], ["--resource-type", "unit_test", "model"],
    ["--exclude-resource-type", "test"], ["--exclude-resource-type", "test", "unit_test", "source"],
    ["--resource-type", "all", "--exclude-resource-type", "model"], ["--resource-type", "model", "--exclude-resource-type", "model"],
    ["--resource-type", "exposure"], ["--resource-type", "seed", "--resource-type", "snapshot"],
    # errors
    ["-s", "selector:foo"], ["-s", "nope:x"], ["-s", "@x+"], ["-s", "resource_type:foo"], ["-s", "test_type:foo"],
    ["-s", "version:foo"], ["-s", "source:a.b.c.d"], ["-s", "exposure:a.b.c"], ["-s", "state:modified"], ["-s", "result:error"],
    ["-s", "source_status:fresher"], ["--selector", "nope"], ["-m", "x", "-s", "y"], ["-m", "x", "--resource-type", "model"],
    ["-s", "path:."], ["-s", "path:../x"],
]


def graph_cases(names: list[str]) -> list[list[str]]:
    out = []
    for n in names:
        for op in [f"+{n}", f"{n}+", f"1+{n}", f"{n}+1", f"2+{n}", f"{n}+2", f"+{n}+", f"@{n}", f"1+{n}+1", f"0+{n}",
                   f"{n}+0", f"+1{n}", f"@+{n}", f"3+{n}+"]:
            out.append(["-s", op])
        out.append(["-s", n, "--indirect-selection", "cautious"])
        out.append(["-s", n, "--indirect-selection", "buildable"])
        out.append(["-s", n, "--indirect-selection", "empty"])
        out.append(["-s", f"+{n}", "--indirect-selection", "cautious"])
        out.append(["-s", f"{n}+", "--indirect-selection", "buildable"])
        out.append(["-s", f"+{n}", "--exclude", n])
        out.append(["-s", f"+{n}+", "--resource-type", "model"])
        out.append(["-s", n, "--output", "name"])
        out.append(["-s", n, "--output", "path"])
        out.append(["-s", n, "--output", "json"])
        out.append(["-s", f"{n}+", "--output", "json", "--output-keys", "name", "resource_type", "config.materialized",
                    "depends_on", "tags", "nope", "config.nope"])
    return out


JAFFLE_16 = ["stg_stripe__payments", "int_orders__enriched", "fct_orders", "dim_customers", "country_regions",
             "orders_snapshot", "stg_jaffle_shop__customers", "customer_segments"]
JAFFLE_25 = ["stg_stripe__payments", "int_orders__enriched", "fct_orders", "dim_customers", "dim_customers.v1",
             "dim_customers.v2", "dim_customers_v1", "source:stripe.payments", "exposure:monthly_revenue_dashboard",
             "unit_test:test_dim_customers_lifetime_value", "test_name:relationships", "fct_order_items"]
SHOP_14 = ["stg_shopflow_app__orders", "fct_orders", "dim_customers", "fct_sessions", "source:shopflow_app.orders",
           "tag:finance", "group:marketing", "customer_rfm"]

SELECTORS = {
    "jaffle-ch16": ["staging_only", "nightly", "finance_marts", "no_python"],
    "jaffle-ch25": ["staging_only", "nightly", "finance_marts", "no_python"],
    "shopflow-m14": ["nightly", "ci_slim"],
}


def build() -> dict:
    cases = {}
    for key, names in (("jaffle-ch16", JAFFLE_16), ("jaffle-ch25", JAFFLE_25), ("shopflow-m14", SHOP_14)):
        lst = [list(c) for c in COMMON] + graph_cases(names)
        for s in SELECTORS[key]:
            lst.append(["--selector", s])
            lst.append(["--selector", s, "--resource-type", "model"])
            lst.append(["--selector", s, "-s", "fct_orders", "--exclude", "*"])
            lst.append(["--selector", s, "--indirect-selection", "cautious"])
        # pairs of names: union, intersection, difference
        for a, b in itertools.combinations(names[:5], 2):
            lst.append(["-s", f"+{a},{b}+"])
            lst.append(["-s", f"{a}+", "--exclude", f"{b}+"])
            lst.append(["-s", f"@{a}", f"@{b}", "--resource-type", "test", "--indirect-selection", "buildable"])
        seen, uniq = set(), []
        for c in lst:
            k = json.dumps(c)
            if k not in seen:
                seen.add(k)
                uniq.append(c)
        cases[key] = uniq
    return cases


if __name__ == "__main__":
    c = build()
    OUT.write_text(json.dumps(c, indent=0) + "\n")
    print({k: len(v) for k, v in c.items()})
