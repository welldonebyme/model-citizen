# dbt course practice kit (macOS, Linux, WSL)

This kit gives you everything the book's labs need on your own computer: the practice data,
the data update scripts, the bug files of Chapter 22, and the reference project with one git tag
per chapter. **On Windows, read `README-windows.md` instead.**

## 1. What is in the kit

| Item | What it is | Used in |
|---|---|---|
| `setup.sh` | Builds your course folder `~/dbt-course` (Chapter 2's lab, done for you) | once |
| `setup.ps1` | The same for Windows PowerShell | once (Windows) |
| `data/` | The 5 raw tables as CSV files (100 customers, 300 orders, ...) | Chapter 2 |
| `setup.sql` | Creates the raw database `practice.duckdb` from `data/` | Chapter 2 (and to reset) |
| `updates/` | `day2.sql` (the next loading day), `fresh_load.sql` (2 orders loaded "now") + README | Chapters 13, 14, 21 |
| `bugs/` | 9 patch files, each one creates one error + README | Chapter 22 |
| `jaffle_dbt.bundle` | The reference project as a git bundle: tags `ch06` ... `ch25` = the end of each chapter | Chapters 6 to 25 |
| `profiles/profiles.yml` | The book's `jaffle_dbt` profile (dev, ci, prod) | to run the reference project |
| `tools/duck.py` | Runs SQL with the DuckDB library of your venv (no DuckDB CLI needed) | any time |
| `tools/run_sql.py` | The book's small SQL helper (same options as in the book) | Chapters 17, 20 |
| `check/` | A tiny project used by the setup to run `dbt debug` | setup only |

## 2. Before you start

You need a terminal and two tools:

1. **uv** (installs Python and the packages). Check: `uv --version`.
   macOS: `brew install uv`. Linux / WSL: `curl -LsSf https://astral.sh/uv/install.sh | sh`, then open a new terminal.
2. **git**. Check: `git --version`. macOS: accept the "command line developer tools" window
   (or run `xcode-select --install`). Linux / WSL: `sudo apt install git`.
3. Optional but used in the book: the **DuckDB command-line tool**. macOS: `brew install duckdb`.
   Linux / WSL: download it from duckdb.org. Without it, use `tools/duck.py` (see section 6).

You do NOT need to install Python yourself: uv downloads Python 3.12.

## 3. Run the setup

Unzip the kit (anywhere, for example in Downloads), open a terminal in the unzipped folder, then:

```bash
cd ~/Downloads/dbt-course-kit
bash setup.sh
```

It takes one or two minutes. You can run it again at any time: it keeps your venv, your files and your
database. The end of the output must look like this:

```text
==> dbt debug (checks dbt, the DuckDB adapter and the connection to practice.duckdb)
...
  Connection test: [OK connection ok]

All checks passed!
    OK  dbt debug passed
```

Options: `DBT_COURSE_DIR=/other/folder bash setup.sh` (another folder), `REBUILD_DB=1 bash setup.sh`
(reset the raw data to day 1), `bash setup.sh --install-tools` (installs uv for you).

## 4. What the setup created

```text
~/dbt-course/
  .venv/                    Python 3.12 + dbt-core 1.11 + dbt-duckdb 1.11 + duckdb 1.5.6
  practice/                 YOUR raw database (Chapter 2)
    data/  setup.sql  updates/  practice.duckdb
  kit/                      this kit = the book's "labs" folder (see section 6)
    data/  setup.sql  updates/  bugs/  jaffle_dbt.bundle  tools/  profiles/  check/  README files
    capstone/               added by the capstone kit (Chapter 26)
  reference/                the reference project, separate from your work
    jaffle_dbt/             git clone of the bundle (+ a profiles.yml that git ignores)
    practice/               its own copy of the raw database
```

Your own dbt project, `~/dbt-course/jaffle_dbt`, does not exist yet: you create it in Chapter 6 with
`dbt init`, and you write your own `~/.dbt/profiles.yml` there. The setup never touches `~/.dbt`.

Every time you open a new terminal, activate the venv first:

```bash
cd ~/dbt-course
source .venv/bin/activate
dbt --version      # installed: 1.11.x  and  duckdb: 1.11.x
```

## 5. Versions: one DuckDB version everywhere

* **dbt Core 1.11** (`dbt-core~=1.11.0`): the exam version. The message "Update available" is normal.
* **dbt-duckdb 1.11.x**: the adapter.
* **DuckDB 1.5.6**: the book's outputs were produced with it, so the kit pins the Python library
  `duckdb==1.5.6` in the venv.

The rule from Chapter 2: the DuckDB **command-line tool** and the DuckDB **Python library in the venv**
must have the same version. A database file written by a newer DuckDB cannot be opened by an older one.

```bash
duckdb --version                                       # the CLI, for example v1.5.6
python -c "import duckdb; print(duckdb.__version__)"   # the library in the venv (venv active)
```

If they differ, the setup prints a warning. Fix it in one of two ways: install the CLI version 1.5.6, or
align the venv with your CLI: `DUCKDB_VERSION=1.5.7 bash setup.sh` (use YOUR CLI number, without the "v").

## 6. The book's paths on your machine

The book was written on the author's Mac: its labs use files of the book's own folder (its `labs` folder and
its `tools` folder). The website already shows every path rewritten for the kit. The kit folder
`~/dbt-course/kit` plays the role of the book's `labs` folder:

| In the book | With the kit (and on the website) |
|---|---|
| `labs/data`, `labs/setup.sql`, `labs/updates` | `~/dbt-course/kit/data`, `~/dbt-course/kit/setup.sql`, `~/dbt-course/kit/updates` (the setup also copied them to `~/dbt-course/practice/`) |
| `labs/practice-project/bugs` | `~/dbt-course/kit/bugs` |
| `labs/practice-project/jaffle_dbt` (the reference repository) | `~/dbt-course/kit/jaffle_dbt.bundle` (a git remote; a clone is in `~/dbt-course/reference/jaffle_dbt`) |
| `labs/capstone` | `~/dbt-course/kit/capstone` (capstone kit) |
| `labs/capstone/shopflow_dbt` (the capstone solution) | `~/dbt-course/kit/capstone/shopflow_dbt.bundle` |
| `tools/run_sql.py` | `~/dbt-course/kit/tools/run_sql.py` |
| the book's folder ("the bible folder") | `~/dbt-course/kit` (the kit folder) |
| the author's home folder in the book's outputs | your own home folder (`/Users/<you>/...`) |

The book's schema is `dbt_adnane`. You may keep it or use your own name (`dbt_<yourname>`): only the
names in the outputs change.

Running a SQL script **without** the DuckDB CLI (same result as `duckdb practice.duckdb < file.sql`):

```bash
cd ~/dbt-course/practice
python ../kit/tools/duck.py practice.duckdb -f updates/day2.sql
python ../kit/tools/duck.py practice.duckdb "select count(*) from jaffle_shop.orders"
```

Close every DuckDB session (CLI, DBeaver, a Python prompt) before you run dbt: a DuckDB file accepts
only one writer, and even a read-only session blocks dbt.

## 7. The reference project (one tag per chapter)

`jaffle_dbt.bundle` is a git repository in one file. It holds the reference solution of the practice
project: tag `ch07` = the project at the end of Chapter 7, and so on up to `ch25`. Use it to check your
work, not to skip it.

Look at it (the setup already cloned it):

```bash
cd ~/dbt-course/reference/jaffle_dbt
git tag -n                          # the chapters
git diff ch11 ch12 --stat           # which files Chapter 12 changed
git show ch14:models/marts/fct_orders.sql
```

Compare YOUR project with it (from Chapter 6 on; this is the book's "reference" remote):

```bash
cd ~/dbt-course/jaffle_dbt
git remote add reference ~/dbt-course/kit/jaffle_dbt.bundle
git fetch --no-tags reference "refs/tags/*:refs/tags/ref-*"    # tags arrive as ref-ch06 ... ref-ch25
git diff ref-ch12 -- models/
```

Run it (it uses its own database in `~/dbt-course/reference/practice`, so your work is never touched):

```bash
cd ~/dbt-course/reference/jaffle_dbt
git checkout ch07
dbt build                           # Chapter 7: Done. PASS=17 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=17
git checkout main                   # back to the last state (= ch25 + README)
```

From tag `ch11` on, run `dbt deps` first (it downloads dbt_utils and audit_helper: internet needed).
From tag `ch15` on, the Python model needs pandas in the venv: `uv pip install pandas` (venv active).
Chapter 15 makes you install it on purpose, so the setup does not.
From tag `ch19` on, a **fresh** database needs `dbt build --exclude-resource-type unit_test` once before
a plain `dbt build` (a unit test mocks `this` of the incremental `fct_orders`; Chapter 19 explains it).

## 8. Data update scripts (Chapters 13, 14, 21)

```bash
cd ~/dbt-course/practice
duckdb practice.duckdb < updates/day2.sql          # Chapter 13 (and 14): the next loading day
duckdb practice.duckdb < updates/fresh_load.sql    # Chapter 21: 2 orders loaded "now"
duckdb practice.duckdb < setup.sql                 # reset the raw data to day 1 (dbt schemas are kept)
```

Without the CLI: `python ../kit/tools/duck.py practice.duckdb -f updates/day2.sql`. Details: `updates/README.md`.

## 9. Bug files (Chapter 22)

```bash
cd ~/dbt-course/jaffle_dbt
git status                                                   # start from a clean working tree
git apply ~/dbt-course/kit/bugs/01-jinja-missing-endif.patch
dbt parse                                                    # read the error
git apply -R ~/dbt-course/kit/bugs/01-jinja-missing-endif.patch
```

The patches were made against tag `ch21` (they also apply to `ch22` ... `ch25`). Details: `bugs/README.md`.

## 10. Troubleshooting

| Message | What to do |
|---|---|
| `command not found: dbt` | The venv is not active: `cd ~/dbt-course && source .venv/bin/activate`. |
| `Could not set lock on file ... practice.duckdb` | Another program has the database open (DuckDB CLI, DBeaver). Close it, run dbt again. |
| `The database file was created with a newer version of DuckDB` | Your CLI and your venv differ: see section 5. |
| `zsh: no matches found: stg_*` | Quote selections that contain `*`: `dbt ls -s "stg_*"`. |
| `error: patch does not apply` | Your file differs from the reference: compare with `git diff ref-ch21`, or make the 1 to 3 line change by hand. |
| `uv: command not found` after installing it | Open a new terminal. |

WSL (Ubuntu on Windows): follow this README inside the Ubuntu terminal. Keep the course folder in the
Linux home (`~/dbt-course`), not under `/mnt/c/...` (much slower, and file locks behave differently).
