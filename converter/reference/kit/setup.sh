#!/usr/bin/env bash
# ============================================================================
#  Model Citizen - practice kit setup for macOS, Linux and WSL (Ubuntu)
#
#    bash setup.sh                      # creates ~/dbt-course (safe to run again)
#    bash setup.sh --install-tools      # also installs uv with Homebrew / the official installer
#
#  Options (environment variables):
#    DBT_COURSE_DIR=/some/folder   another course folder (default: ~/dbt-course)
#    DUCKDB_VERSION=1.5.6          DuckDB version for the venv (must equal your DuckDB CLI)
#    REBUILD_DB=1                  rebuild practice.duckdb even if it exists (= reset the raw data to day 1)
#
#  What it does (Chapter 2 of the book, plus the reference project):
#    ~/dbt-course/.venv            Python 3.12 + dbt-core 1.11.x + dbt-duckdb 1.11.x + duckdb (pinned)
#    ~/dbt-course/practice/        data/ setup.sql updates/ practice.duckdb      <- YOUR database
#    ~/dbt-course/kit/             READMEs, bugs/, jaffle_dbt.bundle, profiles/, tools/duck.py, check/
#    ~/dbt-course/reference/       jaffle_dbt/ (clone of the bundle) + its own practice/ database
#  and finally runs `dbt debug`.
# ============================================================================
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COURSE="${DBT_COURSE_DIR:-$HOME/dbt-course}"
DUCKDB_VERSION="${DUCKDB_VERSION:-1.5.6}"
PY_VERSION="3.12"
DBT_CORE_SPEC="dbt-core~=1.11.0"
DBT_DUCKDB_SPEC="dbt-duckdb~=1.11.0"
INSTALL_TOOLS=0
for arg in "$@"; do
  case "$arg" in
    --install-tools) INSTALL_TOOLS=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
ok()   { printf '    OK  %s\n' "$*"; }
info() { printf '    ..  %s\n' "$*"; }
warn() { printf '    !!  %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux)  if grep -qi microsoft /proc/version 2>/dev/null; then OS=wsl; else OS=linux; fi ;;
  *)      OS=other ;;
esac

step "Kit folder: $KIT_DIR"
for f in setup.sql data/customers.csv updates/day2.sql bugs/README.md jaffle_dbt.bundle tools/duck.py check/dbt_project.yml profiles/profiles.yml; do
  [ -e "$KIT_DIR/$f" ] || die "the kit is incomplete: $f is missing. Unzip the whole dbt-course-kit.zip again."
done
ok "kit complete ($OS)"

# ---------------------------------------------------------------- 1. tools
step "Checking the tools (uv, git, duckdb)"
if ! command -v uv >/dev/null 2>&1; then
  if [ "$INSTALL_TOOLS" = 1 ]; then
    if [ "$OS" = macos ] && command -v brew >/dev/null 2>&1; then
      info "installing uv with Homebrew: brew install uv"
      brew install uv
    else
      info "installing uv with the official installer (https://astral.sh/uv/install.sh)"
      curl -LsSf https://astral.sh/uv/install.sh | sh
      export PATH="$HOME/.local/bin:$PATH"
    fi
  else
    if [ "$OS" = macos ]; then
      die "uv is not installed. Install it with:  brew install uv   (or run: bash setup.sh --install-tools)"
    else
      die "uv is not installed. Install it with:  curl -LsSf https://astral.sh/uv/install.sh | sh   then open a new terminal (or run: bash setup.sh --install-tools)"
    fi
  fi
fi
command -v uv >/dev/null 2>&1 || die "uv is still not found. Open a new terminal and run setup again."
ok "uv: $(uv --version)"

HAVE_GIT=1
if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
  ok "git: $(git --version)"
else
  HAVE_GIT=0
  if [ "$OS" = macos ]; then
    warn "git is missing. Run:  xcode-select --install   (then run this setup again). The reference project is skipped."
  else
    warn "git is missing. Run:  sudo apt install git   (then run this setup again). The reference project is skipped."
  fi
fi

CLI_VERSION=""
if command -v duckdb >/dev/null 2>&1; then
  CLI_VERSION="$(duckdb --version 2>/dev/null | sed -E 's/^v?([0-9]+\.[0-9]+\.[0-9]+).*/\1/' | head -1)"
  ok "DuckDB CLI: v$CLI_VERSION"
else
  info "DuckDB CLI not found (optional). macOS: brew install duckdb. Without it, use: python ~/dbt-course/kit/tools/duck.py"
fi

# ---------------------------------------------------------------- 2. folders and files
step "Course folder: $COURSE"
mkdir -p "$COURSE/practice" "$COURSE/kit" "$COURSE/reference/practice"
copy_tree() {  # copy_tree <src> <dst>: copy files that are missing (never overwrite your changes)
  local src="$1" dst="$2"
  mkdir -p "$dst"
  (cd "$src" && find . -type f) | while IFS= read -r f; do
    if [ ! -e "$dst/$f" ]; then mkdir -p "$(dirname "$dst/$f")"; cp "$src/$f" "$dst/$f"; fi
  done
}
for target in "$COURSE/practice" "$COURSE/reference/practice"; do
  copy_tree "$KIT_DIR/data" "$target/data"
  copy_tree "$KIT_DIR/updates" "$target/updates"
  [ -e "$target/setup.sql" ] || cp "$KIT_DIR/setup.sql" "$target/setup.sql"
