# 06 — Labs: in the browser, on the machine, and on Windows

The book has **118 labs**. On the website every lab gets one of three treatments (often a mix):

| Type | Runs where | Used for | Checking |
|---|---|---|---|
| **A. In-browser executable** | DuckDB-WASM, Pyodide (jinja2, pyyaml), JS selection engine | SQL (Ch4 and every SQL example), YAML errors, Jinja rendering, node selection, lineage | automatic (result-set compare, golden outputs) |
| **B. Real-machine guided** | the learner's computer (macOS / Windows / WSL) | install, Git/GitHub, running real dbt on the practice project and the capstone | checklists + **paste-to-verify** + expected outputs |
| **C. dbt in the browser** | Pyodide (real dbt) or a dbt simulator | "try it now" versions of dbt labs before (or instead of) the real machine | golden outputs from `reference/builder-logs` |

Keep type B for every lab that the book does on the machine: the exam rewards real experience, and the
labs build the learner's own `jaffle_dbt` repository step by step (tags `ch06`…`ch25` show the target state).

## A. In-browser labs
- **SQL**: load `labs/data/*.csv` into DuckDB-WASM exactly like `labs/setup.sql` (schemas `jaffle_shop`,
  `stripe`). Every book SQL block followed by an `outputcode` "Result" = a runnable cell with the expected
  result; checker compares columns + rows (order-insensitive unless the query has `order by`). Buttons:
  run, reset, show expected, "apply day 2" (`labs/updates/day2.sql`), "fresh load" (`fresh_load.sql`).
  Note: the book's outputs were produced with DuckDB 1.5.6 (and 2.0 for Chapter 4); the WASM build may be a
  different DuckDB version — run the SQL parity test (see `07-quality.md`) and fix any difference explicitly.
- **YAML**: PyYAML in Pyodide gives the same messages as the book's examples (Chapter 5 shows PyYAML and dbt
  messages); show line/column highlighting. Exercises: fix-the-file, the 9 bug patches' YAML ones.
- **Jinja**: jinja2 in Pyodide with a dbt-like context (`ref`, `source`, `config`, `var`, `env_var`,
  `target`, `this`, `is_incremental`, `log`, `return`) → compiled SQL → run in DuckDB-WASM.
- **Selection & lineage**: generate `manifest.json` per tag (`dbt parse` with the verification env), export
  nodes/edges/tags/paths/resource types. Implement the selection grammar in TypeScript (graph operators `+`,
  `n+`, `+n`, `@`, `*`; space = union, comma = intersection; `--exclude`; methods `tag:`, `path:`, `fqn:`,
  `source:`, `resource_type:`, `config.*:`, `test_type:`, `test_name:`, `package:`, `exposure:`, `group:`,
  `access:`, `version:`; state/result methods simulated with stored state). Golden-test against every real
  `dbt ls` output recorded in the logs and the book (Chapter 16 has 44 verified examples). Known 1.11 facts:
  `fqn` never matches sources; `"tag:a, tag:b"` (comma + space) selects only the second item; `selector:` as a
  method is NOT valid in 1.11.

## B. Real-machine labs
- **Lab runner UI**: numbered steps, OS switch, copy buttons, expected output (collapsible), troubleshooting,
  "done" checkboxes, and **paste-to-verify** fields. Parse rules (tolerant of timestamps and thread order):
  - dbt summary: `Done. PASS=n WARN=n ERROR=n SKIP=n NO-OP=n TOTAL=n`
  - `dbt --version`: `installed: 1.11.x`, plugin `duckdb: 1.11.x`
  - `dbt ls`: set of node names
  - DuckDB result tables: values
  - `git log --oneline` / `git status --short`: commits, files
- **Practice kit (zip)** replacing the book's local paths: `data/`, `setup.sql`, `updates/`, `bugs/`,
  a README per OS, and the two reference repositories as **git bundles** (`jaffle_dbt.bundle` with tags
  `ch06..ch25`, `shopflow_dbt.bundle` with `m00..m14`) — `git clone jaffle_dbt.bundle` works on every OS.
  (Alternative: publish them as public GitHub repos — ask the user.)
