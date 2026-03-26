# =============================================================================
#  Krythor — System Health Check
#  scripts/check.ps1
#
#  Usage:
#    .\scripts\check.ps1              # full check
#    .\scripts\check.ps1 -Fix         # attempt to auto-fix issues
#    .\scripts\check.ps1 -Verbose     # extra detail
#    .\scripts\check.ps1 -Json        # output results as JSON
#
# =============================================================================

param(
    [switch]$Fix,
    [switch]$Json,
    [switch]$Verbose
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

# ── Colours ──────────────────────────────────────────────────────────────────

function Write-Pass   { param($msg) Write-Host "  [PASS] $msg" -ForegroundColor Green }
function Write-Fail   { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Warn   { param($msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Info   { param($msg) Write-Host "  [INFO] $msg" -ForegroundColor Cyan }
function Write-Detail { param($msg) if ($Verbose) { Write-Host "         $msg" -ForegroundColor DarkGray } }
function Write-Section{ param($msg) Write-Host "`n  $msg" -ForegroundColor White }

# ── Result tracking ───────────────────────────────────────────────────────────

$results = [System.Collections.Generic.List[hashtable]]::new()
$passCount = 0; $failCount = 0; $warnCount = 0

function Add-Result {
    param([string]$Category, [string]$Check, [string]$Status, [string]$Message, [string]$Detail = '')
    $results.Add(@{ category = $Category; check = $Check; status = $Status; message = $Message; detail = $Detail })
    switch ($Status) {
        'PASS' { $script:passCount++; Write-Pass $Message }
        'FAIL' { $script:failCount++; Write-Fail $Message }
        'WARN' { $script:warnCount++; Write-Warn $Message }
        'INFO' { Write-Info $Message }
    }
    if ($Detail -and $Verbose) { Write-Detail $Detail }
}

# ── Paths ─────────────────────────────────────────────────────────────────────

$root      = Split-Path -Parent $PSScriptRoot
$dataDir   = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Krythor' } else { Join-Path $HOME '.krythor' }
$configDir = Join-Path $dataDir 'config'
$logsDir   = Join-Path $dataDir 'logs'
$port      = 47200
$host_     = '127.0.0.1'

# =============================================================================
#  HEADER
# =============================================================================

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║        KRYTHOR — System Health Check       ║" -ForegroundColor Cyan
Write-Host "  ║              v0.2.1 · $(Get-Date -Format 'yyyy-MM-dd HH:mm')        ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# =============================================================================
#  1. PREREQUISITES
# =============================================================================

Write-Section "1 · Prerequisites"

# Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Add-Result 'Prerequisites' 'node-installed' 'FAIL' 'Node.js is not installed' 'Install from https://nodejs.org (version 18+)'
} else {
    $nodeVer = (node --version 2>$null) -replace '^v',''
    $nodeMajor = [int]($nodeVer -split '\.')[0]
    if ($nodeMajor -lt 18) {
        Add-Result 'Prerequisites' 'node-version' 'FAIL' "Node.js $nodeVer is too old (need 18+)" 'Update at https://nodejs.org'
    } else {
        Add-Result 'Prerequisites' 'node-version' 'PASS' "Node.js $nodeVer" "Path: $($nodeCmd.Source)"
    }
}

# pnpm
$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCmd) {
    Add-Result 'Prerequisites' 'pnpm-installed' 'FAIL' 'pnpm is not installed' 'Run: npm install -g pnpm'
    if ($Fix) {
        Write-Info 'Attempting to install pnpm...'
        npm install -g pnpm 2>&1 | Out-Null
        if (Get-Command pnpm -ErrorAction SilentlyContinue) {
            Add-Result 'Prerequisites' 'pnpm-fix' 'PASS' 'pnpm installed successfully'
        } else {
            Add-Result 'Prerequisites' 'pnpm-fix' 'FAIL' 'Could not install pnpm automatically'
        }
    }
} else {
    $pnpmVer = (pnpm --version 2>$null).Trim()
    Add-Result 'Prerequisites' 'pnpm-version' 'PASS' "pnpm $pnpmVer" "Path: $($pnpmCmd.Source)"
}

# Git (optional but useful)
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
    $gitVer = (git --version 2>$null) -replace 'git version ',''
    Add-Result 'Prerequisites' 'git' 'INFO' "git $gitVer (optional)"
} else {
    Add-Result 'Prerequisites' 'git' 'INFO' 'git not found (optional — not required to run Krythor)'
}

# =============================================================================
#  2. PROJECT STRUCTURE
# =============================================================================

Write-Section "2 · Project Structure"

$requiredFiles = @(
    @{ path = 'package.json';                        label = 'Root package.json' },
    @{ path = 'pnpm-workspace.yaml';                 label = 'pnpm workspace config' },
    @{ path = 'start.js';                            label = 'Launcher script' },
    @{ path = 'Krythor.bat';                         label = 'Windows launcher' },
    @{ path = 'Krythor-Setup.bat';                   label = 'Windows setup launcher' },
    @{ path = 'README.md';                           label = 'README' },
    @{ path = 'packages\core\package.json';          label = 'Package: core' },
    @{ path = 'packages\gateway\package.json';       label = 'Package: gateway' },
    @{ path = 'packages\memory\package.json';        label = 'Package: memory' },
    @{ path = 'packages\models\package.json';        label = 'Package: models' },
    @{ path = 'packages\guard\package.json';         label = 'Package: guard' },
    @{ path = 'packages\skills\package.json';        label = 'Package: skills' },
    @{ path = 'packages\setup\package.json';         label = 'Package: setup' },
    @{ path = 'packages\control\package.json';       label = 'Package: control (UI)' }
)

foreach ($f in $requiredFiles) {
    $full = Join-Path $root $f.path
    if (Test-Path $full) {
        Add-Result 'Structure' $f.label 'PASS' $f.label
    } else {
        Add-Result 'Structure' $f.label 'FAIL' "$($f.label) missing" "Expected: $full"
    }
}

# =============================================================================
#  3. BUILD ARTEFACTS
# =============================================================================

Write-Section "3 · Build Artefacts"

$buildFiles = @(
    @{ path = 'packages\gateway\dist\index.js';          label = 'gateway/dist' },
    @{ path = 'packages\core\dist\index.js';             label = 'core/dist' },
    @{ path = 'packages\memory\dist\index.js';           label = 'memory/dist' },
    @{ path = 'packages\models\dist\index.js';           label = 'models/dist' },
    @{ path = 'packages\guard\dist\index.js';            label = 'guard/dist' },
    @{ path = 'packages\setup\dist\bin\setup.js';        label = 'setup/dist' },
    @{ path = 'packages\control\dist\index.html';        label = 'control/dist (UI)' },
    @{ path = 'packages\control\dist\logo.png';          label = 'control/dist logo asset' }
)

$needsBuild = $false
foreach ($f in $buildFiles) {
    $full = Join-Path $root $f.path
    if (Test-Path $full) {
        $age = [int]((Get-Date) - (Get-Item $full).LastWriteTime).TotalHours
        $ageLabel = if ($age -lt 1) { 'just built' } elseif ($age -lt 24) { "${age}h ago" } else { "$([int]($age/24))d ago" }
        Add-Result 'Build' $f.label 'PASS' "$($f.label) — built $ageLabel"
        Write-Detail "  $full"
    } else {
        Add-Result 'Build' $f.label 'FAIL' "$($f.label) not found — run pnpm build"
        $needsBuild = $true
    }
}

if ($needsBuild -and $Fix) {
    Write-Info 'Missing build artefacts detected. Running pnpm install + pnpm build...'
    Push-Location $root
    pnpm install 2>&1 | Out-Null
    pnpm build 2>&1
    Pop-Location
    # Re-check after build
    foreach ($f in $buildFiles) {
        $full = Join-Path $root $f.path
        if (-not (Test-Path $full)) {
            Add-Result 'Build' "$($f.label)-fix" 'FAIL' "Still missing after build: $($f.label)"
        }
    }
}

# =============================================================================
#  4. DATA DIRECTORY & CONFIGURATION
# =============================================================================

Write-Section "4 · Configuration & Data"

# Data directory
if (Test-Path $dataDir) {
    Add-Result 'Config' 'data-dir' 'PASS' "Data directory exists: $dataDir"
} else {
    Add-Result 'Config' 'data-dir' 'WARN' "Data directory not found: $dataDir" 'Will be created on first run of setup wizard'
}

# Config files
$configFiles = @(
    @{ path = 'config\providers.json'; label = 'providers.json'; critical = $true  },
    @{ path = 'config\agents.json';    label = 'agents.json';    critical = $false },
    @{ path = 'config\app-config.json';label = 'app-config.json';critical = $false },
    @{ path = 'config\policy.json';    label = 'policy.json';    critical = $false },
    @{ path = 'config\chat-channels.json'; label = 'chat-channels.json'; critical = $false }
)

foreach ($f in $configFiles) {
    $full = Join-Path $dataDir $f.path
    if (Test-Path $full) {
        # Validate JSON
        try {
            $content = Get-Content $full -Raw
            $null = $content | ConvertFrom-Json
            $size = (Get-Item $full).Length
            Add-Result 'Config' $f.label 'PASS' "$($f.label) — valid JSON ($size bytes)"
            Write-Detail $full
        } catch {
            Add-Result 'Config' $f.label 'FAIL' "$($f.label) contains invalid JSON" $_.Exception.Message
        }
    } elseif ($f.critical) {
        Add-Result 'Config' $f.label 'WARN' "$($f.label) not found — run Krythor-Setup.bat first"
    } else {
        Add-Result 'Config' $f.label 'INFO' "$($f.label) not found (will be created on first run)"
    }
}

# Validate providers.json contents
$providersPath = Join-Path $dataDir 'config\providers.json'
if (Test-Path $providersPath) {
    try {
        $raw = Get-Content $providersPath -Raw | ConvertFrom-Json
        # Handle both flat array and wrapped { version, providers: [] } formats
        $providers = if ($raw -is [array]) { $raw } elseif ($raw.providers) { $raw.providers } else { @() }
        $count = @($providers).Count
        if ($count -eq 0) {
            Add-Result 'Config' 'providers-count' 'WARN' 'No AI providers configured — run setup or add one in the Models tab'
        } else {
            $defaultProvider = $providers | Where-Object { $_.isDefault -eq $true } | Select-Object -First 1
            $enabledCount = @($providers | Where-Object { $_.isEnabled -eq $true }).Count
            Add-Result 'Config' 'providers-count' 'PASS' "$count provider(s) configured, $enabledCount enabled"
            if ($defaultProvider) {
                Add-Result 'Config' 'providers-default' 'PASS' "Default provider: $($defaultProvider.name) ($($defaultProvider.type))"
                Write-Detail "  Endpoint: $($defaultProvider.endpoint)"
            } else {
                Add-Result 'Config' 'providers-default' 'WARN' 'No default provider set — select one in the Models tab'
            }
        }
    } catch {
        Add-Result 'Config' 'providers-parse' 'FAIL' 'Could not parse providers.json'
    }
}

# Validate agents.json
$agentsPath = Join-Path $dataDir 'config\agents.json'
if (Test-Path $agentsPath) {
    try {
        $agents = Get-Content $agentsPath -Raw | ConvertFrom-Json
        $agentCount = @($agents).Count
        Add-Result 'Config' 'agents-count' 'PASS' "$agentCount agent(s) defined"
        if ($Verbose) {
            foreach ($a in $agents) { Write-Detail "  Agent: $($a.name) (id: $($a.id))" }
        }
    } catch {
        Add-Result 'Config' 'agents-parse' 'FAIL' 'Could not parse agents.json'
    }
}

# Logs directory
if (Test-Path $logsDir) {
    $logFiles = Get-ChildItem $logsDir -Filter '*.log' -ErrorAction SilentlyContinue
    $logCount = @($logFiles).Count
    Add-Result 'Config' 'logs-dir' 'INFO' "Logs directory: $logCount log file(s) found at $logsDir"
} else {
    Add-Result 'Config' 'logs-dir' 'INFO' "Logs directory not yet created (normal on first run)"
}

# Guardrails: policy file present
$guardrailsPolicyPath = Join-Path $dataDir 'config\policy.json'
$guardrailsYamlPath = Join-Path $dataDir 'config\guardrails\policy.yaml'
if (Test-Path $guardrailsPolicyPath) {
    Add-Result 'Config' 'guardrails-policy' 'PASS' "Guardrails policy.json present"
} elseif (Test-Path $guardrailsYamlPath) {
    Add-Result 'Config' 'guardrails-policy' 'PASS' "Guardrails policy.yaml present at $guardrailsYamlPath"
} else {
    Add-Result 'Config' 'guardrails-policy' 'WARN' "No guardrails policy file found — using default allow policy"
}

# Guardrails: audit.ndjson file (created after guardrails events)
$auditNdjsonPath = Join-Path $logsDir 'audit.ndjson'
if (Test-Path $auditNdjsonPath) {
    $auditSize = (Get-Item $auditNdjsonPath).Length
    Add-Result 'Config' 'guardrails-audit-file' 'PASS' "audit.ndjson present ($auditSize bytes)"
} else {
    Add-Result 'Config' 'guardrails-audit-file' 'INFO' "audit.ndjson not yet created (created on first guardrails block event)"
}

# Memory DB
$dbPath = Join-Path $dataDir 'memory\memory.db'
if (Test-Path $dbPath) {
    $dbSize = [math]::Round((Get-Item $dbPath).Length / 1KB, 1)
    Add-Result 'Config' 'memory-db' 'PASS' "SQLite database: $dbSize KB at $dbPath"
} else {
    Add-Result 'Config' 'memory-db' 'INFO' 'Memory database not yet created (normal on first run)'
}

# =============================================================================
#  5. PORT & NETWORK
# =============================================================================

Write-Section "5 · Network & Gateway"

# Check if port is in use
$portInUse = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $ar  = $tcp.BeginConnect($host_, $port, $null, $null)
    $ok  = $ar.AsyncWaitHandle.WaitOne(500, $false)
    if ($ok -and $tcp.Connected) { $portInUse = $true }
    $tcp.Close()
} catch {}