done
for item in README.md README-windows.md bugs tools check profiles jaffle_dbt.bundle; do
  if [ -d "$KIT_DIR/$item" ]; then copy_tree "$KIT_DIR/$item" "$COURSE/kit/$item"; else cp "$KIT_DIR/$item" "$COURSE/kit/$item"; fi
done
ok "practice/ (data, setup.sql, updates), kit/ and reference/practice/ are in place"

# ---------------------------------------------------------------- 3. venv + dbt
step "Python $PY_VERSION virtual environment: $COURSE/.venv"
VENV="$COURSE/.venv"
PY="$VENV/bin/python"
if [ -x "$PY" ] && "$PY" -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)" 2>/dev/null; then
  ok "existing venv kept ($("$PY" --version))"
else
  if [ -e "$VENV" ]; then
    warn "the existing .venv is not a Python $PY_VERSION venv: it is recreated"
    uv venv --clear --python "$PY_VERSION" "$VENV"
  else
    uv venv --python "$PY_VERSION" "$VENV"
  fi
fi
step "Installing $DBT_CORE_SPEC, $DBT_DUCKDB_SPEC and duckdb==$DUCKDB_VERSION"
uv pip install --python "$PY" "$DBT_CORE_SPEC" "$DBT_DUCKDB_SPEC" "duckdb==$DUCKDB_VERSION"
"$VENV/bin/dbt" --version
LIB_VERSION="$("$PY" -c 'import duckdb; print(duckdb.__version__)')"
ok "DuckDB Python library in the venv: $LIB_VERSION"
if [ -n "$CLI_VERSION" ] && [ "$CLI_VERSION" != "$LIB_VERSION" ]; then
  warn "your DuckDB CLI is v$CLI_VERSION but the venv has $LIB_VERSION. They must be equal (Chapter 2)."
  warn "fix: DUCKDB_VERSION=$CLI_VERSION bash setup.sh    (or install DuckDB CLI $LIB_VERSION)"
fi

# ---------------------------------------------------------------- 4. databases
build_db() {  # build_db <folder>
  local dir="$1"
  if [ -e "$dir/practice.duckdb" ] && [ "${REBUILD_DB:-0}" != 1 ]; then
    ok "$dir/practice.duckdb exists: kept (REBUILD_DB=1 to reset it to day 1)"
    return
  fi
  (cd "$dir" && "$PY" "$COURSE/kit/tools/duck.py" practice.duckdb -f setup.sql)
  ok "built $dir/practice.duckdb"
}
step "Practice database (= duckdb practice.duckdb < setup.sql)"
build_db "$COURSE/practice"
step "Reference database (a separate copy, for the reference project only)"
build_db "$COURSE/reference/practice"

# ---------------------------------------------------------------- 5. reference project
if [ "$HAVE_GIT" = 1 ]; then
  step "Reference project: $COURSE/reference/jaffle_dbt (git clone of kit/jaffle_dbt.bundle)"
  REF="$COURSE/reference/jaffle_dbt"
  if [ -d "$REF/.git" ]; then
    ok "already cloned (kept as it is)"
  else
    git clone "$COURSE/kit/jaffle_dbt.bundle" "$REF"
  fi
  [ -e "$REF/profiles.yml" ] || cp "$COURSE/kit/profiles/profiles.yml" "$REF/profiles.yml"
  grep -qx 'profiles.yml' "$REF/.git/info/exclude" 2>/dev/null || printf 'profiles.yml\n' >> "$REF/.git/info/exclude"
  ok "$(git -C "$REF" tag -l 'ch*' | wc -l | tr -d ' ') chapter tags (ch06 ... ch25); profiles.yml added (ignored by git)"
fi

# ---------------------------------------------------------------- 6. dbt debug
step "dbt debug (checks dbt, the DuckDB adapter and the connection to practice.duckdb)"
if (cd "$COURSE/kit/check" && "$VENV/bin/dbt" debug); then
  ok "dbt debug passed"
else
  if [ "$HAVE_GIT" = 0 ]; then
    die "dbt debug failed (git is missing: install it, then run setup again)"
  fi
  die "dbt debug failed: read the lines above (is another program using practice.duckdb?)"
fi

cat <<EOF

============================================================================
 Setup complete.
   Course folder : $COURSE
   Activate      : source $COURSE/.venv/bin/activate
   Then          : dbt --version        (installed: 1.11.x, duckdb: 1.11.x)
   Your database : $COURSE/practice/practice.duckdb
   Reference     : $COURSE/reference/jaffle_dbt   (git tag -n lists the chapters)
 Next: read $COURSE/kit/README.md
============================================================================
EOF
