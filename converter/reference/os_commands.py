"""Build converter/overrides/os-commands.yaml: macOS/zsh -> Windows PowerShell rules for the book's shell commands.

    .venv-verify/.venv/bin/python -I converter/reference/os_commands.py      (needs pwsh and zsh on the PATH)

1. scans every command line of the book's bashcode blocks (scan_shell_commands.py) -> `scan` section
   (+ the machine sections `transforms`, `pipe_transforms`, `wsl_transforms`, `lines` from os_transforms.py,
   applied by converter/build/oscmd.py; `--transforms-only` rewrites only those, without the pwsh tests)
2. for every rule, counts the book lines it covers (count_re) and TESTS the PowerShell form under pwsh in a
   fixture folder (copies of labs/data, a small git repo, a log file, JSON lines...). When the test has a zsh
   side, the zsh output and the PowerShell output must be equal (after normalising line endings / trailing
   spaces); otherwise the PowerShell output must contain an expected text.
3. writes the YAML with, per rule, `tested:` = "pwsh <version> on macOS: ..." or "untested: <reason>".

Windows-only behaviour (Windows PowerShell 5.1, winget, .venv\\Scripts, no ~ expansion for native programs,
default file encodings) cannot be tested on macOS: those rules say so explicitly.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import os_transforms as OT  # noqa: E402
import scan_shell_commands as S  # noqa: E402
import transcripts as T  # noqa: E402

ACADEMY = Path(__file__).resolve().parents[2]
OUT = ACADEMY / "converter" / "overrides" / "os-commands.yaml"
VENV = ACADEMY / ".venv-verify" / ".venv"
LABS = T.BIBLE / "labs"

# ---------------------------------------------------------------------------------------------------- rules
# count_re: regex applied to each book command line (to count the lines the rule covers)
# test: {"zsh": ..., "pwsh": ..., "compare": "equal"} or {"pwsh": ..., "expect": "text"} or {"pwsh": ..., "expect_error": "text"}
RULES = [
    # ---------------------------------------------------------------- environment / venv
    dict(id="venv-activate", category="python env",
         zsh="source .venv/bin/activate", powershell=r".venv\Scripts\Activate.ps1",
         count_re=r"^source \S*\.venv/bin/activate",
         notes="Relative forms map the same way: `source ../.venv/bin/activate` -> `..\\.venv\\Scripts\\Activate.ps1`. "
               "If PowerShell says 'running scripts is disabled', run once: "
               "`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (or call `.venv\\Scripts\\dbt.exe` directly).",
         test={"pwsh": f"& '{VENV}/bin/activate.ps1'; (Get-Command python).Source; deactivate; 'deactivated'",
               "expect": ".venv/bin/python"},
         partial="tested with the venv's bin/activate.ps1 under pwsh on macOS; the Windows path .venv\\Scripts\\Activate.ps1 "
                 "and the execution-policy prompt are untested"),
    dict(id="venv-deactivate", category="python env", zsh="deactivate", powershell="deactivate",
         count_re=r"^deactivate\b", test={"pwsh": f"& '{VENV}/bin/activate.ps1'; deactivate; 'ok'", "expect": "ok"}),
    dict(id="uv-venv", category="python env", zsh="uv venv --python 3.12 .venv", powershell="uv venv --python 3.12 .venv",
         count_re=r"^uv venv\b", notes="Identical. uv installs Python 3.12 itself if it is missing.",
         test={"pwsh": "uv venv --help | Select-Object -First 1", "expect": "Create a virtual environment"}),
    dict(id="uv-pip-install", category="python env", zsh='uv pip install "dbt-core~=1.11.0" "dbt-duckdb~=1.11.0"',
         powershell='uv pip install "dbt-core~=1.11.0" "dbt-duckdb~=1.11.0"', count_re=r"^uv pip install\b",
         notes="Identical (double quotes keep `~=` and `==` away from the shell).",
         test={"pwsh": 'python3 -c "import sys; print(sys.argv[1:])" "dbt-core~=1.11.0" "duckdb==1.5.6"',
               "zsh": 'python3 -c "import sys; print(sys.argv[1:])" "dbt-core~=1.11.0" "duckdb==1.5.6"', "compare": "equal"}),
    dict(id="python-venv-classic", category="python env", zsh="python3.12 -m venv .venv", powershell="py -3.12 -m venv .venv",
         count_re=r"^python3\.12 -m venv", notes="`py` is the Python launcher installed by the python.org installer.",
         untested="the Windows `py` launcher does not exist on macOS"),
    dict(id="python-c", category="python env", zsh='python -c "import duckdb; print(duckdb.__version__)"',
         powershell='python -c "import duckdb; print(duckdb.__version__)"', count_re=r"^python3? -c ",
         notes="Identical when the code uses single quotes inside double quotes (all the book's examples do). "
               "Windows PowerShell 5.1 drops embedded double quotes passed to programs: never put \" inside the code.",
         test={"pwsh": f"& '{VENV}/bin/python' -c \"import yaml; print(yaml.safe_load('a: [1, 2]'))\"",
               "zsh": f"'{VENV}/bin/python' -c \"import yaml; print(yaml.safe_load('a: [1, 2]'))\"", "compare": "equal"}),
    dict(id="python-script", category="python env",
         zsh='python -I ~/Documents/Adnane/dbt-bible/tools/run_sql.py --db ../practice/practice.duckdb "select ..."',
         powershell=r'python -I $HOME\dbt-course\kit\tools\run_sql.py --db ../practice/practice.duckdb "select ..."',
         count_re=r"^python3? (-I |-m |\S+\.py)", notes="Book path -> kit path (see the kit README). Use $HOME, not ~ (next rule).",
         test={"pwsh": f"& '{VENV}/bin/python' -I '{T.BIBLE}/tools/run_sql.py' --db fixture.duckdb 'select 42 as answer'",
               "expect": "42 |"}),
    dict(id="which", category="python env", zsh="which python", powershell="(Get-Command python).Source",
         count_re=r"^which\b", notes="`where.exe python` also works (lists every match). Outside a venv, Windows may "
                                    "find the Microsoft Store alias python.exe: activate the venv first.",
         test={"pwsh": "(Get-Command git).Source", "zsh": "which git", "compare": "equal"}),
    # ---------------------------------------------------------------- variables
    dict(id="export", category="variables", zsh='export DBT_DEMO_SECRET="abc123"', powershell='$env:DBT_DEMO_SECRET = "abc123"',
         count_re=r"^export ", notes="Lasts until the window is closed, like export.",
         test={"pwsh": '$env:DBT_DEMO_SECRET = "abc123"; python3 -c "import os; print(os.environ[\'DBT_DEMO_SECRET\'])"',
               "zsh": 'export DBT_DEMO_SECRET="abc123"; python3 -c "import os; print(os.environ[\'DBT_DEMO_SECRET\'])"',
               "compare": "equal"}),
    dict(id="export-pwd", category="variables", zsh="export DBT_PROFILES_DIR=$PWD/ci",
         powershell=r'$env:DBT_PROFILES_DIR = "$PWD\ci"', count_re=r"^export \w+=\$PWD",
         test={"pwsh": '$env:X = "$PWD/ci"; python3 -c "import os; print(os.environ[\'X\'])"',
               "zsh": 'export X=$PWD/ci; python3 -c "import os; print(os.environ[\'X\'])"', "compare": "equal"}),
    dict(id="unset", category="variables", zsh="unset DBT_DUCKDB_PATH", powershell="Remove-Item Env:DBT_DUCKDB_PATH",
         count_re=r"^unset ",
         test={"pwsh": '$env:X = "1"; Remove-Item Env:X; [string]::IsNullOrEmpty($env:X)', "expect": "True"}),
    dict(id="env-prefix", category="variables", zsh="DBT_TARGET=prod dbt compile",
         powershell='$env:DBT_TARGET = "prod"; dbt compile; Remove-Item Env:DBT_TARGET',
         count_re=r"^[A-Z_][A-Z0-9_]*=\S+ ", notes="PowerShell has no one-command prefix: set, run, remove. "
                                                "Several variables: set each one.",
         test={"pwsh": '$env:DBT_TARGET = "prod"; python3 -c "import os; print(os.environ.get(\'DBT_TARGET\'))"; '
                       'Remove-Item Env:DBT_TARGET; python3 -c "import os; print(os.environ.get(\'DBT_TARGET\'))"',
               "zsh": 'DBT_TARGET=prod python3 -c "import os; print(os.environ.get(\'DBT_TARGET\'))"; '
                      'python3 -c "import os; print(os.environ.get(\'DBT_TARGET\'))"', "compare": "equal"}),
    dict(id="echo", category="variables", zsh='echo "Hello dbt"', powershell='echo "Hello dbt"', count_re=r'^echo "[^$]*"$',
         notes="echo is an alias of Write-Output in PowerShell.",
         test={"pwsh": 'echo "Hello dbt"', "zsh": 'echo "Hello dbt"', "compare": "equal"}),
    dict(id="echo-var", category="variables", zsh='echo "My secret is $DBT_DEMO_SECRET"',
         powershell='echo "My secret is $env:DBT_DEMO_SECRET"', count_re=r"^echo .*\$[A-Z]",
         notes="Environment variables are $env:NAME in PowerShell; $HOME exists in both shells. $SHELL has no "
               "equivalent: use $PSVersionTable.PSVersion.",
         test={"pwsh": '$env:S = "abc"; echo "My secret is $env:S"; echo $HOME',
               "zsh": 'export S=abc; echo "My secret is $S"; echo $HOME', "compare": "equal"}),
    dict(id="shell-var", category="variables", zsh='T=assert_payments_match_order_totals; dbt test -s $T',
         powershell='$T = "assert_payments_match_order_totals"; dbt test -s $T', count_re=r"(^[A-Za-z_]\w*=\S+$)|(\$[A-Z]\b)",
         test={"pwsh": '$T = "x_y"; python3 -c "import sys; print(sys.argv[1])" $T',
               "zsh": 'T=x_y; python3 -c "import sys; print(sys.argv[1])" $T', "compare": "equal"}),
    dict(id="exit-code", category="exit codes", zsh="echo $?", powershell="$LASTEXITCODE",
         count_re=r"\$\?", notes="`dbt build; echo \"exit code: $?\"` -> `dbt build; \"exit code: $LASTEXITCODE\"`. "
                                 "In PowerShell, $? is only True/False; $LASTEXITCODE is the number of the last program.",
         test={"pwsh": 'python3 -c "import sys; sys.exit(3)"; "exit code: $LASTEXITCODE"',
               "zsh": 'python3 -c "import sys; sys.exit(3)"; echo "exit code: $?"', "compare": "equal"}),
    dict(id="and-chain", category="chaining", zsh="cd ~/dbt-course && source .venv/bin/activate",
         powershell=r"cd $HOME\dbt-course; .venv\Scripts\Activate.ps1", count_re=r"&&",
         notes="PowerShell 7 accepts `&&` (runs the next command only if the previous program succeeded); "
               "Windows PowerShell 5.1 does NOT (parser error). Portable form: separate lines, or `;`.",
         test={"pwsh": 'python3 -c "print(1)" && "second"', "zsh": 'python3 -c "print(1)" && echo second', "compare": "equal"},
         partial="`&&` tested in pwsh 7.6; its absence in Windows PowerShell 5.1 is documented, not tested"),
    dict(id="comment", category="chaining", zsh="dbt run   # a comment", powershell="dbt run   # a comment",
         count_re=r"(^|\s)#\s", notes="zsh needs `setopt interactivecomments` for typed comments (Chapter 2 trap); "
                                  "PowerShell always accepts them. The `echo 'setopt interactivecomments' >> ~/.zshrc` "
                                  "step does not exist on Windows.",
         test={"pwsh": '"before"   # a comment', "expect": "before"}),
    dict(id="line-continuation", category="chaining", zsh="command \\ (backslash at the end of a line)",
         powershell="command ` (backtick at the end of a line)", count_re=r"\\$",
         test={"pwsh": '"a" + `\n"b"', "expect": "ab"}),
    # ---------------------------------------------------------------- paths
    dict(id="home-tilde", category="paths", zsh="git apply ~/dbt-course/kit/bugs/01-jinja-missing-endif.patch",
         powershell=r"git apply $HOME\dbt-course\kit\bugs\01-jinja-missing-endif.patch", count_re=r"(^|\s)~/",
         notes="cd/Get-ChildItem accept ~, but programs (git, python, dbt, duckdb) may receive a literal `~`: "
               "always write $HOME for them. pwsh 7.6 on macOS expands ~ for programs; Windows PowerShell 5.1 does not.",
         test={"pwsh": 'python3 -c "import sys; print(sys.argv[1])" $HOME/dbt-course',
               "zsh": 'python3 -c "import sys; print(sys.argv[1])" ~/dbt-course', "compare": "equal"},
         partial="$HOME form tested; the missing ~ expansion of Windows PowerShell 5.1 is documented, not tested"),
    dict(id="profiles-path", category="paths", zsh="~/.dbt/profiles.yml", powershell=r"$HOME\.dbt\profiles.yml",
         count_re=r"~/\.dbt", test={"pwsh": "Join-Path $HOME '.dbt'", "zsh": "echo $HOME/.dbt", "compare": "equal"}),
    dict(id="tmp", category="paths", zsh="mv macros/generate_schema_name.sql /tmp/",
         powershell=r"Move-Item macros\generate_schema_name.sql $env:TEMP\ ", count_re=r"/tmp/",
         untested="$env:TEMP is Windows-only (on macOS pwsh it is empty)"),
    dict(id="cd", category="files", zsh="cd ~/dbt-course/practice", powershell=r"cd $HOME\dbt-course\practice",
         count_re=r"^cd ", notes="`cd ..` and relative paths are identical (cd = Set-Location).",
         test={"pwsh": "cd data; Split-Path -Leaf (Get-Location).Path; cd ..", "zsh": "cd data; basename $(pwd); cd ..",
               "compare": "equal"}),
    dict(id="pwd", category="files", zsh="pwd", powershell="pwd", count_re=r"^pwd\b",
         notes="pwd = Get-Location (prints a small table: use (Get-Location).Path for the bare path).",
         test={"pwsh": "(Get-Location).Path", "zsh": "pwd", "compare": "equal"}),
    dict(id="ls", category="files", zsh="ls data", powershell="Get-ChildItem data -Name", count_re=r"^ls\b",
         notes="On Windows `ls` and `dir` are aliases of Get-ChildItem (a table with Mode/LastWriteTime/Length/Name). "
               "`ls -la` -> `Get-ChildItem -Force` (shows hidden files). In pwsh on macOS/Linux `ls` runs the system ls.",
         test={"pwsh": "Get-ChildItem data -Name | Sort-Object", "zsh": "ls data", "compare": "equal"}),
    dict(id="ls-la", category="files", zsh="ls -la", powershell="Get-ChildItem -Force", count_re=r"^ls -la?\b",
         test={"pwsh": "Get-ChildItem -Force -Name | Where-Object { $_ -eq '.hidden' }", "expect": ".hidden"}),
    dict(id="mkdir-p", category="files", zsh="mkdir -p ~/dbt-course/practice",
         powershell=r"New-Item -ItemType Directory -Force $HOME\dbt-course\practice", count_re=r"^mkdir\b",
         notes="`mkdir dir` also works in PowerShell and creates missing parents; -Force = no error if it exists.",
         test={"pwsh": "New-Item -ItemType Directory -Force a/b/c | Out-Null; New-Item -ItemType Directory -Force a/b/c | Out-Null; Test-Path a/b/c",
               "expect": "True"}),
    dict(id="cp", category="files", zsh="cp ../practice/practice.duckdb ../practice/practice_copy.duckdb",
         powershell=r"Copy-Item ..\practice\practice.duckdb ..\practice\practice_copy.duckdb", count_re=r"^cp (?!-R)",
         test={"pwsh": "Copy-Item data/products.csv p_copy.csv; Get-Content p_copy.csv -TotalCount 2",
               "zsh": "cp data/products.csv p_copy2.csv; head -2 p_copy2.csv", "compare": "equal"}),
    dict(id="cp-R", category="files", zsh="cp -R ~/Documents/Adnane/dbt-bible/labs/data ~/dbt-course/practice/",
         powershell=r"Copy-Item -Recurse <kit>\data $HOME\dbt-course\practice\ ", count_re=r"^cp -R",
         notes="Like cp -R, Copy-Item -Recurse into an existing folder creates <folder>\\data.",
         test={"pwsh": "New-Item -ItemType Directory -Force dst1 | Out-Null; Copy-Item -Recurse data dst1/; Get-ChildItem dst1/data -Name | Sort-Object",
               "zsh": "mkdir -p dst2; cp -R data dst2/; ls dst2/data", "compare": "equal"}),
    dict(id="mv", category="files", zsh="mv a.sql b.sql", powershell="Move-Item a.sql b.sql", count_re=r"^mv ",
         test={"pwsh": "Set-Content -Path m1.txt -Value 'x'; Move-Item m1.txt m2.txt; Test-Path m2.txt", "expect": "True"}),
    dict(id="rm", category="files", zsh="rm ../practice/practice_copy.duckdb", powershell=r"Remove-Item ..\practice\practice_copy.duckdb",
         count_re=r"^rm (?!-r)", test={"pwsh": "Set-Content r1.txt 'x'; Remove-Item r1.txt; Test-Path r1.txt", "expect": "False"}),
    dict(id="rm-r", category="files", zsh="rm -r models/example", powershell=r"Remove-Item -Recurse -Force models\example",
         count_re=r"^rm -r", test={"pwsh": "New-Item -ItemType Directory -Force rr/x | Out-Null; Set-Content rr/x/f.txt 'x'; Remove-Item -Recurse -Force rr; Test-Path rr",
                                 "expect": "False"}),
    dict(id="cat", category="files", zsh="cat notes.txt", powershell="Get-Content notes.txt", count_re=r"^cat (?!-n)",
         notes="On Windows `cat` and `type` are aliases of Get-Content.",
         test={"pwsh": "Get-Content data/products.csv", "zsh": "cat data/products.csv", "compare": "equal"}),
    dict(id="cat-n-sed", category="files", zsh="cat -n file.sql | sed -n 11,16p",
         powershell="Get-Content file.sql | Select-Object -Skip 10 -First 6",
         count_re=r"^cat -n", notes="Without the line numbers. With numbers: "
                                    "`Select-String -Pattern '' file.sql | Select-Object -Skip 10 -First 6` (prints file:line:text).",
         test={"pwsh": "Get-Content data/orders.csv | Select-Object -Skip 10 -First 6", "zsh": "sed -n 11,16p data/orders.csv",
               "compare": "equal"}),
    dict(id="head", category="files", zsh="head -3 data/orders.csv", powershell="Get-Content data/orders.csv -TotalCount 3",
         count_re=r"^head ", test={"pwsh": "Get-Content data/orders.csv -TotalCount 3", "zsh": "head -3 data/orders.csv",
                                  "compare": "equal"}),
    dict(id="tail", category="files", zsh="tail -2 data/customers.csv", powershell="Get-Content data/customers.csv -Tail 2",
         count_re=r"^tail ", test={"pwsh": "Get-Content data/customers.csv -Tail 2", "zsh": "tail -2 data/customers.csv",
                                  "compare": "equal"}),
    dict(id="pipe-head-tail", category="files", zsh="grep \"Binder Error\" logs/dbt.log | tail -3",
         powershell='Select-String -CaseSensitive "Binder Error" logs/dbt.log | Select-Object -Last 3',
         count_re=r"\|\s*(head|tail) ", notes="`| head -N` -> `| Select-Object -First N`; `| tail -N` -> `| Select-Object -Last N`.",
         test={"pwsh": "Get-Content data/orders.csv | Select-Object -Last 2", "zsh": "cat data/orders.csv | tail -2",
               "compare": "equal"}),
    dict(id="sed-n", category="files", zsh="sed -n '1,8p' target/compiled/.../stg_jaffle_shop__orders.sql",
         powershell=r"Get-Content target\compiled\...\stg_jaffle_shop__orders.sql -TotalCount 8", count_re=r"^sed -n",
         notes="`sed -n 'A,Bp' f` -> `Get-Content f | Select-Object -Skip (A-1) -First (B-A+1)`.",
         test={"pwsh": "Get-Content data/orders.csv -TotalCount 8", "zsh": "sed -n '1,8p' data/orders.csv", "compare": "equal"}),
    dict(id="wc-l", category="files", zsh="wc -l data/*.csv",
         powershell='Get-ChildItem data\\*.csv | ForEach-Object { "{0,6} {1}" -f (Get-Content $_.FullName).Count, $_.Name }',
         count_re=r"\bwc -l", notes="`cmd | wc -l` -> `(cmd | Measure-Object).Count`. Counts are the same; the layout differs.",
         test={"pwsh": "(Get-Content data/orders.csv | Measure-Object).Count", "zsh": "wc -l < data/orders.csv | tr -d ' '",
               "compare": "equal"}),
    dict(id="grep", category="search", zsh='grep "coffee" data/products.csv',
         powershell='(Select-String -CaseSensitive "coffee" data/products.csv).Line', count_re=r"(^|\|\s*)grep ",
         notes="Select-String is case-INSENSITIVE by default (grep is case-sensitive): add -CaseSensitive. "
               "It prints file:line:text; `.Line` gives the bare lines. Patterns are regular expressions (like grep -E). "
               "Options: -c -> `(Select-String ...).Count`; -i -> no option (default); -n -> default output; "
               "-v -> -NotMatch; -o -> `| ForEach-Object { $_.Matches.Value }`; -m1 -> `| Select-Object -First 1`; "
               "-B4 -A8 -> `-Context 4,8`.",
         test={"pwsh": '(Select-String -CaseSensitive "coffee" data/products.csv).Line', "zsh": 'grep "coffee" data/products.csv',
               "compare": "equal"}),
    dict(id="grep-c", category="search", zsh='grep -c "placed" data/orders.csv',
         powershell='(Select-String -CaseSensitive "placed" data/orders.csv).Count', count_re=r"grep -i?c ",
         test={"pwsh": '(Select-String -CaseSensitive "placed" data/orders.csv).Count', "zsh": 'grep -c "placed" data/orders.csv',
               "compare": "equal"}),
    dict(id="grep-E-pipe", category="search", zsh="dbt debug | grep -E 'path:|Connection test|All checks'",
         powershell="dbt debug | Select-String -CaseSensitive 'path:|Connection test|All checks'", count_re=r"\| grep -E",
         test={"pwsh": "Get-Content logs/dbt.log | Select-String -CaseSensitive 'Binder Error|ROLLBACK' | ForEach-Object { $_.Line }",
               "zsh": "cat logs/dbt.log | grep -E 'Binder Error|ROLLBACK'", "compare": "equal"}),
    dict(id="grep-n-tail", category="search", zsh='grep -n "Binder Error" logs/dbt.log | tail -3',
         powershell='Select-String -CaseSensitive "Binder Error" logs/dbt.log | Select-Object -Last 3 | ForEach-Object { "$($_.LineNumber):$($_.Line)" }',
         count_re=r"grep -n", test={"pwsh": 'Select-String -CaseSensitive "Binder Error" logs/dbt.log | Select-Object -Last 3 | ForEach-Object { "$($_.LineNumber):$($_.Line)" }',
                                   "zsh": 'grep -n "Binder Error" logs/dbt.log | tail -3', "compare": "equal"}),
    dict(id="find", category="search", zsh="find target/compiled -path '*unit_tests*' -name '*.sql'",
         powershell=r"Get-ChildItem target\compiled -Recurse -Filter *.sql | Where-Object FullName -like '*unit_tests*' | ForEach-Object FullName",
         count_re=r"^find ", notes="`find jaffle_dbt | sort` -> `Get-ChildItem -Recurse -Name jaffle_dbt | Sort-Object` "
                                   "(Windows prints \\ in paths).",
         test={"pwsh": "Get-ChildItem tree -Recurse -Filter *.sql | Where-Object FullName -like '*unit_tests*' | ForEach-Object { $_.Name } | Sort-Object",
               "zsh": "find tree -path '*unit_tests*' -name '*.sql' -exec basename {} \\; | sort", "compare": "equal"}),
    dict(id="sort", category="search", zsh="sort", powershell="Sort-Object", count_re=r"\|\s*sort\b",
         test={"pwsh": "'b','a','c' | Sort-Object", "zsh": "printf 'b\\na\\nc\\n' | sort", "compare": "equal"}),
    dict(id="diff", category="search", zsh="diff models/marts/dim_customers.sql models/marts/dim_customers_v2.sql",
         powershell="git diff --no-index models/marts/dim_customers.sql models/marts/dim_customers_v2.sql",
         count_re=r"^diff ", notes="git diff --no-index works on any two files on every OS (unified format). "
                                   "PowerShell's own Compare-Object (Get-Content a) (Get-Content b) shows <= and => lines.",
         test={"pwsh": "git --no-pager diff --no-index --stat a.sql b.sql | Select-Object -Last 1",
               "zsh": "git --no-pager diff --no-index --stat a.sql b.sql | tail -1", "compare": "equal",
               "allow_rc": True}),
    dict(id="jq", category="search", zsh="dbt --quiet ls -s fct_orders --output json --output-keys config | jq -c '.config.grants'",
         powershell="dbt --quiet ls -s fct_orders --output json --output-keys config | ConvertFrom-Json | ForEach-Object { $_.config.grants | ConvertTo-Json -Compress }",
         count_re=r"\|\s*jq\b", notes="jq also exists for Windows (`winget install jqlang.jq`) and then the book's command works as it is.",
         test={"pwsh": "Get-Content lines.json | ConvertFrom-Json | ForEach-Object { $_.config.grants | ConvertTo-Json -Compress }",
               "expect": '{"select":["reporter"]}'},
         partial="ConvertFrom-Json form tested; jq on Windows untested (jq is not installed here)"),
    dict(id="echo-redirect", category="files", zsh='echo "first line" > notes.txt; echo "second line" >> notes.txt',
         powershell='Set-Content notes.txt "first line"; Add-Content notes.txt "second line"', count_re=r"(?<![0-9&])>{1,2}\s",
         notes="PowerShell also has > and >>, but in Windows PowerShell 5.1 they write UTF-16 text. Appending with >> to a "
               "UTF-8 file that dbt reads (for example `echo '-- comment' >> models/...sql` in Chapter 16) mixes two "
               "encodings and breaks the file: use Add-Content / Set-Content. `dbt --version > notes.txt` is harmless.",
         test={"pwsh": "Set-Content n.txt 'first line'; Add-Content n.txt 'second line'; Get-Content n.txt",
               "zsh": "echo 'first line' > n2.txt; echo 'second line' >> n2.txt; cat n2.txt", "compare": "equal"},
         partial="tested in pwsh 7.6 (UTF-8); the UTF-16 behaviour of > and >> in Windows PowerShell 5.1 is documented, not tested"),
    dict(id="code", category="tools", zsh="code .", powershell="code .", count_re=r"^code ",
         notes="Identical once VS Code is installed (`winget install Microsoft.VisualStudioCode`; the installer adds `code` to the PATH).",
         untested="VS Code is not installed on the test machine"),
    dict(id="man", category="tools", zsh="man ls", powershell="Get-Help Get-ChildItem", count_re=r"^man ",
         notes="For programs: `git help log`, `dbt ls --help`.", test={"pwsh": "(Get-Help Get-ChildItem).Name", "expect": "Get-ChildItem"}),
    # ---------------------------------------------------------------- duckdb
    dict(id="duckdb-redirect", category="duckdb", zsh="duckdb practice.duckdb < setup.sql",
         powershell='duckdb practice.duckdb -c ".read setup.sql"', count_re=r"^duckdb .*<",
         notes="PowerShell has no < redirection (`The '<' operator is reserved for future use.`). The -c \".read\" form "
               "also works on macOS. Without the DuckDB CLI: `python <kit>\\tools\\duck.py practice.duckdb -f setup.sql`. "
               "`duckdb -readonly db < file.sql` -> `duckdb -readonly db -c \".read file.sql\"`.",
         test={"pwsh": "duckdb practice.duckdb < setup.sql", "expect_error": "The '<' operator is reserved for future use."},
         partial="tested: the < form fails in pwsh exactly as described, and the duck.py alternative works (see duck-py); "
                 "the `duckdb -c \".read ...\"` form itself is untested here (no DuckDB CLI on the test machine; the CI "
                 "workflow kit-matrix.yml tests it on windows-latest)"),
    dict(id="duck-py", category="duckdb", zsh="duckdb practice.duckdb < updates/day2.sql",
         powershell=r"python ..\kit\tools\duck.py practice.duckdb -f updates\day2.sql", count_re=r"^duckdb \S+\.duckdb <",
         notes="Kit helper: same statements, run by the venv's DuckDB library (no CLI needed).",
         test={"pwsh": f"& '{VENV}/bin/python' '{ACADEMY}/converter/reference/kit/tools/duck.py' kit.duckdb -f '{LABS}/setup.sql' | Select-String 'stripe.payments'",
               "expect": "341"},
         setup_note="runs from the fixture folder; setup.sql reads data/*.csv relative to the current folder"),
    dict(id="duckdb-c", category="duckdb", zsh="duckdb -readonly ../practice/practice.duckdb -c \"select ...\"",
         powershell="duckdb -readonly ../practice/practice.duckdb -c \"select ...\"", count_re=r"^duckdb .* -c ",
         notes="Identical (SQL in double quotes, string literals in single quotes). Without the DuckDB CLI: "
               "`python <kit>\\tools\\duck.py --readonly ../practice/practice.duckdb \"select ...\"`.",
         test={"pwsh": f"& '{VENV}/bin/python' '{ACADEMY}/converter/reference/kit/tools/duck.py' --readonly fixture.duckdb \"select count(*) as n from t where x = 1\"",
               "expect": "1 |"},
         partial="duck.py form tested; the DuckDB CLI form is untested here (no DuckDB CLI on the test machine)"),
    dict(id="duckdb-interactive", category="duckdb", zsh="duckdb practice.duckdb", powershell="duckdb practice.duckdb",
         count_re=r"^duckdb \S+$", notes="Identical (D prompt, .tables, .quit). Without the CLI: `python <kit>\\tools\\duck.py practice.duckdb`.",
         untested="no DuckDB CLI on the test machine"),
    dict(id="duckdb-version", category="duckdb", zsh="duckdb --version", powershell="duckdb --version",
         count_re=r"^duckdb --version", untested="no DuckDB CLI on the test machine"),
    # ---------------------------------------------------------------- installers
    dict(id="brew-uv", category="install", zsh="brew install uv", powershell="winget install --id=astral-sh.uv -e",
         count_re=r"^brew install uv", notes="Without winget: `powershell -ExecutionPolicy ByPass -c \"irm https://astral.sh/uv/install.ps1 | iex\"`. "
                                             "Open a new PowerShell window afterwards.",
         untested="winget is Windows-only"),
    dict(id="brew-duckdb", category="install", zsh="brew install duckdb", powershell="winget install DuckDB.cli",
         count_re=r"^brew install duckdb", notes="Then align the venv: `uv pip install \"duckdb==X.Y.Z\"` with the CLI's number.",
         untested="winget is Windows-only"),
    dict(id="brew-version", category="install", zsh="brew --version", powershell="winget --version", count_re=r"^brew --version",
         untested="winget is Windows-only"),
    dict(id="brew-vscode", category="install", zsh="brew install --cask visual-studio-code",
         powershell="winget install Microsoft.VisualStudioCode", count_re=r"visual-studio-code", untested="winget is Windows-only"),
    dict(id="brew-python", category="install", zsh="brew install python@3.12",
         powershell="winget install --id Python.Python.3.12 -e", count_re=r"brew install python",
         untested="winget is Windows-only"),
    dict(id="tr", category="search", zsh="... | tr -d ' '", powershell="... | ForEach-Object { $_ -replace ' ', '' }",
         count_re=r"\|\s*tr ", test={"pwsh": "'  36 ' | ForEach-Object { $_ -replace ' ', '' }",
                                     "zsh": "echo '  36 ' | tr -d ' '", "compare": "equal"}),
    dict(id="ps-quoting", category="dbt", zsh="dbt ls -s test_type:generic,staging.stripe / dbt ls -s @int_orders__enriched",
         powershell='dbt ls -s "test_type:generic,staging.stripe" / dbt ls -s "@int_orders__enriched"',
         count_re=r"(^|\s)(@|[^\s\"']*,)[^\s\"']*", notes="Unquoted, PowerShell splits a,b into two arguments (dbt then "
         "builds a UNION instead of an intersection) and reads @name as splatting: quote such arguments (and { } ( )). "
         "The quoted form works in zsh too.",
         test={"pwsh": 'python3 -c "import sys; print(sys.argv[1:])" "test_type:generic,staging.stripe" "@int_orders__enriched"',
               "zsh": "python3 -c \"import sys; print(sys.argv[1:])\" test_type:generic,staging.stripe @int_orders__enriched",
               "compare": "equal"}),
    dict(id="git-install", category="install", zsh="xcode-select --install (Git comes with the command line tools)",
         powershell="winget install --id Git.Git -e", count_re=r"xcode-select",
         notes="Then once: `git config --global core.autocrlf true` (Windows line endings in files, LF in the repository).",
         untested="winget is Windows-only"),
    dict(id="gh", category="install", zsh="gh auth login", powershell="gh auth login", count_re=r"^gh |^brew install gh",
         notes="Install with `winget install GitHub.cli`; the commands are identical.", untested="gh is not installed on the test machine"),
    # ---------------------------------------------------------------- git
    dict(id="git", category="git", zsh="git status / git log --oneline --graph --all / git commit -m \"...\" / git switch -c ...",
         powershell="identical", count_re=r"^git ",
         notes="Every git command of the book is the same in PowerShell. Differences: use $HOME instead of ~ in paths "
               "(rule home-tilde); keep the double quotes around refspecs with * "
               "(`git fetch --no-tags reference \"refs/tags/*:refs/tags/ref-*\"`); git may print LF/CRLF warnings on "
               "Windows (harmless with core.autocrlf true).",
         test={"pwsh": "git -C repo log --oneline | Measure-Object | ForEach-Object Count",
               "zsh": "git -C repo log --oneline | wc -l | tr -d ' '", "compare": "equal"}),
    dict(id="git-apply", category="git", zsh="git apply ~/dbt-course/kit/bugs/01-jinja-missing-endif.patch",
         powershell=r"git apply $HOME\dbt-course\kit\bugs\01-jinja-missing-endif.patch", count_re=r"^git apply",
         notes="If it fails with 'patch does not apply' on a correct file, the file has CRLF line endings and "
               "core.autocrlf is false: add --ignore-whitespace (also for -R). Tested with git 2.50 on CRLF copies of the "
               "files: plain apply works with core.autocrlf=true, --ignore-whitespace works with core.autocrlf=false.",
         test={"pwsh": f"git -C repo apply --check '{LABS}/practice-project/bugs/01-jinja-missing-endif.patch'; \"exit $LASTEXITCODE\"",
               "expect": "exit 0"}),
    dict(id="glob-quotes", category="dbt", zsh='dbt ls -s "stg_jaffle_shop__*"', powershell='dbt ls -s "stg_jaffle_shop__*"',
         count_re=r"\*", notes="zsh fails on an unquoted * (`no matches found`); PowerShell passes it to dbt unchanged, but "
                               "keep the quotes: the same command then works everywhere.",
         test={"pwsh": 'python3 -c "import sys; print(sys.argv[1])" "stg_jaffle_shop__*"',
               "zsh": 'python3 -c "import sys; print(sys.argv[1])" "stg_jaffle_shop__*"', "compare": "equal"}),
    dict(id="json-arg", category="dbt", zsh="dbt ls -s x --warn-error-options '{\"error\": [\"NoNodesForSelectionCriteria\"]}'",
         powershell="dbt ls -s x --warn-error-options '{\\\"error\\\": [\\\"NoNodesForSelectionCriteria\\\"]}'  (Windows PowerShell 5.1)  /  same as zsh (PowerShell 7.3+)",
         count_re=r"'\{\"", notes="Windows PowerShell 5.1 removes the double quotes inside a single-quoted argument passed to "
                                   "a program, so dbt receives invalid JSON: escape them as \\\" there. PowerShell 7.3+ "
                                   "passes them correctly. Alternative on every shell: the YAML form `--warn-error-options "
                                   "\"{error: [NoNodesForSelectionCriteria]}\"` (checked with dbt 1.11.16 on macOS: "
                                   "same Compilation Error as the JSON form).",
         test={"pwsh": "python3 -c \"import sys; print(sys.argv[1])\" '{\"error\": [\"NoNodesForSelectionCriteria\"]}'",
               "zsh": "python3 -c \"import sys; print(sys.argv[1])\" '{\"error\": [\"NoNodesForSelectionCriteria\"]}'",
               "compare": "equal"},
         partial="pwsh 7.6 passes the JSON unchanged (tested); the Windows PowerShell 5.1 quote stripping is documented, not tested"),
]


# ---------------------------------------------------------------------------------------------------- fixtures
LOG = """2026-10-21 21:00:01 START model
2026-10-21 21:00:02 Binder Error: Referenced column "emial" not found
2026-10-21 21:00:03 ROLLBACK
2026-10-21 21:00:04 binder error lower case
2026-10-21 21:00:05 Binder Error: second one
2026-10-21 21:00:06 analyze "practice"."dbt_adnane"."fct_orders"
2026-10-21 21:00:07 Binder Error: third one
2026-10-21 21:00:08 Binder Error: fourth one
"""


def make_fixture(d: Path) -> None:
    shutil.copytree(LABS / "data", d / "data")
    shutil.copy(LABS / "setup.sql", d / "setup.sql")
    (d / "logs").mkdir()
    (d / "logs" / "dbt.log").write_text(LOG)
    (d / ".hidden").write_text("x\n")
    (d / "lines.json").write_text('{"name": "fct_orders", "config": {"grants": {"select": ["reporter"]}}}\n')
    (d / "a.sql").write_text("select 1 as a\nfrom x\n")
    (d / "b.sql").write_text("select 1 as a,\n  2 as b\nfrom x\n")
    for p in ("tree/target/compiled/unit_tests/x/t1.sql", "tree/target/compiled/unit_tests/x/t2.sql",
              "tree/target/compiled/models/m.sql"):
        (d / p).parent.mkdir(parents=True, exist_ok=True)
        (d / p).write_text("select 1\n")
    # a clone of the reference project at ch21 (for the git rules)
    subprocess.run(["git", "clone", "-q", str(T.BIBLE / "labs" / "practice-project" / "jaffle_dbt"), str(d / "repo")],
                   check=True)
    subprocess.run(["git", "-C", str(d / "repo"), "checkout", "-q", "ch21"], check=True)
    import duckdb  # the verification venv's library
    con = duckdb.connect(str(d / "fixture.duckdb"))
    con.execute("create table t as select 1 as x")
    con.close()


def norm(s: str) -> str:
    s = re.sub(r"\x1b\[[0-9;]*m", "", s.replace("\r\n", "\n"))
    return "\n".join(l.rstrip() for l in s.strip().split("\n"))


def run_pwsh(cmd: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["pwsh", "-NoProfile", "-NonInteractive", "-Command", cmd], cwd=cwd, capture_output=True,
                          text=True, env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"}, timeout=120)


def run_zsh(cmd: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["zsh", "-f", "-c", cmd], cwd=cwd, capture_output=True, text=True, timeout=120)


def run_test(rule: dict, fx: Path, version: str) -> str:
    t = rule.get("test")
    if not t:
        return "untested: " + rule.get("untested", "no test")
    r = run_pwsh(t["pwsh"], fx)
    out = norm(r.stdout)
    err = norm(r.stderr)
    prefix = f"pwsh {version} on macOS"
    if "expect_error" in t:
        ok = t["expect_error"] in (err + "\n" + out)
        res = f"{prefix}: fails as expected ({t['expect_error']})" if ok else f"FAILED: {prefix}: error not seen: {err[:200]}"
    elif "zsh" in t:
        z = run_zsh(t["zsh"], fx)
        ok = (r.returncode == 0 or t.get("allow_rc")) and out == norm(z.stdout) and out != ""
        res = (f"{prefix}: output equals zsh output ({len(out.splitlines())} line(s))" if ok
               else f"FAILED: {prefix}: pwsh={out[:200]!r} err={err[:200]!r} zsh={norm(z.stdout)[:200]!r}")
    else:
        ok = t["expect"] in out
        res = f"{prefix}: output contains {t['expect']!r}" if ok else f"FAILED: {prefix}: {out[:200]!r} {err[:200]!r}"
    if ok and rule.get("partial"):
        res += "; partly untested: " + rule["partial"]
    return res


def book_lines() -> list[str]:
    return [t["command"] for t in T.all_book()]


def machine_sections() -> dict:
    """The transforms of os_transforms.py, as written into the YAML (without the examples)."""
    ids = {r["id"] for r in RULES} | {"line-override"}
    out = {}
    for key, items in (("transforms", OT.TRANSFORMS), ("pipe_transforms", OT.PIPE_TRANSFORMS),
                       ("wsl_transforms", OT.WSL_TRANSFORMS), ("lines", OT.LINES), ("blocks", OT.BLOCKS)):
        rows = []
        for t in items:
            if t["rule"] not in ids:
                raise SystemExit(f"{key}: rule {t['rule']!r} is not a rule id of os_commands.RULES")
            rows.append({k: v for k, v in t.items() if k != "examples"})
        out[key] = rows
    return out


def transforms_only() -> int:
    """Rewrite only the machine sections of the existing YAML (no pwsh tests)."""
    doc = yaml.safe_load(OUT.read_text())
    doc.update(machine_sections())
    text = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=120)
    if OUT.read_text() != text:
        OUT.write_text(text)
    print(f"{OUT}: machine sections updated")
    return 0


def main() -> int:
    if "--transforms-only" in sys.argv:
        return transforms_only()
    if not shutil.which("pwsh") or not shutil.which("zsh"):
        print("pwsh and zsh are needed", file=sys.stderr)
        return 1
    version = run_pwsh("$PSVersionTable.PSVersion.ToString()", Path.cwd()).stdout.strip()
    lines = book_lines()
    # scan section (same logic as scan_shell_commands.py)
    with tempfile.TemporaryDirectory() as td:
        scan_json = Path(td) / "scan.json"
        subprocess.run([sys.executable, "-I", str(Path(__file__).parent / "scan_shell_commands.py"), "--json", str(scan_json)],
                       check=True, capture_output=True)
        import json
        scan = json.loads(scan_json.read_text())
    results = []
    failures = 0
    with tempfile.TemporaryDirectory() as td:
        fx = Path(td)
        make_fixture(fx)
        for rule in RULES:
            cnt = sum(1 for l in lines if re.search(rule["count_re"], l))
            status = run_test(rule, fx, version)
            if status.startswith("FAILED"):
                failures += 1
            entry = {
                "id": rule["id"],
                "category": rule["category"],
                "zsh": rule["zsh"],
                "powershell": rule["powershell"],
                "wsl": rule.get("wsl", "same as macOS/zsh (bash in Ubuntu)"),
                "book_lines": cnt,
                "tested": status,
            }
            if rule.get("notes"):
                entry["notes"] = rule["notes"]
            results.append(entry)
            print(f"{rule['id']:<22} {cnt:4d}  {status[:110]}")
    covered = Counter()
    for l in lines:
        for rule in RULES:
            if re.search(rule["count_re"], l):
                covered[l] += 1
    uncovered = sorted({l for l in lines if not covered[l] and not l.startswith("dbt ")
                        and not re.match(r"^(\(\.venv\) )?dbt\b", l)})
    doc = {
        "schema": 1,
        "description": "macOS/zsh -> Windows PowerShell rules for the shell commands of the book's bashcode blocks "
                       "(generated by converter/reference/os_commands.py; edit the RULES there, then re-run). "
                       "dbt commands themselves are identical on every OS. WSL (Ubuntu) users follow the macOS/zsh "
                       "commands (apt or the official installers instead of Homebrew).",
        "tested_with": f"pwsh {version} (Homebrew, macOS) and zsh in a fixture folder; Windows PowerShell 5.1 and "
                       "Windows itself: untested (see converter/reference/ci/kit-matrix.yml)",
        "summary": {
            "rules": len(results),
            "tested_ok": sum(1 for r in results if r["tested"].startswith("pwsh") and "partly untested" not in r["tested"]),
            "tested_partly": sum(1 for r in results if "partly untested" in r["tested"]),
            "untested": sum(1 for r in results if r["tested"].startswith("untested")),
            "failed": failures,
        },
        "rules": results,
        **machine_sections(),
        "scan": {
            "source": scan["source"],
            "command_lines": scan["command_lines"],
            "non_dbt_commands": scan["commands"],
            "subcommands": scan["subcommands"],
            "shell_features": scan["features"],
            "non_dbt_lines_not_covered_by_a_rule": uncovered,
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=120)
    if not OUT.exists() or OUT.read_text() != text:
        OUT.write_text(text)
    print(f"{OUT}: {len(results)} rules, failed={failures}, uncovered lines={len(uncovered)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
