"""Machine rules for the Windows / WSL variants of the book's shell blocks (written into os-commands.yaml by
os_commands.py; applied by converter/build/oscmd.py).

transforms       one simple command of a line (after splitting on && ; |), regex fullmatch -> PowerShell
pipe_transforms  a pipeline stage after `|`
wsl_transforms   a whole command line whose WSL (Ubuntu bash) form differs from macOS (installers)
lines            exact book command lines (block id + text after the path rules) with a hand-written form

Templates: {{name}} = the group, {{path:name}} = the path in Windows form (~/ -> $HOME\\, / -> \\),
{{paths:name}} = several paths (comma list), {{args:name}} = program arguments quoted for PowerShell.
`fn` = a function of converter/build/oscmd.py (fn_<name>). `examples` are unit-tested (tests/test_oscmd.py).
"""

TRANSFORMS = [
    # ------------------------------------------------------------- variables
    dict(rule="env-prefix", fn="env_prefix",
         match=r"(?P<assigns>(?:[A-Za-z_][A-Za-z0-9_]*=(?:\"[^\"]*\"|'[^']*'|\S*)\s+)+)(?P<rest>\S.*)",
         examples=[["DBT_TARGET=prod dbt compile", '$env:DBT_TARGET = "prod"; dbt compile; Remove-Item Env:DBT_TARGET'],
                   ["DBT_ENGINE_DEFER=true DBT_ENGINE_STATE=prod-artifacts dbt compile -s x",
                    '$env:DBT_ENGINE_DEFER = "true"; $env:DBT_ENGINE_STATE = "prod-artifacts"; dbt compile -s x; '
                    'Remove-Item Env:DBT_ENGINE_DEFER, Env:DBT_ENGINE_STATE']]),
    dict(rule="shell-var", fn="assign", match=r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)=(?P<value>\S*)",
         examples=[["B=~/dbt-course/kit/bugs", '$B = "$HOME\\dbt-course\\kit\\bugs"']]),
    dict(rule="export", fn="export", match=r"export (?P<assigns>[A-Za-z_].*)",
         examples=[['export DBT_DEMO_SECRET="abc123"', '$env:DBT_DEMO_SECRET = "abc123"'],
                   ["export DBT_PROFILES_DIR=$PWD/ci", '$env:DBT_PROFILES_DIR = "$PWD\\ci"']]),
    dict(rule="unset", match=r"unset (?P<name>[A-Za-z_]\w*)", win="Remove-Item Env:{{name}}",
         examples=[["unset DBT_DUCKDB_PATH", "Remove-Item Env:DBT_DUCKDB_PATH"]]),
    dict(rule="comment", match=r"echo 'setopt interactivecomments' >> ~/\.zshrc",
         win="# nothing to do on Windows: PowerShell always accepts # comments"),
    dict(rule="echo-var", match=r"echo \$SHELL", win="echo $PSVersionTable.PSVersion   # PowerShell has no $SHELL"),
    dict(rule="echo", fn="echo", match=r"echo(?P<text>(?: [^<>|]*)?)",
         examples=[['echo "Hello dbt"', 'echo "Hello dbt"'], ["echo $?", "echo $LASTEXITCODE"],
                   ['echo "exit code: $?"', 'echo "exit code: $LASTEXITCODE"']]),
    # ------------------------------------------------------------- python environment
    dict(rule="venv-activate", fn="source", match=r"source (?P<venv>\S+)/bin/activate",
         examples=[["source .venv/bin/activate", ".venv\\Scripts\\Activate.ps1"],
                   ["source ../.venv/bin/activate", "..\\.venv\\Scripts\\Activate.ps1"],
                   ["source ~/dbt-course/.venv/bin/activate", "& $HOME\\dbt-course\\.venv\\Scripts\\Activate.ps1"]]),
    dict(rule="python-venv-classic", match=r"python3\.12 -m venv (?P<p>\S+)", win="py -3.12 -m venv {{p}}"),
    dict(rule="which", match=r"which python3", win="(Get-Command python).Source   # Windows: python, not python3"),
    dict(rule="which", match=r"which (?P<c>\S+)", win="(Get-Command {{c}}).Source",
         examples=[["which git", "(Get-Command git).Source"]]),
    # ------------------------------------------------------------- files and folders
    dict(rule="cd", match=r"cd", win="cd $HOME"),
    dict(rule="cd", match=r"cd (?P<p>\S+)", win="cd {{path:p}}",
         examples=[["cd ~/dbt-course/practice", "cd $HOME\\dbt-course\\practice"], ["cd ..", "cd .."]]),
    dict(rule="ls-la", match=r"ls -la?", win="Get-ChildItem -Force"),
    dict(rule="ls-la", match=r"ls -la? (?P<p>.+)", win="Get-ChildItem -Force {{paths:p}}"),
    dict(rule="ls", match=r"ls", win="Get-ChildItem -Name"),
    dict(rule="ls", match=r"ls (?P<p>[^-].*)", win="Get-ChildItem -Name {{paths:p}}",
         examples=[["ls data", "Get-ChildItem -Name data"], ["ls ci/raw ci/raw/data", "Get-ChildItem -Name ci\\raw, ci\\raw\\data"]]),
    dict(rule="mkdir-p", match=r"mkdir -p (?P<p>.+)", win="New-Item -ItemType Directory -Force {{paths:p}}",
         examples=[["mkdir -p ~/dbt-course/practice", "New-Item -ItemType Directory -Force $HOME\\dbt-course\\practice"],
                   ["mkdir -p .github/workflows ci/raw/data",
                    "New-Item -ItemType Directory -Force .github\\workflows, ci\\raw\\data"]]),
    dict(rule="mkdir-p", match=r"mkdir (?P<p>[^-].*)", win="New-Item -ItemType Directory {{paths:p}}"),
    dict(rule="cp-R", match=r"cp -[rR] (?P<src>.+) (?P<dst>\S+)", win="Copy-Item -Recurse {{paths:src}} {{path:dst}}",
         examples=[["cp -R ~/dbt-course/kit/data ~/dbt-course/practice/",
                    "Copy-Item -Recurse $HOME\\dbt-course\\kit\\data $HOME\\dbt-course\\practice\\"]]),
    dict(rule="cp", match=r"cp (?P<src>[^-].*) (?P<dst>\S+)", win="Copy-Item {{paths:src}} {{path:dst}}",
         examples=[["cp ~/dbt-course/kit/data/*.csv ci/raw/data/", "Copy-Item $HOME\\dbt-course\\kit\\data\\*.csv ci\\raw\\data\\"]]),
    dict(rule="tmp", match=r"mv (?P<src>\S+) /tmp/", win="Move-Item {{path:src}} $env:TEMP\\"),
    dict(rule="tmp", match=r"mv /tmp/(?P<f>\S+) (?P<dst>\S+)", win="Move-Item $env:TEMP\\{{f}} {{path:dst}}"),
    dict(rule="mv", match=r"mv (?P<src>\S+) (?P<dst>\S+)", win="Move-Item {{path:src}} {{path:dst}}"),
    dict(rule="rm-r", match=r"rm -(?:rf|fr|r|R) (?P<p>.+)", win="Remove-Item -Recurse -Force {{paths:p}}",
         examples=[["rm -r models/example", "Remove-Item -Recurse -Force models\\example"]]),
    dict(rule="rm", match=r"rm (?P<p>[^-].*)", win="Remove-Item {{paths:p}}"),
    dict(rule="cat-n-sed", match=r"cat -n (?P<p>\S+)", win="Get-Content {{path:p}}"),
    dict(rule="cat", match=r"cat (?P<p>[^-].*)", win="Get-Content {{paths:p}}"),
    dict(rule="head", match=r"head -(?P<n>\d+) (?P<p>\S+)", win="Get-Content {{path:p}} -TotalCount {{n}}",
         examples=[["head -3 data/orders.csv", "Get-Content data\\orders.csv -TotalCount 3"]]),
    dict(rule="tail", match=r"tail -(?P<n>\d+) (?P<p>.+)", win="Get-Content {{paths:p}} -Tail {{n}}"),
    dict(rule="wc-l", match=r"wc -l (?P<p>.+)",
         win='Get-ChildItem {{paths:p}} | ForEach-Object { "{0,7} {1}" -f (Get-Content $_.FullName).Count, $_.Name }'),
    dict(rule="grep", fn="grep",
         match=r"grep (?P<opts>(?:-[A-Za-z0-9]+ )*)(?P<pat>\"[^\"]*\"|'[^']*'|[^\s-]\S*) (?P<files>.+)",
         examples=[['grep -c "placed" data/orders.csv', "(Select-String -CaseSensitive 'placed' data\\orders.csv).Count"],
                   ['grep "coffee" data/products.csv',
                    "Select-String -CaseSensitive 'coffee' data\\products.csv | ForEach-Object Line"]]),
    dict(rule="sed-n", fn="sed", match=r"sed -n '?(?P<a>\d+),(?P<b>\d+)p'? (?P<file>\S+)",
         examples=[["sed -n '1,8p' a/b.sql", "Get-Content a\\b.sql | Select-Object -First 8"]]),
    dict(rule="find", match=r"find (?P<p>\S+) -path '(?P<pp>[^']+)' -name '(?P<n>[^']+)'",
         win="Get-ChildItem {{path:p}} -Recurse -Filter {{n}} | Where-Object FullName -like '{{pp}}' | ForEach-Object FullName"),
    dict(rule="find", match=r"find (?P<p>\S+)", win="Get-ChildItem -Recurse -Name {{path:p}}"),
    dict(rule="diff", match=r"diff (?P<a>\S+) (?P<b>\S+)", win="git diff --no-index {{a}} {{b}}"),
    dict(rule="man", match=r"man ls", win="Get-Help Get-ChildItem"),
    dict(rule="man", match=r"man (?P<c>\S+)", win="Get-Help {{c}}"),
    # ------------------------------------------------------------- installers
    dict(rule="brew-version", match=r"brew --version", win="winget --version"),
    dict(rule="brew-uv", match=r"brew install uv", win="winget install --id=astral-sh.uv -e"),
    dict(rule="brew-duckdb", match=r"brew install duckdb", win="winget install DuckDB.cli"),
    dict(rule="gh", match=r"brew install gh", win="winget install --id GitHub.cli -e"),
    dict(rule="brew-vscode", match=r"brew install --cask visual-studio-code", win="winget install --id Microsoft.VisualStudioCode -e"),
    dict(rule="brew-python", match=r"brew install python@3\.12", win="winget install --id Python.Python.3.12 -e"),
    dict(rule="git-install", match=r"xcode-select --install", win="winget install --id Git.Git -e"),
]

