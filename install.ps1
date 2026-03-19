# ============================================================
#  Krythor — One-line installer (Windows PowerShell)
#  Usage: iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex
#
#  Installs to: $env:USERPROFILE\.krythor\
#  Creates: krythor.bat in install directory
# ============================================================
$ErrorActionPreference = 'Stop'

$Repo       = 'LuxaGrid/Krythor'
$InstallDir = Join-Path $env:USERPROFILE '.krythor'
$ApiUrl     = "https://api.github.com/repos/$Repo/releases/latest"

function Write-Step  { param($msg) Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  [X]  $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  KRYTHOR - Installer" -ForegroundColor Cyan
Write-Host "  https://github.com/$Repo"
Write-Host ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
Write-Step "Checking Node.js..."
try {
  $nodeVersion = & node --version 2>&1
  if ($LASTEXITCODE -ne 0) { throw "node not found" }
  $nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*','$1')
  if ($nodeMajor -lt 20) {
    Write-Fail "Node.js 20+ required. You have $nodeVersion. Update at https://nodejs.org"
  }
  Write-Ok "Node.js $nodeVersion"
} catch {
  Write-Fail "Node.js is not installed. Install it from https://nodejs.org (version 20+)"
}

# ── Fetch latest release ──────────────────────────────────────────────────────
Write-Step "Checking latest release..."
try {
  $headers = @{ 'User-Agent' = 'Krythor-Installer' }
  $release = Invoke-RestMethod -Uri $ApiUrl -Headers $headers
} catch {
  Write-Fail "Could not reach GitHub API: $_"
}

$version = $release.tag_name

# Prefer the Windows-specific asset; fall back to any zip if not found
$zipAsset = $release.assets | Where-Object { $_.name -eq 'krythor-win-x64.zip' } | Select-Object -First 1
if (-not $zipAsset) {
  Write-Warn "Platform asset 'krythor-win-x64.zip' not found — falling back to first zip."
  $zipAsset = $release.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
}
$zipUrl = $zipAsset.browser_download_url

if (-not $version -or -not $zipUrl) {
  Write-Fail "No zip release found at https://github.com/$Repo/releases"
}
Write-Ok "Found release: $version"

# ── Check for existing install ────────────────────────────────────────────────
if (Test-Path $InstallDir) {
  Write-Host ""
  Write-Warn "Krythor is already installed at: $InstallDir"
  $confirm = Read-Host "   Overwrite with $version? [y/N]"
  if ($confirm -notmatch '^[Yy]$') {
    Write-Host "  Aborted." -ForegroundColor Yellow
    exit 0
  }
  Write-Step "Removing existing install..."
  Remove-Item -Recurse -Force $InstallDir
}

# ── Download ──────────────────────────────────────────────────────────────────
$tmpDir = Join-Path $env:TEMP "krythor-install-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir | Out-Null
$tmpZip = Join-Path $tmpDir 'krythor.zip'

Write-Step "Downloading $version..."
try {
  Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing
} catch {
  Write-Fail "Download failed: $_"
}

if (-not (Test-Path $tmpZip) -or (Get-Item $tmpZip).Length -eq 0) {
  Write-Fail "Downloaded file is empty or missing."
}
Write-Ok "Downloaded"

# ── Extract ───────────────────────────────────────────────────────────────────
Write-Step "Extracting..."
$extractDir = Join-Path $tmpDir 'extracted'
Expand-Archive -Path $tmpZip -DestinationPath $extractDir -Force

# Handle single top-level folder in zip
$entries = Get-ChildItem $extractDir
if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $entries[0].FullName '*') -Destination $InstallDir -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $extractDir '*') -Destination $InstallDir -Recurse -Force
}

Remove-Item -Recurse -Force $tmpDir
Write-Ok "Installed to: $InstallDir"

# ── Create launch batch file ──────────────────────────────────────────────────
$launcherPath = Join-Path $InstallDir 'krythor.bat'
$launcherContent = @"
@echo off
node "%~dp0start.js" %*
"@
Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII
Write-Ok "Created launcher: krythor.bat"

# ── Add to user PATH (optional, non-destructive) ──────────────────────────────
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable('PATH', "$userPath;$InstallDir", 'User')
  Write-Ok "Added to PATH (takes effect in new terminal sessions)"
}

# ── Run setup wizard ──────────────────────────────────────────────────────────
Write-Host ""
Write-Step "Running setup wizard..."
Write-Host ""
$setupScript = Join-Path $InstallDir 'packages\setup\dist\bin\setup.js'
if (Test-Path $setupScript) {
  try { & node $setupScript } catch { Write-Warn "Setup wizard encountered an error — run it manually later." }
} else {
  Write-Warn "Setup script not found — run Krythor-Setup.bat manually."
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Krythor $version installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  To launch Krythor:"
Write-Host "    $launcherPath" -ForegroundColor White
Write-Host ""
Write-Host "  Or from any new terminal (after PATH update takes effect):"
Write-Host "    krythor" -ForegroundColor White
Write-Host ""
Write-Host "  Then open: http://localhost:47200"
Write-Host ""