if ($portInUse) {
    # Try to identify if it's Krythor
    try {
        $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/health" -TimeoutSec 3 -ErrorAction Stop
        if ($resp.status -eq 'ok' -and $resp.version) {
            Add-Result 'Network' 'gateway-running' 'PASS' "Krythor gateway is running (v$($resp.version))"
            Add-Result 'Network' 'gateway-url'     'INFO' "URL: http://${host_}:${port}"

            # Health detail
            if ($resp.memory) {
                Add-Result 'Network' 'gateway-memory' 'INFO' "Memory: $($resp.memory.entryCount) entries"
            }
            if ($resp.models) {
                $provCount = $resp.models.providerCount
                if ($provCount -eq 0) {
                    Add-Result 'Network' 'gateway-models' 'WARN' 'No AI providers registered in running gateway'
                } else {
                    Add-Result 'Network' 'gateway-models' 'PASS' "$provCount provider(s) loaded in gateway"
                }
            }
            if ($resp.agents) {
                Add-Result 'Network' 'gateway-agents' 'INFO' "$($resp.agents.agentCount) agent(s), $($resp.agents.activeRuns) active run(s)"
            }
            if ($resp.guard) {
                Add-Result 'Network' 'gateway-guard' 'INFO' "Guard: $($resp.guard.ruleCount) rules, default=$($resp.guard.defaultAction)"
            }
            if ($resp.nodeVersion) {
                Add-Result 'Network' 'gateway-node' 'INFO' "Gateway running on Node.js $($resp.nodeVersion)"
            }
        } else {
            Add-Result 'Network' 'gateway-running' 'WARN' "Port $port is in use but health check returned unexpected response"
        }
    } catch {
        Add-Result 'Network' 'gateway-running' 'WARN' "Port $port is in use by an unknown process (not Krythor)"
        Add-Result 'Network' 'port-conflict'   'FAIL' "Port $port conflict — Krythor will not start until this is resolved"
    }
} else {
    Add-Result 'Network' 'gateway-running' 'INFO' "Gateway is not currently running (start with Krythor.bat)"
}