PIPE_TRANSFORMS = [
    dict(rule="pipe-head-tail", match=r"head -(?P<n>\d+)", win="Select-Object -First {{n}}"),
    dict(rule="pipe-head-tail", match=r"tail -(?P<n>\d+)", win="Select-Object -Last {{n}}"),
    dict(rule="wc-l", match=r"wc -l", win="Measure-Object | ForEach-Object Count"),
    dict(rule="sort", match=r"sort", win="Sort-Object"),
    dict(rule="grep", fn="grep_pipe", match=r"grep (?P<opts>(?:-[A-Za-z0-9]+ )*)(?P<pat>\"[^\"]*\"|'[^']*'|[^\s-]\S*)",
         examples=[["grep -E 'path:|Connection test'", "Select-String -CaseSensitive 'path:|Connection test' | ForEach-Object Line"]]),
    dict(rule="sed-n", fn="sed", match=r"sed -n '?(?P<a>\d+),(?P<b>\d+)p'?"),
    dict(rule="tr", match=r"tr -d ' '", win="ForEach-Object { $_ -replace ' ', '' }"),
]

WSL_TRANSFORMS = [
    dict(rule="brew-uv", match=r"brew install uv\s*(#.*)?", wsl="curl -LsSf https://astral.sh/uv/install.sh | sh   # then open a new terminal"),
    dict(rule="brew-duckdb", match=r"brew install duckdb\s*(#.*)?", wsl="curl https://install.duckdb.org | sh   # the DuckDB CLI (or download it from duckdb.org)"),
    dict(rule="brew-version", match=r"brew --version\s*(#.*)?", wsl="apt --version   # Ubuntu's package manager (no Homebrew needed)"),
    dict(rule="gh", match=r"brew install gh\s*(#.*)?", wsl="sudo apt install gh"),
    dict(rule="brew-vscode", match=r"brew install --cask visual-studio-code\s*(#.*)?",
         wsl="# install VS Code on Windows (with its WSL extension); then `code .` works in Ubuntu"),
    dict(rule="brew-python", match=r"brew install python@3\.12\s*(#.*)?", wsl="sudo apt install python3.12 python3.12-venv"),
    dict(rule="git-install", match=r"xcode-select --install\s*(#.*)?", wsl="sudo apt install git"),
    dict(rule="comment", match=r"echo 'setopt interactivecomments' >> ~/\.zshrc\s*(#.*)?",
         wsl="# nothing to do: bash (WSL) accepts # comments by default"),
]

