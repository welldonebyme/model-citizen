#!/usr/bin/env bash
# Rebuild every reference output (idempotent: unchanged inputs give byte-identical files).
#
#   bash converter/reference/run_all.sh [work-folder]        # work folder default: a new temp folder
#
# Needs: uv, git, the verification env (sh tools/setup_verification_env.sh .venv-verify), and for the last two
# steps pwsh + zsh. Network: dbt deps (hub.getdbt.com) in export_dags / golden_verify / test_kits --full.
set -euo pipefail
ACADEMY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ACADEMY"
WORK="${1:-$(mktemp -d -t mc-reference)}"
PY=.venv-verify/.venv/bin/python
[ -x "$PY" ] || sh tools/setup_verification_env.sh .venv-verify

uv run --no-project --python 3.12 converter/reference/export_repos.py          # 1. site/public/reference
"$PY" -I converter/reference/export_dags.py --work "$WORK/dag"                 # 2. site/src/generated/dag
uv run --no-project --python 3.12 converter/reference/golden_extract.py        # 3a. converter/golden (extract)
"$PY" -I converter/reference/golden_verify.py --work "$WORK/verify"            # 3b. re-run every entry (~45 min)
converter/.venv/bin/python converter/reference/build_kits.py               # 4. site/public/kits (book path rules: converter rewriter)
bash converter/reference/test_kits.sh "$WORK/kit-e2e" --full                   # 5. macOS / Linux end to end
pwsh -NoProfile -File converter/reference/test_kits_pwsh.ps1 -Work "$WORK/kit-pwsh"   # 5. setup.ps1 under pwsh
"$PY" -I converter/reference/os_commands.py                                    # 6. converter/overrides/os-commands.yaml
echo "work folder: $WORK"
