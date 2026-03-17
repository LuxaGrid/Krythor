\
$ErrorActionPreference = "Stop"

Write-Host "== LuxaGrid PRO Check =="
Write-Host "Working dir: $(Get-Location)"
Write-Host ""

if (-Not (Test-Path "package.json")) {
  Write-Host "-- No package.json found. Add your own checks here."
  exit 0
}

function Run-IfExists($scriptName) {
  $scripts = (Get-Content package.json | ConvertFrom-Json).scripts
  if ($null -ne $scripts.$scriptName) {
    Write-Host ">> npm run $scriptName"
    npm run $scriptName
  } else {
    Write-Host ">> (skip) npm run $scriptName not found"
  }
}

Run-IfExists "lint"
Run-IfExists "typecheck"
Run-IfExists "test"
Run-IfExists "build"

Write-Host ""
Write-Host "== Checks complete =="
