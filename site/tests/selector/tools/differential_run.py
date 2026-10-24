"""Run every case of fixtures/differential-cases.json with REAL dbt 1.11.16 (in-process dbtRunner, read-only use of
the verification env) on a checkout of one tag, and record what dbt printed.

    .venv-verify/.venv/bin/python -I -B site/tests/selector/tools/differential_run.py <key-tag> <project_dir> <profiles_dir>

Writes site/tests/selector/fixtures/differential-<key-tag>.json:
  [{"args": [...], "lines": [...printed nodes...], "warnings": [...], "error": "..." | null}]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

FIX = Path(__file__).resolve().parents[1] / "fixtures"


def main() -> int:
    key_tag, pdir, prof = sys.argv[1:4]
    from dbt.cli.main import dbtRunner

    cases = json.loads((FIX / "differential-cases.json").read_text())[key_tag]
    events: list[str] = []

    def cb(ev):
        try:
            lvl = ev.info.level
            if lvl in ("warn", "error") and ev.info.name in ("NoNodesForSelectionCriteria", "NoNodesSelected", "DefaultSelector",
                                                                "SelectorReportInvalidSelector"):
                events.append(ev.info.msg)
        except Exception:  # noqa: BLE001
            pass

    out = []
    for i, args in enumerate(cases):
        events.clear()
        res = dbtRunner(callbacks=[cb]).invoke(["ls", *args, "--project-dir", pdir, "--profiles-dir", prof])
        err = None
        if not res.success and res.exception is not None:
            err = str(res.exception)
        out.append({"args": args, "lines": list(res.result or []) if res.success else [], "warnings": list(events), "error": err})
        if i % 50 == 0:
            print(f"{key_tag}: {i}/{len(cases)}", flush=True)
    (FIX / f"differential-{key_tag}.json").write_text(json.dumps(out, ensure_ascii=False, indent=0) + "\n")
    print(f"{key_tag}: done ({len(out)} cases)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