# Ollama detection
$ollamaRunning = $false
foreach ($ollamaUrl in @("http://localhost:11434", "http://127.0.0.1:11434")) {
    try {
        $resp = Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -TimeoutSec 2 -ErrorAction Stop
        $modelCount = @($resp.models).Count
        Add-Result 'Network' 'ollama' 'PASS' "Ollama is running at $ollamaUrl — $modelCount model(s) available"
        if ($Verbose -and $resp.models) {
            foreach ($m in $resp.models) { Write-Detail "  Model: $($m.name)" }
        }
        $ollamaRunning = $true
        break
    } catch {}
}
if (-not $ollamaRunning) {
    Add-Result 'Network' 'ollama' 'INFO' 'Ollama not detected (optional — only needed for local models)'
}

# =============================================================================
#  6. DEPENDENCIES
# =============================================================================

Write-Section "6 · Dependencies"

$nodeModules = Join-Path $root 'node_modules'
if (Test-Path $nodeModules) {
    Add-Result 'Deps' 'node_modules' 'PASS' 'node_modules installed'
} else {
    Add-Result 'Deps' 'node_modules' 'FAIL' 'node_modules not found — run: pnpm install'
    if ($Fix) {
        Write-Info 'Running pnpm install...'
        Push-Location $root
        pnpm install
        Pop-Location
    }
}

