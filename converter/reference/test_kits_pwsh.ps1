<#
 Run the kits' PowerShell setup scripts under PowerShell 7 (pwsh) on macOS/Linux, in an isolated HOME.
 This checks the syntax and most of the logic of setup.ps1; the Windows-only branches (winget, Scripts\ paths,
 PowerShell 5.1) are NOT exercised here - see ci/kit-matrix.yml for the windows-latest job.

   pwsh -NoProfile -File converter/reference/test_kits_pwsh.ps1 -Work <empty folder>
#>
param([Parameter(Mandatory = $true)][string]$Work)
$ErrorActionPreference = 'Stop'
$Academy = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$Kits = Join-Path $Academy 'site/public/kits'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$Work = (Resolve-Path $Work).Path
if ((Get-ChildItem $Work -Force | Measure-Object).Count -ne 0) { throw "work folder must be empty: $Work" }

$realHome = $env:HOME
if (-not $env:UV_CACHE_DIR) { $env:UV_CACHE_DIR = Join-Path $realHome '.cache/uv' }
if (-not $env:UV_PYTHON_INSTALL_DIR) { $env:UV_PYTHON_INSTALL_DIR = Join-Path $realHome '.local/share/uv/python' }
$env:HOME = Join-Path $Work 'home'
New-Item -ItemType Directory -Force -Path $env:HOME | Out-Null
Get-ChildItem Env: | Where-Object { $_.Name -like 'DBT_*' } | ForEach-Object { Remove-Item "Env:$($_.Name)" }
$env:DBT_SEND_ANONYMOUS_USAGE_STATS = 'false'
$env:DBT_USE_COLORS = 'false'

$script:pass = 0; $script:fail = 0
function Check([string]$What, [bool]$Ok) {
    if ($Ok) { Write-Host "PASS  $What"; $script:pass++ } else { Write-Host "FAIL  $What"; $script:fail++ }
}

$unzip = Join-Path $Work 'unzip'
Expand-Archive -Path (Join-Path $Kits 'dbt-course-kit.zip') -DestinationPath $unzip
Expand-Archive -Path (Join-Path $Kits 'shopflow-capstone-kit.zip') -DestinationPath $unzip
$kit = Join-Path $unzip 'dbt-course-kit'
$course = Join-Path $env:HOME 'dbt-course'

# 1. setup.ps1 from scratch (a separate pwsh process, like the user's command)
$log1 = Join-Path $Work 'setup1.log'
& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kit 'setup.ps1') -CourseDir $course *> $log1
$code1 = $LASTEXITCODE
Get-Content $log1 -Tail 22
Check 'setup.ps1 from scratch exits 0' ($code1 -eq 0)
$t1 = Get-Content $log1 -Raw
Check 'dbt debug passed' ($t1 -match 'All checks passed!')
Check 'practice.duckdb row counts (341 payments)' (($t1 -replace ' +', ' ') -match 'stripe\.payments \| 341')
Check 'reference project cloned' (Test-Path (Join-Path $course 'reference/jaffle_dbt/.git'))
Check '~/.dbt not created' (-not (Test-Path (Join-Path $env:HOME '.dbt/profiles.yml')))

# 2. second run: idempotent
$log2 = Join-Path $Work 'setup2.log'
& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kit 'setup.ps1') -CourseDir $course *> $log2
Check 'second run exits 0' ($LASTEXITCODE -eq 0)
$t2 = Get-Content $log2 -Raw
Check 'second run keeps the database and the venv' (($t2 -match 'exists: kept') -and ($t2 -match 'existing venv kept'))

# 3. reference at ch07: dbt build, same summary as the builder log
$ref = Join-Path $course 'reference/jaffle_dbt'
& git -C $ref checkout -q ch07
$dbt = Join-Path $course '.venv/bin/dbt'
Push-Location $ref
$out = & $dbt build 2>&1 | Out-String
Pop-Location
$got = ([regex]::Matches($out, 'Done\. PASS=\d+ WARN=\d+ ERROR=\d+ SKIP=\d+ NO-OP=\d+ TOTAL=\d+') | Select-Object -Last 1).Value
$logText = Get-Content (Join-Path $Academy 'reference/builder-logs/ch07.md') -Raw
$expected = ([regex]::Matches($logText, 'Done\. PASS=\d+ WARN=\d+ ERROR=\d+ SKIP=\d+ NO-OP=\d+ TOTAL=\d+'))[1].Value
Write-Host "   expected: $expected"
Write-Host "   got:      $got"
Check 'ch07 dbt build summary equals builder-logs/ch07.md' ($got -eq $expected)
& git -C $ref checkout -q main

# 4. -RebuildDb resets the data
$log3 = Join-Path $Work 'setup3.log'
& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kit 'setup.ps1') -CourseDir $course -RebuildDb *> $log3
Check '-RebuildDb exits 0 and rebuilds' (($LASTEXITCODE -eq 0) -and ((Get-Content $log3 -Raw) -match 'built '))

# 5. capstone
$cap = Join-Path $unzip 'shopflow-capstone-kit'
$log4 = Join-Path $Work 'cap-setup.log'
& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $cap 'setup.ps1') -CourseDir $course *> $log4
Check 'capstone setup.ps1 exits 0' ($LASTEXITCODE -eq 0)
$t4 = (Get-Content $log4 -Raw) -replace ' +', ' '
Check 'capstone: 3000 orders, 25444 events' (($t4 -match 'shopflow_app\.orders \| 3000') -and ($t4 -match 'web_analytics\.events \| 25444'))

Write-Host ''
Write-Host "RESULT: $($script:pass) passed, $($script:fail) failed   (work folder: $Work)"
$env:HOME = $realHome
if ($script:fail -ne 0) { exit 1 }
