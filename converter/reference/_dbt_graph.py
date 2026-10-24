"""Helper run INSIDE the verification venv (dbt-core 1.11.16) by export_dags.py.

    <venv>/bin/python -I _dbt_graph.py <project_dir> <profiles_dir> <out.json> [target]

Runs `dbt parse --no-partial-parse` in-process (this also writes <project_dir>/target/manifest.json),
then rebuilds dbt's own graph with dbt's Linker:
  - edges        : the graph used by every command for selection (parent -> child)
  - test_edges   : the extra edges `dbt build` adds (Linker.add_test_edges, "parent_test" edges);
                   dbt build selects on the graph WITH these edges.
"""
import json
import sys

from dbt.cli.main import dbtRunner
from dbt.compilation import Linker


def main() -> int:
    project_dir, profiles_dir, out = sys.argv[1:4]
    target = sys.argv[4] if len(sys.argv) > 4 else None
    args = ["parse", "--no-partial-parse", "--project-dir", project_dir, "--profiles-dir", profiles_dir]
    if target:
        args += ["--target", target]
    res = dbtRunner().invoke(args)
    if not res.success:
        print(f"dbt parse failed: {res.exception}", file=sys.stderr)
        return 1
    manifest = res.result
    linker = Linker()
    linker.link_graph(manifest)
    base = sorted([list(e) for e in linker.graph.edges()])
    manifest.build_parent_and_child_maps()
    linker.add_test_edges(manifest)
    after = {tuple(e) for e in linker.graph.edges()}
    extra = sorted([list(e) for e in after - {tuple(e) for e in base}])
    with open(out, "w") as fh:
        json.dump({"edges": base, "test_edges": extra}, fh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