# Check each package has its own node_modules or is resolved via root
$packages = @('core','gateway','memory','models','guard','skills','setup','control')
foreach ($pkg in $packages) {
    $pkgJson = Join-Path $root "packages\$pkg\package.json"
    if (Test-Path $pkgJson) {
        $pkgData = Get-Content $pkgJson -Raw | ConvertFrom-Json
        $distPath = Join-Path $root "packages\$pkg\dist"
        if (Test-Path $distPath) {
            Add-Result 'Deps' "pkg-$pkg" 'PASS' "@krythor/$pkg — dist present"
        } else {
            Add-Result 'Deps' "pkg-$pkg" 'WARN' "@krythor/$pkg — dist missing (run pnpm build)"
        }
        Write-Detail "  Version: $($pkgData.version)"
    }
}

# =============================================================================
#  7. TESTS
# =============================================================================

Write-Section "7 · Tests"

$testFiles = @(
    @{ path = 'packages\core\src\agents\AgentRegistry.test.ts';   label = 'core — AgentRegistry'   },
    @{ path = 'packages\memory\src\MemoryScorer.test.ts';          label = 'memory — MemoryScorer'  },
    @{ path = 'packages\models\src\ModelRouter.test.ts';           label = 'models — ModelRouter'   },
    @{ path = 'packages\guard\src\PolicyEngine.test.ts';           label = 'guard — PolicyEngine'   }
)

