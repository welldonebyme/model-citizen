import importlib.util

import pytest

from converter.build.oscmd import Ctx, OsCommands
from converter.config import ACADEMY, OVERRIDES

ENG = OsCommands(OVERRIDES / "os-commands.yaml")
_spec = importlib.util.spec_from_file_location("os_transforms", ACADEMY / "converter/reference/os_transforms.py")
OT = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OT)

EXAMPLES = [tuple(e) for t in OT.TRANSFORMS + OT.PIPE_TRANSFORMS for e in t.get("examples", [])]


def win(text, block="x"):
    w, wsl, log = ENG.block(text, block, Ctx())
    return w, wsl, log


@pytest.mark.parametrize("book,ps", [e for e in EXAMPLES if not e[0].startswith("grep -E")])
def test_transform_examples(book, ps):
    assert ENG.command(book, Ctx()) == ps


def test_pipe_example():
    assert ENG.pipe("grep -E 'path:|Connection test'", Ctx()) == \
        "Select-String -CaseSensitive 'path:|Connection test' | ForEach-Object Line"


def test_the_yaml_is_up_to_date_with_os_transforms():
    for key, items in (("transforms", OT.TRANSFORMS), ("pipe_transforms", OT.PIPE_TRANSFORMS),
                       ("wsl_transforms", OT.WSL_TRANSFORMS), ("lines", OT.LINES), ("blocks", OT.BLOCKS)):
        assert ENG.data[key] == [{k: v for k, v in t.items() if k != "examples"} for t in items], key


def test_prompt_outputs_and_dbt_only_blocks():
    w, wsl, _ = win("$ cd ~/dbt-course\n$ ls\nnotes.txt  practice\n(.venv) $ dbt build")
    assert w == "PS> cd $HOME\\dbt-course\nPS> Get-ChildItem -Name\nnotes.txt  practice\n(.venv) PS> dbt build"
    assert wsl is None
    assert win("$ dbt build\n...\nDone. PASS=17\n$ dbt ls -s +fct_orders")[0] is None   # same on every OS


def test_and_chain_becomes_two_lines_and_semicolon_stays():
    w, _, _ = win("$ cd ~/dbt-course && source .venv/bin/activate\n$ dbt build -q; echo \"exit code: $?\"")
    assert w.split("\n") == ["PS> cd $HOME\\dbt-course", "PS> .venv\\Scripts\\Activate.ps1",
                             'PS> dbt build -q; echo "exit code: $LASTEXITCODE"']


def test_powershell_quoting_of_dbt_arguments():
    w, _, _ = win("$ dbt -q ls -s test_type:generic,staging.stripe\n$ dbt ls -s @int_orders__enriched --resource-type model")
    assert w.split("\n") == ['PS> dbt -q ls -s "test_type:generic,staging.stripe"',
                             'PS> dbt ls -s "@int_orders__enriched" --resource-type model']


def test_env_prefix_wraps_the_whole_pipeline():
    w, _, _ = win("$ DBT_DUCKDB_PATH=../p/x.duckdb dbt debug | grep -E 'path:'")
    assert w == ('PS> $env:DBT_DUCKDB_PATH = "../p/x.duckdb"; dbt debug | Select-String -CaseSensitive \'path:\' | '
                 'ForEach-Object Line; Remove-Item Env:DBT_DUCKDB_PATH')


def test_shell_variables_stay_variables():
    w, _, _ = win("$ B=~/dbt-course/kit/bugs\n$ git apply $B/03-x.patch\n$ export X=1\n$ echo $X $B")
    assert w.split("\n") == ['PS> $B = "$HOME\\dbt-course\\kit\\bugs"', "PS> git apply $B/03-x.patch",
                             'PS> $env:X = "1"', "PS> echo $env:X $B"]


def test_redirections():
    assert ENG.command("duckdb practice.duckdb < updates/day2.sql", Ctx()) == \
        'duckdb practice.duckdb -c ".read updates/day2.sql"'
    assert ENG.command("dbt --version > notes.txt", Ctx()) == "dbt --version | Set-Content notes.txt"
    assert ENG.command("echo '-- c' >> models/x.sql", Ctx()) == "Add-Content models\\x.sql '-- c'"


def test_continuation_lines_are_joined():
    w, _, _ = win("$ dbt show -s accepted_values_x__\\\nplaced__shipped --limit 3")
    assert w == "PS> dbt show -s accepted_values_x__placed__shipped --limit 3"


def test_wsl_only_where_it_differs():
    w, wsl, _ = win("$ brew install uv\n$ dbt --version")
    assert wsl.startswith("$ curl -LsSf https://astral.sh/uv/install.sh | sh")
    assert "winget install --id=astral-sh.uv -e" in w


def test_unknown_command_is_reported():
    ctx = Ctx()
    ENG.block("$ frobnicate --all", "x", ctx)
    assert ctx.unhandled == ["frobnicate --all"]


def test_block_override_is_hash_protected():
    with pytest.raises(ValueError, match="changed in the book"):
        ENG.block("$ ls data\nchanged", "ch02-c13", Ctx())