- Fresh database rule (from Chapter 19 on): run `dbt build --exclude-resource-type unit_test` once before a plain
  `dbt build` (a unit test mocks `this` of an incremental model). Keep this in every relevant lab.
- DuckDB version pin (Chapter 2): the Python `duckdb` library in the venv must equal the DuckDB CLI version.

## Windows (the friend) — adapt every OS-specific step
The book is written for macOS/zsh. Provide **Windows (PowerShell)** variants (and WSL notes) for Chapters 2,
3, 6 and every lab step that uses shell commands. Commands below are from official documentation knowledge —
**none were executed on Windows yet: verify them** (ideally in a GitHub Actions `windows-latest` job that runs
the kit's setup script end to end).

| macOS / zsh (book) | Windows PowerShell | Notes |
|---|---|---|
| `brew install uv` | `winget install --id=astral-sh.uv -e` or the official `irm https://astral.sh/uv/install.ps1 \| iex` | |
| `brew install duckdb` | `winget install DuckDB.cli` | then pin the venv's `duckdb` to the CLI version |
| Git (Xcode CLT) | `winget install --id Git.Git -e` | `git config --global core.autocrlf true` |
| `uv venv --python 3.12 .venv` | same | |
| `source .venv/bin/activate` | `.venv\Scripts\Activate.ps1` | may need `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `duckdb practice.duckdb < setup.sql` | `duckdb practice.duckdb -c ".read setup.sql"` (also works on macOS) | PowerShell has no `<` redirection |
| `export X=1` | `$env:X = "1"` | |
| `cp -R a b`, `mkdir -p d`, `rm -rf d` | `Copy-Item -Recurse a b`, `New-Item -ItemType Directory -Force d`, `Remove-Item -Recurse -Force d` | |
| `ls -la`, `cat f`, `head -5 f`, `grep x f` | `Get-ChildItem -Force`, `Get-Content f`, `Get-Content f -TotalCount 5`, `Select-String x f` | |
| `echo $?` | `$LASTEXITCODE` | exit codes matter in CI lessons |
| `~/.dbt/profiles.yml` | `$HOME\.dbt\profiles.yml` | |
| `# comment` typed in zsh breaks (Ch2 trap) | PowerShell accepts `#` comments | |

dbt commands themselves are identical on every OS. WSL (Ubuntu) users can follow the macOS/Linux commands
with `apt`/official installers instead of Homebrew.

## C. dbt in the browser — spike first (time-box ~1 day), then decide
**Attempt 1 — real dbt in Pyodide** (iterate in Node with the `pyodide` npm package, then the browser):
- `micropip.install(["dbt-core==1.11.16", "dbt-duckdb==1.11.0"])` and watch the failures. Likely blockers:
  native wheels (`dbt-extractor` — static parser, may be stubbed with the static parser turned off;
  `duckdb` — needs an emscripten/Pyodide build; `rpds-py`, `pydantic-core` — Pyodide may provide them),
  **threads** (Pyodide has no threads; dbt's thread pool may need a synchronous shim), `subprocess`/git
  (avoid `dbt deps`; pre-install packages into the virtual FS).
- Success criteria: `dbt build` on the reference project at a few tags runs in < ~30 s in a browser and its
  outputs match the golden logs (except timings).
**Attempt 2 — dbt simulator** (if attempt 1 fails): a small engine that reads the project (PyYAML/jinja2 in
Pyodide or TS), renders models with a dbt-like Jinja context, builds the DAG, executes materializations
(view, table, ephemeral CTE injection, incremental delete+insert/merge) and generic tests in DuckDB-WASM, and
prints dbt-style logs. Scope it to what the labs need, label it "simulator", and validate against the golden
outputs. Never present simulator output as real dbt output.