foreach ($f in $testFiles) {
    $full = Join-Path $root $f.path
    if (Test-Path $full) {
        Add-Result 'Tests' $f.label 'PASS' "Test file exists: $($f.label)"
    } else {
        Add-Result 'Tests' $f.label 'FAIL' "Test file missing: $($f.label)"
    }
}

# Optionally run tests
if ($Verbose -and (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Info 'Running test suite...'
    Push-Location $root
    $testOutput = pnpm test 2>&1
    Pop-Location
    $testLines = $testOutput -join "`n"
    if ($testLines -match 'Tests\s+(\d+)\s+passed') {
        Add-Result 'Tests' 'test-run' 'PASS' "Test suite passed: $($Matches[1]) tests"
    } elseif ($testLines -match 'failed') {
        Add-Result 'Tests' 'test-run' 'FAIL' 'Test suite has failures — run pnpm test for details'
    } else {
        Add-Result 'Tests' 'test-run' 'INFO' 'Could not parse test results — run pnpm test manually'
    }
}

# =============================================================================
#  7b. CHANNEL SYSTEM VALIDATION
# =============================================================================

Write-Section "7b · Channel System"

$chatChannelsFile = Join-Path $dataDir 'config\chat-channels.json'
if (Test-Path $chatChannelsFile) {
    try {
        $channels = Get-Content $chatChannelsFile -Raw | ConvertFrom-Json
        $channelCount = @($channels).Count
        Add-Result 'Channels' 'chat-channels-file' 'PASS' "chat-channels.json: $channelCount channel config(s)"
        foreach ($ch in $channels) {
            $status = $ch.status ?? $ch.lastHealthStatus ?? 'unknown'
            Add-Result 'Channels' "channel-$($ch.id)" 'INFO' "Channel: $($ch.id) ($($ch.type)) — status: $($ch.status ?? 'unknown')"
        }
    } catch {
        Add-Result 'Channels' 'chat-channels-file' 'WARN' 'chat-channels.json parse error'
    }
} else {
    Add-Result 'Channels' 'chat-channels-file' 'INFO' 'No chat channels configured yet (add via Chat Channels tab)'
}

# Access profiles
$accessProfilesFile = Join-Path $dataDir 'config\access-profiles.json'
if (Test-Path $accessProfilesFile) {
    try {
        $profiles = Get-Content $accessProfilesFile -Raw | ConvertFrom-Json
        # profiles is a dict of agentId -> profile
        $profileCount = ($profiles | Get-Member -MemberType NoteProperty).Count
        $fullAccessCount = 0
        foreach ($prop in ($profiles | Get-Member -MemberType NoteProperty)) {
            if ($profiles.$($prop.Name) -eq 'full_access') { $fullAccessCount++ }
        }
        Add-Result 'Channels' 'access-profiles' 'PASS' "Access profiles: $profileCount agent(s) configured"
        if ($fullAccessCount -gt 0) {
            Add-Result 'Channels' 'access-profiles-full' 'WARN' "$fullAccessCount agent(s) have full_access profile — review if intentional"
        }
    } catch {
        Add-Result 'Channels' 'access-profiles' 'INFO' 'access-profiles.json not yet created (defaults to safe)'
    }
} else {
    Add-Result 'Channels' 'access-profiles' 'INFO' 'No access profiles file (all agents default to safe profile)'
}

# =============================================================================
#  7c. LIVE API VALIDATION
# =============================================================================

Write-Section "7c · Live API Checks"

# Only run if gateway is reachable (reuse $portInUse from section 5)
if ($portInUse) {
    # Read auth token
    $appCfgPath = Join-Path $dataDir 'config\app-config.json'
    $authToken = $null
    if (Test-Path $appCfgPath) {
        try {
            $appCfg = Get-Content $appCfgPath -Raw | ConvertFrom-Json
            $authToken = $appCfg.gatewayToken
        } catch {}
    }

    if ($authToken) {
        $headers = @{ Authorization = "Bearer $authToken" }

        # Chat channels providers endpoint
        try {
            $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/api/chat-channels/providers" -Headers $headers -TimeoutSec 3 -ErrorAction Stop
            $count = @($resp.providers).Count
            Add-Result 'LiveAPI' 'chat-channels-providers' 'PASS' "/api/chat-channels/providers — $count provider(s) registered"
        } catch {
            Add-Result 'LiveAPI' 'chat-channels-providers' 'FAIL' "/api/chat-channels/providers failed: $($_.Exception.Message)"
        }

        # File audit endpoint
        try {
            $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/api/tools/files/audit" -Headers $headers -TimeoutSec 3 -ErrorAction Stop
            Add-Result 'LiveAPI' 'file-audit' 'PASS' "/api/tools/files/audit — $($resp.total) audit entries"
        } catch {
            Add-Result 'LiveAPI' 'file-audit' 'FAIL' "/api/tools/files/audit failed: $($_.Exception.Message)"
        }

        # Shell processes — expect 403 SHELL_DENIED for default safe profile
        try {
            $resp = Invoke-WebRequest -Uri "http://${host_}:${port}/api/tools/shell/processes" -Headers $headers -TimeoutSec 3 -ErrorAction Stop
            Add-Result 'LiveAPI' 'shell-enforcement' 'WARN' "/api/tools/shell/processes returned 200 — agent may have elevated profile"
        } catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($statusCode -eq 403) {
                Add-Result 'LiveAPI' 'shell-enforcement' 'PASS' "/api/tools/shell/processes correctly returns 403 for safe profile"
            } else {
                Add-Result 'LiveAPI' 'shell-enforcement' 'WARN' "/api/tools/shell/processes returned $statusCode (expected 403)"
            }
        }

        # Default agent access profile
        try {
            $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/api/agents/krythor-default/access-profile" -Headers $headers -TimeoutSec 3 -ErrorAction Stop
            $profile = $resp.profile
            if ($profile -eq 'full_access') {
                Add-Result 'LiveAPI' 'default-agent-profile' 'WARN' "Default agent has full_access profile — this is not the default, review if intentional"
            } else {
                Add-Result 'LiveAPI' 'default-agent-profile' 'PASS' "Default agent access profile: $profile"
            }
        } catch {
            Add-Result 'LiveAPI' 'default-agent-profile' 'INFO' "Could not check default agent profile: $($_.Exception.Message)"
        }

        # Guardrails: /api/audit endpoint
        try {
            $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/api/audit" -Headers $headers -TimeoutSec 3 -ErrorAction Stop
            $eventCount = if ($resp.total -ne $null) { $resp.total } else { @($resp.events).Count }
            Add-Result 'LiveAPI' 'guardrails-audit' 'PASS' "/api/audit responds — $eventCount event(s)"
        } catch {
            Add-Result 'LiveAPI' 'guardrails-audit' 'FAIL' "/api/audit failed: $($_.Exception.Message)"
        }

        # Guardrails: /api/approvals endpoint
        try {
            $resp = Invoke-RestMethod -Uri "http://${host_}:${port}/api/approvals" -Headers $headers -TimeoutSec 3 -ErrorAction Stop
            $pendingCount = if ($resp.count -ne $null) { $resp.count } else { @($resp.approvals).Count }
            Add-Result 'LiveAPI' 'guardrails-approvals' 'PASS' "/api/approvals responds — $pendingCount pending"
        } catch {
            Add-Result 'LiveAPI' 'guardrails-approvals' 'FAIL' "/api/approvals failed: $($_.Exception.Message)"
        }

        # Guardrails: unknown approval ID returns 404
        try {
            $null = Invoke-WebRequest -Uri "http://${host_}:${port}/api/approvals/nonexistent-validation-id/respond" `
                -Method POST `
                -Headers $headers `
                -ContentType 'application/json' `
                -Body '{"response":"deny"}' `
                -TimeoutSec 3 -ErrorAction Stop
            Add-Result 'LiveAPI' 'guardrails-approvals-404' 'WARN' "/api/approvals/:id/respond did not return error for unknown id"
        } catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($statusCode -eq 404) {
                Add-Result 'LiveAPI' 'guardrails-approvals-404' 'PASS' "/api/approvals/:id/respond returns 404 for unknown id"
            } else {
                Add-Result 'LiveAPI' 'guardrails-approvals-404' 'INFO' "/api/approvals/:id/respond returned $statusCode for unknown id"
            }
        }

    } else {
        Add-Result 'LiveAPI' 'auth-token' 'WARN' 'Could not read auth token from app-config.json — skipping authenticated checks'
    }
} else {
    Add-Result 'LiveAPI' 'gateway-offline' 'INFO' 'Gateway not running — skipping live API checks'
}

# =============================================================================
#  8. KNOWN ISSUES CHECK
# =============================================================================

Write-Section "8 · Known Issue Checks"

# Check package.json engines field vs actual runtime checks
$rootPkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$enginesNode = $rootPkg.engines.node
$nodeMajorRequired = [int](($enginesNode -replace '[^0-9]','').Substring(0, [Math]::Min(2, ($enginesNode -replace '[^0-9]','').Length)))
if ($nodeMajorRequired -ge 20) {
    Add-Result 'Issues' 'node-engines' 'PASS' "package.json engines.node: $enginesNode (correct)"
} else {
    Add-Result 'Issues' 'node-engines' 'WARN' "package.json engines.node is $enginesNode — consider updating to >=20"
}

# Check skills package is a stub
$skillsIndex = Join-Path $root 'packages\skills\src\index.ts'
if (Test-Path $skillsIndex) {
    $skillsContent = Get-Content $skillsIndex -Raw
    if ($skillsContent -match 'SKILLS_STUB') {
        Add-Result 'Issues' 'skills-stub' 'WARN' '@krythor/skills is a stub — tool execution not yet implemented'
    } else {
        Add-Result 'Issues' 'skills-stub' 'PASS' '@krythor/skills appears to have real implementation'
    }
}

# Check for stale nested Krythor directory
$staleDir = Join-Path $root 'Krythor'
if (Test-Path $staleDir) {
    Add-Result 'Issues' 'stale-nested-dir' 'WARN' "Stale nested Krythor\ directory found — safe to delete" "Path: $staleDir"
}

# Check control dist logo
$logoInDist = Join-Path $root 'packages\control\dist\logo.png'
if (-not (Test-Path $logoInDist)) {
    Add-Result 'Issues' 'logo-missing' 'WARN' 'Logo not in control/dist — rebuild UI with pnpm build'
} else {
    Add-Result 'Issues' 'logo-present' 'PASS' 'Logo asset present in UI dist'
}

# =============================================================================
#  SUMMARY
# =============================================================================

$total = $passCount + $failCount + $warnCount
Write-Host ""
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Results:  " -NoNewline
Write-Host "$passCount passed" -ForegroundColor Green -NoNewline
Write-Host "   " -NoNewline
if ($failCount -gt 0) {
    Write-Host "$failCount failed" -ForegroundColor Red -NoNewline
} else {
    Write-Host "$failCount failed" -ForegroundColor DarkGray -NoNewline
}
Write-Host "   " -NoNewline
if ($warnCount -gt 0) {
    Write-Host "$warnCount warnings" -ForegroundColor Yellow
} else {
    Write-Host "$warnCount warnings" -ForegroundColor DarkGray
}
Write-Host ""

if ($failCount -eq 0 -and $warnCount -eq 0) {
    Write-Host "  ✓ All checks passed — Krythor is healthy." -ForegroundColor Green
} elseif ($failCount -eq 0) {
    Write-Host "  ⚠ No failures, but $warnCount warning(s) to review." -ForegroundColor Yellow
} else {
    Write-Host "  ✗ $failCount check(s) failed. Run with -Fix to attempt auto-repair," -ForegroundColor Red
    Write-Host "    or review the failures above." -ForegroundColor Red
}

Write-Host ""

# Quick-fix hint
if ($failCount -gt 0 -and -not $Fix) {
    Write-Host "  Tip: Run  .\scripts\check.ps1 -Fix  to attempt automatic repairs." -ForegroundColor DarkCyan
    Write-Host ""
}

# =============================================================================
#  JSON OUTPUT
# =============================================================================

if ($Json) {
    $summary = @{
        timestamp  = (Get-Date -Format 'o')
        version    = '0.2.1'
        passed     = $passCount
        failed     = $failCount
        warnings   = $warnCount
        results    = $results
    }
    $summary | ConvertTo-Json -Depth 5
}

# Exit code: 0 = all good, 1 = failures, 2 = warnings only
if ($failCount -gt 0) { exit 1 }
if ($warnCount -gt 0) { exit 2 }
exit 0
