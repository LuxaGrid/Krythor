# ============================================================
#  Krythor — One-line installer (Windows PowerShell)
#
#  Install:
#    iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex
#
#  Update (after install):
#    krythor update
#
#  Installs to: $env:USERPROFILE\.krythor\
#  Creates command: krythor  (added to user PATH)
# ============================================================
$ErrorActionPreference = 'Stop'

$Repo       = 'LuxaGrid/Krythor'
$InstallDir = Join-Path $env:USERPROFILE '.krythor'
$ApiUrl     = "https://api.github.com/repos/$Repo/releases/latest"

# Update mode: set by the krythor.bat launcher when user runs "krythor update"
$UpdateMode = $env:KRYTHOR_UPDATE -eq '1'

function Write-Step { param($msg) Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Fail {
  param($msg)
  Write-Host ""
  Write-Host "  [ERROR] $msg" -ForegroundColor Red
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "  KRYTHOR - Installer" -ForegroundColor Cyan
Write-Host "  https://github.com/$Repo"
Write-Host ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
Write-Step "Checking Node.js..."
try {
  $nodeVersion = & node --version 2>&1
  if ($LASTEXITCODE -ne 0) { throw "node not found" }
  $nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
  if ($nodeMajor -lt 20) {
    Write-Host ""
    Write-Host "  Node.js 20 or higher is required." -ForegroundColor Red
    Write-Host "  You have: $nodeVersion"
    Write-Host "  Download the free LTS version from: https://nodejs.org"
    Write-Host "  Install it, then run this command again."
    exit 1
  }
  Write-Ok "Node.js $nodeVersion"
} catch {
  Write-Host ""
  Write-Host "  Node.js is not installed." -ForegroundColor Red
  Write-Host ""
  Write-Host "  Krythor needs Node.js to run." -ForegroundColor White
  Write-Host "  1. Go to https://nodejs.org" -ForegroundColor White
  Write-Host "  2. Click 'Download LTS'" -ForegroundColor White
  Write-Host "  3. Install it (just click Next through the installer)" -ForegroundColor White
  Write-Host "  4. Close this window, open a new PowerShell, and run the install command again." -ForegroundColor White
  Write-Host ""
  exit 1
}

# ── Fetch latest release ──────────────────────────────────────────────────────
Write-Step "Checking latest version..."
try {
  $headers = @{ 'User-Agent' = 'Krythor-Installer/1.0' }
  $release = Invoke-RestMethod -Uri $ApiUrl -Headers $headers -ErrorAction Stop
} catch {
  Write-Fail "Could not reach GitHub to check for the latest version. Check your internet connection and try again."
}

$version  = $release.tag_name
$zipAsset = $release.assets | Where-Object { $_.name -eq 'krythor-win-x64.zip' } | Select-Object -First 1

if (-not $zipAsset) {
  Write-Warn "Windows asset 'krythor-win-x64.zip' not found in this release — trying any zip."
  $zipAsset = $release.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
}

if (-not $version) {
  Write-Fail "Could not determine the latest version. Check: https://github.com/$Repo/releases"
}
if (-not $zipAsset) {
  Write-Fail "No release file found. Check: https://github.com/$Repo/releases"
}

$zipUrl = $zipAsset.browser_download_url
Write-Ok "Latest version: $version"

# ── Check for existing install ────────────────────────────────────────────────
if ((Test-Path $InstallDir) -and -not $UpdateMode) {
  Write-Host ""
  Write-Warn "Krythor is already installed at: $InstallDir"
  Write-Host "  Your settings, memory, and saved data are stored separately and will not be deleted." -ForegroundColor White
  $confirm = Read-Host "  Install $version over existing version? [y/N]"
  if ($confirm -notmatch '^[Yy]$') {
    Write-Host "  Cancelled." -ForegroundColor Yellow
    exit 0
  }
}

if (Test-Path $InstallDir) {
  Write-Step "Removing old version..."
  Remove-Item -Recurse -Force $InstallDir
}

# ── Download ──────────────────────────────────────────────────────────────────
$tmpDir = Join-Path $env:TEMP "krythor-install-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir | Out-Null
$tmpZip = Join-Path $tmpDir 'krythor.zip'

Write-Host ""
Write-Host "  Downloading Krythor $version..." -ForegroundColor Green
try {
  Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing -ErrorAction Stop
} catch {
  Write-Fail "Download failed. Check your internet connection and try again. Error: $_"
}

if (-not (Test-Path $tmpZip) -or (Get-Item $tmpZip).Length -eq 0) {
  Write-Fail "Downloaded file is empty. Please try again."
}
Write-Ok "Downloaded"

# ── Extract ───────────────────────────────────────────────────────────────────
Write-Host "  Installing..." -ForegroundColor Green
$extractDir = Join-Path $tmpDir 'extracted'
try {
  Expand-Archive -Path $tmpZip -DestinationPath $extractDir -Force
} catch {
  Write-Fail "Could not extract the downloaded file. Error: $_"
}

# Handle single top-level folder inside the zip
$entries = Get-ChildItem $extractDir
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
  Copy-Item -Path (Join-Path $entries[0].FullName '*') -Destination $InstallDir -Recurse -Force
} else {
  Copy-Item -Path (Join-Path $extractDir '*') -Destination $InstallDir -Recurse -Force
}

Remove-Item -Recurse -Force $tmpDir
Write-Ok "Files installed to: $InstallDir"

# ── Create launcher batch file ────────────────────────────────────────────────
$launcherPath = Join-Path $InstallDir 'krythor.bat'
$launcherContent = @'
@echo off
:: Krythor launcher — generated by installer
if "%1"=="update" (
  echo Checking for Krythor updates...
  set KRYTHOR_UPDATE=1
  powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex"
  exit /b 0
)
node "%~dp0start.js" %*
'@
Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII
Write-Ok "Launcher created: krythor.bat"

# ── Add to user PATH ──────────────────────────────────────────────────────────
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable('PATH', "$userPath;$InstallDir", 'User')
  Write-Ok "Added to PATH — the 'krythor' command will work in new terminal windows"
}

# ── Run first-time setup wizard ───────────────────────────────────────────────
$setupScript = Join-Path $InstallDir 'packages\setup\dist\bin\setup.js'
if ((Test-Path $setupScript) -and -not $UpdateMode) {
  Write-Host ""
  Write-Step "Running first-time setup..."
  Write-Host ""
  try {
    & node $setupScript
  } catch {
    Write-Warn "Setup wizard had an issue — you can run it later with: node `"$setupScript`""
  }
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Krythor $version is ready." -ForegroundColor Green
Write-Host ""
Write-Host "  To start Krythor, run:" -ForegroundColor White
Write-Host "    krythor" -ForegroundColor Cyan
Write-Host ""
Write-Host "  (Open a new terminal window first so the PATH update takes effect.)" -ForegroundColor Gray
Write-Host ""
Write-Host "  After starting, open your browser to:" -ForegroundColor White
Write-Host "    http://localhost:47200" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To update Krythor later:" -ForegroundColor White
Write-Host "    krythor update" -ForegroundColor Cyan
Write-Host ""
