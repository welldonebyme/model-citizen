<#
============================================================================
 ShopFlow capstone kit - setup for Windows PowerShell (milestone m00, first step)

   powershell -ExecutionPolicy Bypass -File .\setup.ps1

 Needs the course folder of the practice kit ($HOME\dbt-course\.venv, Chapter 2).
 Options: -CourseDir C:\some\folder   -RebuildDb (reset the raw data to day 1)

 Creates $HOME\dbt-course\shopflow-data (data\ updates\ setup.sql shopflow.duckdb) and
 $HOME\dbt-course\kit\capstone (shopflow_dbt.bundle = THE SOLUTION, seeds\, profiles\, README.md).
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

    $Data = Join-Path $CourseDir 'shopflow-data'
    Step "Raw data folder: $Data"
    Copy-Missing (Join-Path $KitDir 'data') (Join-Path $Data 'data')
    Copy-Missing (Join-Path $KitDir 'updates') (Join-Path $Data 'updates')
    if (-not (Test-Path (Join-Path $Data 'setup.sql'))) { Copy-Item -LiteralPath (Join-Path $KitDir 'setup.sql') -Destination (Join-Path $Data 'setup.sql') }
    Ok 'data, updates and setup.sql are in place'

    Step 'shopflow.duckdb (= duckdb shopflow.duckdb -c ".read setup.sql")'
    if ((Test-Path (Join-Path $Data 'shopflow.duckdb')) -and -not $RebuildDb) {
        Ok 'exists: kept (-RebuildDb to reset it to day 1)'
    } else {
        Push-Location $Data
        try {
            $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            & $Py (Join-Path (Join-Path $KitDir 'tools') 'duck.py') 'shopflow.duckdb' '-f' 'setup.sql'
            $code = $LASTEXITCODE
            $ErrorActionPreference = $old
            if ($code -ne 0) { Fail "building shopflow.duckdb failed (exit code $code). Is another program using it?" }
        } finally {
            Pop-Location
        }
        Ok "built $(Join-Path $Data 'shopflow.duckdb')"
    }

    $Cap = Join-Path (Join-Path $CourseDir 'kit') 'capstone'
    Step "Kit files: $Cap"
    Copy-Missing (Join-Path $KitDir 'seeds') (Join-Path $Cap 'seeds')
    Copy-Missing (Join-Path $KitDir 'profiles') (Join-Path $Cap 'profiles')
    Copy-Missing (Join-Path $KitDir 'tools') (Join-Path (Join-Path $CourseDir 'kit') 'tools')
    foreach ($f in @('shopflow_dbt.bundle', 'README.md')) {
        $t = Join-Path $Cap $f
        if (-not (Test-Path $t)) { Copy-Item -LiteralPath (Join-Path $KitDir $f) -Destination $t }
    }
    Ok 'shopflow_dbt.bundle (the SOLUTION: look only after your own attempt), seeds, profiles'
    Write-Host ''
    Write-Host " Done. Next (milestone m00): cd $CourseDir; dbt init shopflow_dbt --skip-profile-setup"
    Write-Host " and add the 'shopflow' profile to $HOME\.dbt\profiles.yml (Chapter 26)."
} catch {
    Fail $_.Exception.Message
}
