<#
============================================================================
 ShopFlow capstone kit - setup for Windows PowerShell (milestone m00, first step)

   powershell -ExecutionPolicy Bypass -File .\setup.ps1

 Needs the course folder of the practice kit ($HOME\dbt-course\.venv, Chapter 2).
 Options: -CourseDir C:\some\folder   -RebuildDb (reset the raw data to day 1)

 Installs the kit in $HOME\dbt-course\kit\capstone (= the book's labs/capstone folder: data\ seeds\
 setup.sql updates\ shopflow_dbt.bundle = THE SOLUTION, profiles\, README.md, a ready-made shopflow.duckdb),
 then does the first step of milestone m00: $HOME\dbt-course\shopflow-data (data\ updates\ setup.sql shopflow.duckdb).
 It does not clone the solution.
============================================================================
#>
[CmdletBinding()]
param(
    [string]$CourseDir = (Join-Path $HOME 'dbt-course'),
    [switch]$RebuildDb
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
# absolute path (a relative -CourseDir is read from the current folder)
$CourseDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CourseDir)
$KitDir = $PSScriptRoot
$OnWindows = $true
if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { $OnWindows = $false }

function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Ok([string]$Text)   { Write-Host "    OK  $Text" -ForegroundColor Green }
function Fail([string]$Text) { Write-Host ''; Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }

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
    foreach ($f in @('setup.sql', 'data/orders.csv', 'updates/day2.sql', 'updates/day3.sql',
                     'seeds/exchange_rates.csv', 'shopflow_dbt.bundle', 'tools/duck.py')) {
        if (-not (Test-Path (Join-Path $KitDir $f))) { Fail "the kit is incomplete: $f is missing. Unzip shopflow-capstone-kit.zip again." }
    }
    $Venv = Join-Path $CourseDir '.venv'
    if ($OnWindows) { $Py = Join-Path (Join-Path $Venv 'Scripts') 'python.exe' }
    else { $Py = Join-Path (Join-Path $Venv 'bin') 'python' }
    if (-not (Test-Path $Py)) { Fail "$Venv not found. Run the practice kit's setup.ps1 first (dbt-course-kit.zip)." }

    function Build-Db([string]$Dir) {
        $db = Join-Path $Dir 'shopflow.duckdb'
        if ((Test-Path $db) -and -not $RebuildDb) { Ok "$db exists: kept (-RebuildDb to reset it to day 1)"; return }
        Push-Location $Dir
        try {
            $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            & $Py (Join-Path (Join-Path (Join-Path $CourseDir 'kit') 'tools') 'duck.py') 'shopflow.duckdb' '-f' 'setup.sql'
            $code = $LASTEXITCODE
            $ErrorActionPreference = $old
            if ($code -ne 0) { Fail "building $db failed (exit code $code). Is another program using it?" }
        } finally {
            Pop-Location
        }
        Ok "built $db"
    }

    $Cap = Join-Path (Join-Path $CourseDir 'kit') 'capstone'
    Step "Kit folder: $Cap"
    foreach ($d in @('data', 'seeds', 'updates', 'profiles')) { Copy-Missing (Join-Path $KitDir $d) (Join-Path $Cap $d) }
    Copy-Missing (Join-Path $KitDir 'tools') (Join-Path (Join-Path $CourseDir 'kit') 'tools')
    foreach ($f in @('setup.sql', 'shopflow_dbt.bundle', 'README.md', 'KIT-VERSION.txt')) {
        $t = Join-Path $Cap $f
        if (-not (Test-Path $t)) { Copy-Item -LiteralPath (Join-Path $KitDir $f) -Destination $t }
    }
    Ok 'data, seeds, setup.sql, updates, profiles, README.md and shopflow_dbt.bundle (the SOLUTION: look only after your own attempt)'
    Step 'Ready-made raw database in the kit folder'
    Build-Db $Cap

    $Data = Join-Path $CourseDir 'shopflow-data'
    Step "Milestone m00, first step: $Data (= copy data, updates, setup.sql from the kit, then duckdb shopflow.duckdb -c `".read setup.sql`")"
    Copy-Missing (Join-Path $Cap 'data') (Join-Path $Data 'data')
    Copy-Missing (Join-Path $Cap 'updates') (Join-Path $Data 'updates')
    if (-not (Test-Path (Join-Path $Data 'setup.sql'))) { Copy-Item -LiteralPath (Join-Path $Cap 'setup.sql') -Destination (Join-Path $Data 'setup.sql') }
    Build-Db $Data
    Write-Host ''
    Write-Host " Done. Next (milestone m00): cd $CourseDir; dbt init shopflow_dbt --skip-profile-setup"
    Write-Host " and add the 'shopflow' profile to $HOME\.dbt\profiles.yml (Chapter 26)."
} catch {
    Fail $_.Exception.Message
}
