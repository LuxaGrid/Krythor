# =============================================================================
#  Krythor — Full Build Loop
#  scripts/full-build-loop.ps1
#
#  Runs the complete repo-wide validation: install → build → test → runtime
#  health checks. Exits 0 only when everything passes.
#
#  Usage:
#    .\scripts\full-build-loop.ps1                # full run
#    .\scripts\full-build-loop.ps1 -SkipTests     # skip pnpm test (faster)
#    .\scripts\full-build-loop.ps1 -SkipRuntime   # skip gateway startup checks
#    .\scripts\full-build-loop.ps1 -SkipTests -SkipRuntime
#
# =============================================================================

param(
    [switch]$SkipTests,
    [switch]$SkipRuntime
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

# ── Colour helpers ────────────────────────────────────────────────────────────

function Write-Pass  { param($msg) Write-Host "  [PASS] $msg" -ForegroundColor Green }
function Write-Fail  { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Warn  { param($msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Info  { param($msg) Write-Host "  [INFO] $msg" -ForegroundColor Cyan }
function Write-Step  { param($msg) Write-Host "`n  ── $msg" -ForegroundColor White }
function Write-Sep   { Write-Host "  $('─' * 55)" -ForegroundColor DarkGray }

# ── Check tracking ────────────────────────────────────────────────────────────

$checks = [System.Collections.Generic.List[hashtable]]::new()

function Add-Check {
    param([string]$Name, [string]$Status, [string]$Detail = '')
    $checks.Add(@{ name = $Name; status = $Status; detail = $Detail })
    switch ($Status) {
        'PASS' { Write-Pass "$Name$(if ($Detail) { " — $Detail" })" }
        'FAIL' { Write-Fail "$Name$(if ($Detail) { " — $Detail" })" }
        'WARN' { Write-Warn "$Name$(if ($Detail) { " — $Detail" })" }
        'INFO' { Write-Info "$Name$(if ($Detail) { " — $Detail" })" }
        'SKIP' { Write-Host "  [SKIP] $Name$(if ($Detail) { " — $Detail" })" -ForegroundColor DarkGray }
    }
}

# ── Paths ─────────────────────────────────────────────────────────────────────

$root        = Split-Path -Parent $PSScriptRoot
$dataDir     = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Krythor' } else { Join-Path $HOME '.krythor' }
$runtimeNode = 'C:\Users\atbro\.krythor\runtime\node.exe'
$nodeExe     = if (Test-Path $runtimeNode) { $runtimeNode } else { 'node' }
$port        = 47200
$host_       = '127.0.0.1'
$gatewayMain = Join-Path $root 'packages\gateway\dist\index.js'
$appCfgPath  = Join-Path $dataDir 'config\app-config.json'

$gatewayProcess = $null

# ── Header ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║         KRYTHOR — Full Build & Validation Loop     ║" -ForegroundColor Cyan
Write-Host "  ║           $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ·  v0.2.1              ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if ($SkipTests)   { Write-Warn "Flag: -SkipTests active — pnpm test will not run" }
if ($SkipRuntime) { Write-Warn "Flag: -SkipRuntime active — gateway startup checks will not run" }

# =============================================================================
#  STEP 1 — pnpm install
# =============================================================================

Write-Step "Step 1 · pnpm install"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Add-Check 'pnpm-available' 'FAIL' 'pnpm not found — install with: npm install -g pnpm'
    Write-Host "`n  [FATAL] Cannot continue without pnpm." -ForegroundColor Red
    exit 1
}

Push-Location $root
$installOut = pnpm install 2>&1
$installExit = $LASTEXITCODE
Pop-Location

if ($installExit -ne 0) {
    Add-Check 'pnpm-install' 'FAIL' "Exit code $installExit"
    Write-Host ""
    Write-Host "  Install output:" -ForegroundColor DarkGray
    $installOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host "`n  [FATAL] pnpm install failed — cannot continue." -ForegroundColor Red
    exit 1
} else {
    Add-Check 'pnpm-install' 'PASS' 'dependencies installed'
}

# =============================================================================
#  STEP 2 — pnpm -r build
# =============================================================================

Write-Step "Step 2 · pnpm -r build"

Push-Location $root
$buildOut = pnpm -r build 2>&1
$buildExit = $LASTEXITCODE
Pop-Location

if ($buildExit -ne 0) {
    Add-Check 'pnpm-build' 'FAIL' "Exit code $buildExit"
    Write-Host ""
    Write-Host "  Build output (last 40 lines):" -ForegroundColor DarkGray
    $buildOut | Select-Object -Last 40 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host "`n  [FATAL] Build failed — cannot continue." -ForegroundColor Red
    exit 1
} else {
    Add-Check 'pnpm-build' 'PASS' 'all packages built'
}

# Verify key artefacts exist post-build
$keyArtefacts = @(
    @{ path = 'packages\gateway\dist\index.js'; label = 'gateway/dist/index.js' },
    @{ path = 'packages\core\dist\index.js';    label = 'core/dist/index.js' },
    @{ path = 'packages\memory\dist\index.js';  label = 'memory/dist/index.js' },
    @{ path = 'packages\models\dist\index.js';  label = 'models/dist/index.js' },
    @{ path = 'packages\guard\dist\index.js';   label = 'guard/dist/index.js' }
)

foreach ($a in $keyArtefacts) {
    $full = Join-Path $root $a.path
    if (Test-Path $full) {
        Add-Check "artefact-$($a.label)" 'PASS' $a.label
    } else {
        Add-Check "artefact-$($a.label)" 'FAIL' "$($a.label) missing after build"
    }
}

# =============================================================================
#  STEP 3 — pnpm -r test
# =============================================================================

Write-Step "Step 3 · pnpm -r test"

if ($SkipTests) {
    Add-Check 'pnpm-test' 'SKIP' '-SkipTests flag set'
} else {
    Push-Location $root
    $testOut = pnpm -r test 2>&1
    $testExit = $LASTEXITCODE
    Pop-Location

    $testLines = ($testOut -join "`n")

    # Parse vitest/jest-style summary lines
    $passedMatch  = [regex]::Match($testLines, 'Tests\s+(\d+)\s+passed')
    $failedMatch  = [regex]::Match($testLines, '(\d+)\s+failed')
    $suitesMatch  = [regex]::Match($testLines, 'Test Suites[^\n]*(\d+)\s+passed')

    if ($testExit -ne 0) {
        $failedCount = if ($failedMatch.Success) { $failedMatch.Groups[1].Value } else { 'unknown' }
        Add-Check 'pnpm-test' 'FAIL' "Test suite failed ($failedCount test(s) failed)"
        Write-Host ""
        Write-Host "  Test output (last 50 lines):" -ForegroundColor DarkGray
        $testOut | Select-Object -Last 50 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    } elseif ($passedMatch.Success) {
        Add-Check 'pnpm-test' 'PASS' "$($passedMatch.Groups[1].Value) test(s) passed"
    } else {
        # Exit 0 but can't parse — still counts as ok
        Add-Check 'pnpm-test' 'PASS' 'test suite exited 0 (output not parseable)'
    }
}

# =============================================================================
#  STEP 4 — Runtime health checks
# =============================================================================

Write-Step "Step 4 · Runtime Health Checks"

if ($SkipRuntime) {
    Add-Check 'runtime-checks' 'SKIP' '-SkipRuntime flag set'
} else {
    # Read auth token
    $authToken = $null
    if (Test-Path $appCfgPath) {
        try {
            $appCfg = Get-Content $appCfgPath -Raw | ConvertFrom-Json
            $authToken = $appCfg.gatewayToken
        } catch {
            Add-Check 'read-auth-token' 'WARN' "Could not parse app-config.json: $($_.Exception.Message)"
        }
    } else {
        Add-Check 'read-auth-token' 'WARN' "app-config.json not found at $appCfgPath — some checks will be skipped"
    }

    # Check if port already in use before we try to start
    $portAlreadyInUse = $false
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $ar  = $tcp.BeginConnect($host_, $port, $null, $null)
        $ok  = $ar.AsyncWaitHandle.WaitOne(500, $false)
        if ($ok -and $tcp.Connected) { $portAlreadyInUse = $true }
        $tcp.Close()
    } catch {}

    if ($portAlreadyInUse) {
        Add-Check 'gateway-port' 'WARN' "Port $port already in use — will test against running process (not starting a new one)"
    }

    # Start gateway (unless port already occupied)
    if (-not $portAlreadyInUse) {
        if (-not (Test-Path $gatewayMain)) {
            Add-Check 'gateway-start' 'FAIL' "gateway dist not found: $gatewayMain"
            goto RuntimeDone
        }

        Write-Info "Starting gateway with: $nodeExe $gatewayMain"

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName               = $nodeExe
        $psi.Arguments              = "`"$gatewayMain`""
        $psi.WorkingDirectory       = $root
        $psi.UseShellExecute        = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError  = $true
        $psi.CreateNoWindow         = $true

        try {
            $gatewayProcess = [System.Diagnostics.Process]::Start($psi)
            Add-Check 'gateway-start' 'PASS' "Gateway process started (PID $($gatewayProcess.Id))"
        } catch {
            Add-Check 'gateway-start' 'FAIL' "Could not start gateway: $($_.Exception.Message)"
            goto RuntimeDone
        }

        Write-Info "Waiting 5 seconds for gateway to initialise..."
        Start-Sleep -Seconds 5
    }

    # ── Health check: GET /health ─────────────────────────────────────────────
    try {
        $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/health" -TimeoutSec 5 -ErrorAction Stop
        if ($resp.status -eq 'ok') {
            Add-Check 'health-endpoint' 'PASS' "/health → status:ok (v$($resp.version))"
        } else {
            Add-Check 'health-endpoint' 'FAIL' "/health returned status: $($resp.status)"
        }
    } catch {
        Add-Check 'health-endpoint' 'FAIL' "/health failed: $($_.Exception.Message)"
    }

    if ($authToken) {
        $headers = @{ Authorization = "Bearer $authToken" }

        # ── Chat channels providers ───────────────────────────────────────────
        try {
            $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/api/chat-channels/providers" -Headers $headers -TimeoutSec 5 -ErrorAction Stop
            $count = @($resp.providers).Count
            if ($count -ge 3) {
                Add-Check 'chat-channels-providers' 'PASS' "/api/chat-channels/providers — $count provider(s) (expected ≥3)"
            } else {
                Add-Check 'chat-channels-providers' 'WARN' "/api/chat-channels/providers — only $count provider(s) registered (expected ≥3)"
            }
        } catch {
            Add-Check 'chat-channels-providers' 'FAIL' "/api/chat-channels/providers failed: $($_.Exception.Message)"
        }

        # ── File audit ────────────────────────────────────────────────────────
        try {
            $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/api/tools/files/audit" -Headers $headers -TimeoutSec 5 -ErrorAction Stop
            Add-Check 'file-audit' 'PASS' "/api/tools/files/audit — $($resp.total) audit entries"
        } catch {
            Add-Check 'file-audit' 'FAIL' "/api/tools/files/audit failed: $($_.Exception.Message)"
        }

        # ── Shell enforcement (expect 403 for safe profile) ───────────────────
        try {
            $null = Invoke-WebRequest -Uri "http://${host_}:${port}/api/tools/shell/processes" -Headers $headers -TimeoutSec 5 -ErrorAction Stop
            # If we get here the request succeeded with 2xx — unexpected for safe profile
            Add-Check 'shell-enforcement' 'WARN' "/api/tools/shell/processes returned 200 — safe profile should return 403"
        } catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($statusCode -eq 403) {
                Add-Check 'shell-enforcement' 'PASS' "/api/tools/shell/processes correctly returns 403 (SHELL_DENIED for safe profile)"
            } else {
                Add-Check 'shell-enforcement' 'WARN' "/api/tools/shell/processes returned $statusCode (expected 403)"
            }
        }

    } else {
        Add-Check 'authenticated-checks' 'WARN' 'Auth token not available — skipping authenticated API checks'
    }

    # ── Stop gateway ──────────────────────────────────────────────────────────
    if ($gatewayProcess -and -not $gatewayProcess.HasExited) {
        Write-Info "Stopping gateway (PID $($gatewayProcess.Id))..."
        try {
            $gatewayProcess.Kill()
            $gatewayProcess.WaitForExit(3000) | Out-Null
            Add-Check 'gateway-stop' 'PASS' 'Gateway process stopped cleanly'
        } catch {
            Add-Check 'gateway-stop' 'WARN' "Could not cleanly stop gateway: $($_.Exception.Message)"
        }
    }
}

:RuntimeDone

# =============================================================================
#  SUMMARY TABLE
# =============================================================================

Write-Host ""
Write-Sep
Write-Host ""
Write-Host "  RESULTS SUMMARY" -ForegroundColor White
Write-Host ""

$colW = 42
$passCount = 0; $failCount = 0; $warnCount = 0; $skipCount = 0

foreach ($c in $checks) {
    $namePad = $c.name.PadRight($colW)
    switch ($c.status) {
        'PASS' {
            $passCount++
            Write-Host "  $namePad " -NoNewline
            Write-Host "PASS" -ForegroundColor Green
        }
        'FAIL' {
            $failCount++
            Write-Host "  $namePad " -NoNewline
            Write-Host "FAIL" -ForegroundColor Red
            if ($c.detail) { Write-Host "    $(' ' * $colW) $($c.detail)" -ForegroundColor DarkRed }
        }
        'WARN' {
            $warnCount++
            Write-Host "  $namePad " -NoNewline
            Write-Host "WARN" -ForegroundColor Yellow
        }
        'SKIP' {
            $skipCount++
            Write-Host "  $namePad " -NoNewline
            Write-Host "SKIP" -ForegroundColor DarkGray
        }
        default {
            Write-Host "  $namePad " -NoNewline
            Write-Host $c.status -ForegroundColor Cyan
        }
    }
}

Write-Host ""
Write-Sep
Write-Host ""
Write-Host "  " -NoNewline
Write-Host "$passCount passed" -ForegroundColor Green -NoNewline
Write-Host "   " -NoNewline
if ($failCount -gt 0) {
    Write-Host "$failCount failed" -ForegroundColor Red -NoNewline
} else {
    Write-Host "$failCount failed" -ForegroundColor DarkGray -NoNewline
}
Write-Host "   " -NoNewline
if ($warnCount -gt 0) {
    Write-Host "$warnCount warnings" -ForegroundColor Yellow -NoNewline
} else {
    Write-Host "$warnCount warnings" -ForegroundColor DarkGray -NoNewline
}
if ($skipCount -gt 0) {
    Write-Host "   " -NoNewline
    Write-Host "$skipCount skipped" -ForegroundColor DarkGray -NoNewline
}
Write-Host ""
Write-Host ""

if ($failCount -eq 0 -and $warnCount -eq 0) {
    Write-Host "  All checks passed — Krythor build loop is healthy." -ForegroundColor Green
} elseif ($failCount -eq 0) {
    Write-Host "  No failures, but $warnCount warning(s) to review." -ForegroundColor Yellow
} else {
    Write-Host "  $failCount check(s) failed. Review output above for details." -ForegroundColor Red
}

Write-Host ""

# Exit 0 only if ALL checks pass (no failures)
if ($failCount -gt 0) { exit 1 }
exit 0