# exact lines (block id, book command after the path rules) -> hand-written PowerShell, with the reason
LINES = [
    dict(block="ch10-c51", rule="jq",
         book="dbt --quiet ls -s fct_orders --output json --output-keys config | jq -c '.config | {grants, hooks: [.[\"post-hook\"][].sql]}'",
         win="dbt --quiet ls -s fct_orders --output json --output-keys config | ConvertFrom-Json | "
             "ForEach-Object { [ordered]@{grants = $_.config.grants; hooks = @($_.config.'post-hook'.sql)} | ConvertTo-Json -Compress }",
         why="the jq program contains double quotes, which Windows PowerShell 5.1 removes when it calls jq"),
    dict(block="ch02-c14", rule="and-chain", book='dbt build && echo "All good, ready to deploy"',
         win='dbt build; if ($?) { echo "All good, ready to deploy" }   # PowerShell 7 also accepts &&',
         why="the block teaches that && runs the second command only on success: keep that meaning in PowerShell 5.1"),
    dict(block="ch02-c2", rule="cd", book="cd -                     # go back to the previous folder",
         win="cd -                     # go back to the previous folder (PowerShell 7; not in Windows PowerShell 5.1)",
         why="Set-Location - exists only from PowerShell 6.2"),
    dict(block="ch11-c80", rule="json-arg",
         book="dbt show --inline \"{{ dbt_utils.date_spine(datepart='month', start_date=\\\"cast('2025-01-01' as date)\\\", "
              "end_date=\\\"cast('2025-05-01' as date)\\\") }}\"",
         win="dbt show --inline \"{{ dbt_utils.date_spine(datepart='month', start_date=`\"cast('2025-01-01' as date)`\", "
             "end_date=`\"cast('2025-05-01' as date)`\") }}\"   # needs PowerShell 7 (5.1 drops the inner quotes)",
         why="an argument with inner double quotes reaches dbt intact only from PowerShell 7.3"),
]

# whole blocks whose kept macOS output would mislead on Windows (sha1 = first 12 hex of the book text after the
# path rules; the build fails when the book block changes)
BLOCKS = [
    dict(block="ch02-c13", rule="exit-code", sha1="513d7300c042",
         win="PS> Get-ChildItem -Name data\ncustomers.csv\norder_items.csv\norders.csv\npayments.csv\nproducts.csv\n"
             "PS> $?\nTrue\nPS> Get-ChildItem -Name nofolder\n"
             "Get-ChildItem: Cannot find path 'C:\\Users\\you\\dbt-course\\practice\\nofolder' because it does not exist.\n"
             "PS> $?\nFalse\n"
             "PS> dbt --version > $null; $LASTEXITCODE     # programs (dbt, git, python) put their number in $LASTEXITCODE\n0",
         why="PowerShell: $? is True/False for the last command; the exit code of a program is $LASTEXITCODE "
             "(Get-ChildItem is not a program and sets no exit code)"),
]
