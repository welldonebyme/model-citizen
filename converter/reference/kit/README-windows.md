# dbt course practice kit - Windows (PowerShell)

The book is written for a Mac. Everything works on Windows too: **dbt commands are exactly the same**;
only a few shell commands change. This file shows the Windows way, step by step. Use **PowerShell**
(Start menu > "Windows PowerShell" or "Terminal"), not the old `cmd`.

> Alternative: WSL (Ubuntu inside Windows). If you prefer Linux, install WSL, open the Ubuntu terminal and
> follow `README.md` instead of this file.

## 1. What is in the kit

The same as in `README.md`, section 1: `setup.ps1` (the setup for Windows), `data\`, `setup.sql`,
`updates\`, `bugs\`, `jaffle_dbt.bundle` (the reference project with one git tag per chapter),
`profiles\profiles.yml`, `tools\duck.py` and `tools\run_sql.py`.

## 2. Install the tools (once)

Open PowerShell and type these commands one by one. `winget` is the Windows package installer
(included in Windows 10 and 11). The first time, it asks you to accept its terms: type `Y`.

```powershell
winget install --id=astral-sh.uv -e        # uv: installs Python and the packages
winget install --id Git.Git -e              # git
winget install DuckDB.cli                   # the DuckDB command-line tool (optional, used in the book)
```

Recommended (not required): PowerShell 7, the newer PowerShell. A few commands of the course need it
(the website says so next to them); Windows PowerShell 5.1, built into Windows, works for everything else:

```powershell
winget install --id Microsoft.PowerShell -e   # then use "PowerShell 7" from the Start menu
```

Then **close PowerShell and open it again** (new programs are found only in a new window). Check:

```powershell
uv --version
git --version
duckdb --version
```

If `winget` does not exist on your computer, install uv with
`powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
and Git from git-scm.com. Then tell Git to handle Windows line endings (once):

```powershell
git config --global core.autocrlf true
```

## 3. Run the setup

Right-click the downloaded `dbt-course-kit.zip` > **Extract All...** (for example into `Downloads`).
In PowerShell, go into the extracted folder and run the setup:

```powershell
cd $HOME\Downloads\dbt-course-kit
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

`-ExecutionPolicy Bypass` lets Windows run this one script; it changes no setting. If you
extracted the zip somewhere else, `cd` into that folder (the one that contains `setup.ps1`).

It takes one or two minutes. You can run it again at any time: it keeps your venv, your files and your
database. The end of the output must look like this:

```text
==> dbt debug (checks dbt, the DuckDB adapter and the connection to practice.duckdb)
...
  Connection test: [OK connection ok]

All checks passed!
    OK  dbt debug passed
```

Options: `-CourseDir D:\dbt-course` (another folder), `-RebuildDb` (reset the raw data to day 1),
`-InstallTools` (installs missing uv / Git with winget), `-DuckDBVersion 1.5.7` (see section 5).

## 4. What the setup created

```text
C:\Users\<you>\dbt-course\           (= $HOME\dbt-course)
  .venv\                    Python 3.12 + dbt-core 1.11 + dbt-duckdb 1.11 + duckdb 1.5.6
  practice\                 YOUR raw database (Chapter 2)
    data\  setup.sql  updates\  practice.duckdb
  kit\                      this kit = the book's "labs" folder
    data\  setup.sql  updates\  bugs\  jaffle_dbt.bundle  tools\  profiles\  check\  README files
    capstone\               added by the capstone kit (Chapter 26)
  reference\                the reference project, separate from your work
    jaffle_dbt\             git clone of the bundle (+ a profiles.yml that git ignores)
    practice\               its own copy of the raw database
```

The book's folder `~/Documents/Adnane/dbt-bible/labs` (the "bible folder") is the kit folder
`$HOME\dbt-course\kit` (the website already shows the paths rewritten; README.md section 6 has the full table).
When the book says `~/dbt-course`, use `$HOME\dbt-course`. When it says `~/.dbt/profiles.yml`, use
`$HOME\.dbt\profiles.yml` (you create it in Chapter 6; the setup never touches it).

**Activate the venv** every time you open a new PowerShell window:

```powershell
cd $HOME\dbt-course
.venv\Scripts\Activate.ps1
dbt --version        # installed: 1.11.x  and  duckdb: 1.11.x
```

If PowerShell says "running scripts is disabled on this system", allow scripts for your user once,
then activate again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

(Without changing that setting you can also call the programs by their full path:
`$HOME\dbt-course\.venv\Scripts\dbt.exe --version`.)

## 5. Versions: one DuckDB version everywhere

* **dbt Core 1.11** (`dbt-core~=1.11.0`): the exam version. "Update available" is normal: ignore it.
* **dbt-duckdb 1.11.x**: the adapter.
* **DuckDB 1.5.6**: the book's outputs were produced with it, so the kit pins `duckdb==1.5.6` in the venv.

Rule (Chapter 2): the DuckDB **command-line tool** and the DuckDB **Python library in the venv** must have
the same version, because a database file written by a newer DuckDB cannot be opened by an older one.

```powershell
duckdb --version                                       # the CLI, for example v1.5.6
python -c "import duckdb; print(duckdb.__version__)"   # the library (venv active)
```

`winget install DuckDB.cli` installs the newest DuckDB. If it is not 1.5.6, the setup prints a warning.
Then either align the venv with your CLI (use YOUR number, without the "v"):

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -DuckDBVersion 1.5.7
```

