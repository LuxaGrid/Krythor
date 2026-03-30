# =============================================================================
#  scripts/switch-sqlite-runtime.ps1
#
#  Switches the active better-sqlite3 binary between the Node v20 (production)
#  and Node v24 (dev/test) prebuilt versions.
#
#  Usage:
#    .\scripts\switch-sqlite-runtime.ps1 -Mode dev      # v24 for tests
#    .\scripts\switch-sqlite-runtime.ps1 -Mode prod     # v20 for gateway
#    .\scripts\switch-sqlite-runtime.ps1                # shows current mode
#
# =============================================================================

param(
    [ValidateSet('dev', 'prod', '')]
    [string]$Mode = ''
)

$sqliteDir  = Join-Path $PSScriptRoot '..\\.pnvm\\better-sqlite3@11.10.0\\node_modules\\better-sqlite3'
$active     = Join-Path $sqliteDir 'build\\Release\\better_sqlite3.node'
$prebuiltDir = Join-Path $sqliteDir 'prebuilt'
$v20path    = Join-Path $prebuiltDir 'better_sqlite3_node20.node'
$v24path    = Join-Path $prebuiltDir 'better_sqlite3_node24.node'

function Get-CurrentMode {
    if (-not (Test-Path $active)) { return 'unknown' }
    $activeHash = (Get-FileHash $active -Algorithm MD5).Hash
    if (Test-Path $v20path) {
        $v20Hash = (Get-FileHash $v20path -Algorithm MD5).Hash
        if ($activeHash -eq $v20Hash) { return 'prod (v20)' }
    }
    if (Test-Path $v24path) {
        $v24Hash = (Get-FileHash $v24path -Algorithm MD5).Hash
        if ($activeHash -eq $v24Hash) { return 'dev (v24)' }
    }
    return 'custom/unknown'
}

$current = Get-CurrentMode

if ($Mode -eq '') {
    Write-Host "  Current mode: $current" -ForegroundColor Cyan
    Write-Host "  Usage: .\scripts\switch-sqlite-runtime.ps1 -Mode dev|prod" -ForegroundColor DarkGray
    exit 0
}

if ($Mode -eq 'dev') {
    if (-not (Test-Path $v24path)) {
        Write-Host "  [FAIL] v24 prebuilt not found at $v24path" -ForegroundColor Red
        Write-Host "         Run: node node-gyp rebuild (in $sqliteDir)" -ForegroundColor DarkGray
        exit 1
    }
    Copy-Item $v24path $active -Force
    Write-Host "  [PASS] Switched to dev mode (Node v24) — run pnpm test" -ForegroundColor Green
} elseif ($Mode -eq 'prod') {
    if (-not (Test-Path $v20path)) {
        Write-Host "  [FAIL] v20 prebuilt not found at $v20path" -ForegroundColor Red
        Write-Host "         Run: ~/.krythor/runtime/node.exe node-gyp rebuild (in $sqliteDir)" -ForegroundColor DarkGray
        exit 1
    }
    Copy-Item $v20path $active -Force
    Write-Host "  [PASS] Switched to prod mode (Node v20) — start gateway" -ForegroundColor Green
}
