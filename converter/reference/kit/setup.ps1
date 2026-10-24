<#
============================================================================
 Model Citizen - practice kit setup for Windows (PowerShell 5.1 or 7)

   powershell -ExecutionPolicy Bypass -File .\setup.ps1
   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -InstallTools     # also installs uv and Git with winget

 Options:
   -CourseDir C:\some\folder   another course folder (default: $HOME\dbt-course)
   -DuckDBVersion 1.5.6        DuckDB version for the venv (must equal your DuckDB CLI: duckdb --version)
   -RebuildDb                  rebuild practice.duckdb even if it exists (= reset the raw data to day 1)
   -InstallTools               install missing uv / Git with winget (Windows only; winget asks you to accept
                               its terms the first time)

 What it does (Chapter 2 of the book, plus the reference project):
   $HOME\dbt-course\.venv          Python 3.12 + dbt-core 1.11.x + dbt-duckdb 1.11.x + duckdb (pinned)
   $HOME\dbt-course\practice\      data\ setup.sql updates\ practice.duckdb      <- YOUR database
   $HOME\dbt-course\kit\           the whole kit (= the book's labs folder): data\ setup.sql updates\ bugs\
                                   jaffle_dbt.bundle tools\ profiles\ check\ READMEs
   $HOME\dbt-course\reference\     jaffle_dbt\ (clone of the bundle) + its own practice\ database
 and finally runs `dbt debug`. "-ExecutionPolicy Bypass" applies to this one command only.
============================================================================
#>
[CmdletBinding()]
param(
    [string]$CourseDir = (Join-Path $HOME 'dbt-course'),
    [string]$DuckDBVersion = '1.5.6',
    [switch]$RebuildDb,
    [switch]$InstallTools
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
# absolute path (a relative -CourseDir is read from the current folder)
$CourseDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CourseDir)

$KitDir = $PSScriptRoot
$PyVersion = '3.12'
$DbtCoreSpec = 'dbt-core~=1.11.0'
$DbtDuckdbSpec = 'dbt-duckdb~=1.11.0'

# Windows PowerShell 5.1 is always Windows ($IsWindows does not exist there); PowerShell 7 has $IsWindows.
$OnWindows = $true
if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { $OnWindows = $false }

function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Ok([string]$Text)   { Write-Host "    OK  $Text" -ForegroundColor Green }
function Info([string]$Text) { Write-Host "    ..  $Text" }
function Warn([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }
function Fail([string]$Text) { Write-Host ''; Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }

# Run a program, show its output, stop on a non-zero exit code.
# (Native programs such as uv and git write progress to stderr; that is not an error.)
function Invoke-Native {
    param([Parameter(Mandatory = $true)][string]$Exe, [string[]]$Arguments = @(), [string]$What = '')
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
    if ($code -ne 0) {
        if ($What -eq '') { $What = "$Exe $($Arguments -join ' ')" }
        throw "$What failed (exit code $code)"
    }
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-SessionPath {
    if (-not $OnWindows) { return }
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user;$HOME\.local\bin"
}

# Copy every file of a folder that is missing at the destination (never overwrites your changes).
function Copy-Missing([string]$Source, [string]$Destination) {
    if (-not (Test-Path $Destination)) { New-Item -ItemType Directory -Force -Path $Destination | Out-Null }
    $srcFull = (Resolve-Path $Source).Path
    Get-ChildItem -Path $srcFull -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($srcFull.Length).TrimStart('\', '/')
        $target = Join-Path $Destination $relative
        if (-not (Test-Path $target)) {
            $parent = Split-Path $target -Parent
            if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            Copy-Item -LiteralPath $_.FullName -Destination $target
        }
    }
}

try {
    Step "Kit folder: $KitDir"
    $required = @('setup.sql', 'data\customers.csv', 'updates\day2.sql', 'bugs\README.md', 'jaffle_dbt.bundle',
                  'tools\duck.py', 'check\dbt_project.yml', 'profiles\profiles.yml')
    foreach ($f in $required) {
        $p = Join-Path $KitDir ($f -replace '\\', [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path $p)) { Fail "the kit is incomplete: $f is missing. Unzip the whole dbt-course-kit.zip again." }
    }
    Ok "kit complete (PowerShell $($PSVersionTable.PSVersion), Windows: $OnWindows)"

    # ------------------------------------------------------------ 1. tools
    Step 'Checking the tools (uv, git, duckdb)'
    if (-not (Test-Command 'uv')) {
        if ($InstallTools -and $OnWindows -and (Test-Command 'winget')) {
            Info 'installing uv with winget: winget install --id=astral-sh.uv -e'
            Invoke-Native -Exe 'winget' -Arguments @('install', '--id=astral-sh.uv', '-e') -What 'winget install uv'
            Update-SessionPath
        } elseif ($InstallTools -and $OnWindows) {
            Fail 'winget is not available. Install uv with:  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"  then open a new PowerShell window.'
        } else {
            Fail 'uv is not installed. Run:  winget install --id=astral-sh.uv -e   then CLOSE and reopen PowerShell and run setup again (or add -InstallTools).'
        }
    }
    if (-not (Test-Command 'uv')) { Fail 'uv is still not found. Close and reopen PowerShell, then run setup again.' }
    Ok "uv: $(& uv --version)"

    $HaveGit = Test-Command 'git'
    if (-not $HaveGit -and $InstallTools -and $OnWindows -and (Test-Command 'winget')) {
        Info 'installing Git with winget: winget install --id Git.Git -e'
        Invoke-Native -Exe 'winget' -Arguments @('install', '--id', 'Git.Git', '-e') -What 'winget install Git'
        Update-SessionPath
        $HaveGit = Test-Command 'git'
    }
    if ($HaveGit) {
        Ok "git: $(& git --version)"
    } else {
        Warn 'git is missing. Run:  winget install --id Git.Git -e   then reopen PowerShell and run setup again. The reference project is skipped.'
    }

    $CliVersion = ''
    if (Test-Command 'duckdb') {
        $raw = (& duckdb --version 2>$null | Select-Object -First 1)
        if ($raw -match 'v?(\d+\.\d+\.\d+)') { $CliVersion = $Matches[1] }
        Ok "DuckDB CLI: v$CliVersion"
    } else {
        Info 'DuckDB CLI not found (optional). Install: winget install DuckDB.cli   Without it, use: python $HOME\dbt-course\kit\tools\duck.py'
    }

    # ------------------------------------------------------------ 2. folders and files
    Step "Course folder: $CourseDir"
    $Practice = Join-Path $CourseDir 'practice'
    $Kit = Join-Path $CourseDir 'kit'
    $RefRoot = Join-Path $CourseDir 'reference'
    $RefPractice = Join-Path $RefRoot 'practice'
    foreach ($d in @($Practice, $Kit, $RefPractice)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    foreach ($target in @($Practice, $RefPractice)) {
        Copy-Missing (Join-Path $KitDir 'data') (Join-Path $target 'data')
        Copy-Missing (Join-Path $KitDir 'updates') (Join-Path $target 'updates')
        $setupTarget = Join-Path $target 'setup.sql'
        if (-not (Test-Path $setupTarget)) { Copy-Item -LiteralPath (Join-Path $KitDir 'setup.sql') -Destination $setupTarget }
    }
    foreach ($item in @('data', 'updates', 'bugs', 'tools', 'check', 'profiles')) {
        Copy-Missing (Join-Path $KitDir $item) (Join-Path $Kit $item)
    }
    foreach ($item in @('README.md', 'README-windows.md', 'KIT-VERSION.txt', 'setup.sql', 'jaffle_dbt.bundle')) {
        $t = Join-Path $Kit $item
        if (-not (Test-Path $t)) { Copy-Item -LiteralPath (Join-Path $KitDir $item) -Destination $t }
    }
    Ok 'kit\ (data, setup.sql, updates, bugs, jaffle_dbt.bundle, tools ...), practice\ and reference\practice\ are in place'

    # ------------------------------------------------------------ 3. venv + dbt
    $Venv = Join-Path $CourseDir '.venv'
    if ($OnWindows) {
        $Py = Join-Path (Join-Path $Venv 'Scripts') 'python.exe'
        $Dbt = Join-Path (Join-Path $Venv 'Scripts') 'dbt.exe'
        $Activate = Join-Path (Join-Path $Venv 'Scripts') 'Activate.ps1'
    } else {
        $Py = Join-Path (Join-Path $Venv 'bin') 'python'
        $Dbt = Join-Path (Join-Path $Venv 'bin') 'dbt'
        $Activate = Join-Path (Join-Path $Venv 'bin') 'Activate.ps1'
    }
    Step "Python $PyVersion virtual environment: $Venv"
    $venvOk = $false
    if (Test-Path $Py) {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        & $Py -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)" 2>$null
        $venvOk = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = $old
    }
    if ($venvOk) {
        Ok "existing venv kept ($(& $Py --version))"
    } elseif (Test-Path $Venv) {
        Warn "the existing .venv is not a Python $PyVersion venv: it is recreated"
        Invoke-Native -Exe 'uv' -Arguments @('venv', '--clear', '--python', $PyVersion, $Venv)
    } else {
        Invoke-Native -Exe 'uv' -Arguments @('venv', '--python', $PyVersion, $Venv)
    }
    Step "Installing $DbtCoreSpec, $DbtDuckdbSpec and duckdb==$DuckDBVersion"
    Invoke-Native -Exe 'uv' -Arguments @('pip', 'install', '--python', $Py, $DbtCoreSpec, $DbtDuckdbSpec, "duckdb==$DuckDBVersion")
    Invoke-Native -Exe $Dbt -Arguments @('--version')
    $LibVersion = (& $Py -c 'import duckdb; print(duckdb.__version__)').Trim()
    Ok "DuckDB Python library in the venv: $LibVersion"
    if ($CliVersion -ne '' -and $CliVersion -ne $LibVersion) {
        Warn "your DuckDB CLI is v$CliVersion but the venv has $LibVersion. They must be equal (Chapter 2)."
        Warn "fix: .\setup.ps1 -DuckDBVersion $CliVersion    (or install DuckDB CLI $LibVersion)"
    }

    # ------------------------------------------------------------ 4. databases
    $DuckPy = Join-Path (Join-Path $Kit 'tools') 'duck.py'
    foreach ($dir in @($Practice, $RefPractice)) {
        $dbFile = Join-Path $dir 'practice.duckdb'
        if ($dir -eq $Practice) { Step 'Practice database (= duckdb practice.duckdb -c ".read setup.sql")' }
        else { Step 'Reference database (a separate copy, for the reference project only)' }
        if ((Test-Path $dbFile) -and -not $RebuildDb) {
            Ok "$dbFile exists: kept (-RebuildDb to reset it to day 1)"
            continue
        }
        Push-Location $dir
        try {
            Invoke-Native -Exe $Py -Arguments @($DuckPy, 'practice.duckdb', '-f', 'setup.sql') -What 'building practice.duckdb'
        } finally {
            Pop-Location
        }
        Ok "built $dbFile"
    }

    # ------------------------------------------------------------ 5. reference project
    if ($HaveGit) {
        $Ref = Join-Path $RefRoot 'jaffle_dbt'
        Step "Reference project: $Ref (git clone of kit\jaffle_dbt.bundle)"
        if (Test-Path (Join-Path $Ref '.git')) {
            Ok 'already cloned (kept as it is)'
        } else {
            Invoke-Native -Exe 'git' -Arguments @('clone', (Join-Path $Kit 'jaffle_dbt.bundle'), $Ref) -What 'git clone'
        }
        $refProfile = Join-Path $Ref 'profiles.yml'
        if (-not (Test-Path $refProfile)) {
            Copy-Item -LiteralPath (Join-Path (Join-Path $Kit 'profiles') 'profiles.yml') -Destination $refProfile
        }
        $exclude = Join-Path (Join-Path (Join-Path $Ref '.git') 'info') 'exclude'
        $content = ''
        if (Test-Path $exclude) { $content = [IO.File]::ReadAllText($exclude) }
        if (-not ($content -split "`r?`n" | Where-Object { $_ -eq 'profiles.yml' })) {
            if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`n" }
            [IO.File]::WriteAllText($exclude, $content + "profiles.yml`n", (New-Object System.Text.UTF8Encoding $false))
        }
        $tags = @(& git -C $Ref tag -l 'ch*')
        Ok "$($tags.Count) chapter tags (ch06 ... ch25); profiles.yml added (ignored by git)"
    }

    # ------------------------------------------------------------ 6. dbt debug
    Step 'dbt debug (checks dbt, the DuckDB adapter and the connection to practice.duckdb)'
    Push-Location (Join-Path $Kit 'check')
    try {
        Invoke-Native -Exe $Dbt -Arguments @('debug') -What 'dbt debug'
    } catch {
        if (-not $HaveGit) { Fail 'dbt debug failed (git is missing: install it, then run setup again)' }
        Fail "dbt debug failed: read the lines above (is another program using practice.duckdb?)"
    } finally {
        Pop-Location
    }
    Ok 'dbt debug passed'

    Write-Host ''
    Write-Host '============================================================================'
    Write-Host ' Setup complete.'
    Write-Host "   Course folder : $CourseDir"
    Write-Host "   Activate      : & `"$Activate`""
    Write-Host '                   (if PowerShell refuses: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned, once)'
    Write-Host '   Then          : dbt --version        (installed: 1.11.x, duckdb: 1.11.x)'
    Write-Host "   Your database : $(Join-Path $Practice 'practice.duckdb')"
    Write-Host "   Reference     : $(Join-Path $RefRoot 'jaffle_dbt')   (git tag -n lists the chapters)"
    Write-Host " Next: read $(Join-Path $Kit 'README-windows.md')"
    Write-Host '============================================================================'
} catch {
    Fail $_.Exception.Message
}