or install exactly 1.5.6: `winget install DuckDB.cli --version 1.5.6` (if winget offers that version).

## 6. The book's commands on Windows

dbt commands (`dbt run`, `dbt ls -s "tag:finance"`, ...) are the same. These shell commands change:

| Book (macOS, zsh) | Windows PowerShell |
|---|---|
| `source .venv/bin/activate` | `.venv\Scripts\Activate.ps1` |
| `duckdb practice.duckdb < setup.sql` | `duckdb practice.duckdb -c ".read setup.sql"` |
| `duckdb practice.duckdb < updates/day2.sql` | `duckdb practice.duckdb -c ".read updates/day2.sql"` |
| (no DuckDB CLI) | `python ..\kit\tools\duck.py practice.duckdb -f updates\day2.sql` |
| `export DBT_TARGET=prod` | `$env:DBT_TARGET = "prod"` (and `Remove-Item Env:DBT_TARGET` to undo) |
| `DBT_TARGET=prod dbt compile` (one command) | `$env:DBT_TARGET = "prod"; dbt compile; Remove-Item Env:DBT_TARGET` |
| `echo $?` | `$LASTEXITCODE` |
| `mkdir -p a/b` | `New-Item -ItemType Directory -Force a\b` |
| `cp -R a b` | `Copy-Item -Recurse -Force a b` |
| `rm -rf target` | `Remove-Item -Recurse -Force target` |
| `cat file` / `head -5 file` | `Get-Content file` / `Get-Content file -TotalCount 5` |
| `grep text file` | `Select-String text file` |
| `ls -la` | `Get-ChildItem -Force` |
| `~/.dbt/profiles.yml` | `$HOME\.dbt\profiles.yml` |
| `open target/index.html` | `start target\index.html` |
| `code .` | `code .` (VS Code: same) |

Notes:

* PowerShell has no `<` redirection. That is why the table uses `-c ".read file"` or `duck.py`.
* PowerShell accepts `#` comments on the command line (zsh on the Mac does not; Chapter 2's trap does
  not exist on Windows).
* Quote dbt selections that contain `*`, `,` or spaces, like on the Mac: `dbt ls -s "stg_jaffle_shop__*"`.
* Paths: both `\` and `/` work for dbt and Python. The profile path `../practice/practice.duckdb` works as it is.

## 7. The reference project (one tag per chapter)

```powershell
cd $HOME\dbt-course\reference\jaffle_dbt
git tag -n                          # the chapters ch06 ... ch25
git diff ch11 ch12 --stat           # which files Chapter 12 changed
git show ch14:models/marts/fct_orders.sql
```

Compare YOUR project with it (from Chapter 6 on; this is the book's "reference" remote):

```powershell
cd $HOME\dbt-course\jaffle_dbt
git remote add reference $HOME\dbt-course\kit\jaffle_dbt.bundle
git fetch --no-tags reference "refs/tags/*:refs/tags/ref-*"
git diff ref-ch12 -- models/
```

Run it (it has its own database in `reference\practice`; your work is never touched):

```powershell
cd $HOME\dbt-course\reference\jaffle_dbt
git checkout ch07
dbt build                           # Chapter 7: Done. PASS=17 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=17
git checkout main
```

From tag `ch11` on, run `dbt deps` first (internet needed). From tag `ch15` on, the Python model needs
pandas: `uv pip install pandas` (venv active; Chapter 15 makes you install it on purpose, so the setup does not).
From tag `ch19` on, a **fresh** database needs `dbt build --exclude-resource-type unit_test` once before a
plain `dbt build` (Chapter 19).

## 8. Data update scripts (Chapters 13, 14, 21)

```powershell
cd $HOME\dbt-course\practice
duckdb practice.duckdb -c ".read updates/day2.sql"         # Chapter 13 (and 14)
duckdb practice.duckdb -c ".read updates/fresh_load.sql"   # Chapter 21
duckdb practice.duckdb -c ".read setup.sql"                # reset the raw data to day 1
```

Without the DuckDB CLI: `python ..\kit\tools\duck.py practice.duckdb -f updates\day2.sql` (venv active).

## 9. Bug files (Chapter 22)

```powershell
cd $HOME\dbt-course\jaffle_dbt
git status
git apply $HOME\dbt-course\kit\bugs\01-jinja-missing-endif.patch
dbt parse
git apply -R $HOME\dbt-course\kit\bugs\01-jinja-missing-endif.patch
```

If `git apply` says "patch does not apply" and your files are correct, the cause is often Windows line
endings: add `--ignore-whitespace` (`git apply --ignore-whitespace ...`, and the same for `-R`).

## 10. Troubleshooting

| Message | What to do |
|---|---|
| `dbt : The term 'dbt' is not recognized` | The venv is not active: `cd $HOME\dbt-course; .venv\Scripts\Activate.ps1`. |
| `running scripts is disabled on this system` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (once), or use `powershell -ExecutionPolicy Bypass -File ...`. |
| `Could not set lock on file ... practice.duckdb` | Another program has the database open (DuckDB CLI, DBeaver, a Python prompt). Close it, run dbt again. |
| `The database file was created with a newer version of DuckDB` | CLI and venv differ: section 5. |
| `uv` / `git` / `duckdb` not recognized after winget | Close PowerShell and open a new window. |
| `error: patch does not apply` | Add `--ignore-whitespace`, or compare with `git diff ref-ch21`. |
| The setup stops at "dbt debug failed" | Read the lines above it; usually another program has `practice.duckdb` open. |
