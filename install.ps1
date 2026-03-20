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
#
#  No Node.js required — the bundled runtime is included in the zip.
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
  # Kill Krythor's bundled node.exe by exact path using WMIC (avoids MainModule access errors)
  $nodePath = Join-Path $InstallDir 'runtime\node.exe'
  if (Test-Path $nodePath) {
    Write-Warn "Stopping running Krythor processes..."
    $wmicPath = $nodePath.Replace('\', '\\')
    & wmic process where "ExecutablePath='$wmicPath'" delete 2>&1 | Out-Null
    Start-Sleep -Milliseconds 1000
  }
  # cmd rd /s /q bypasses PowerShell's file-lock errors on .node binaries
  & cmd /c "rd /s /q `"$InstallDir`"" 2>&1 | Out-Null
  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir -ErrorAction Stop
  }
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

# ── Verify bundled Node runtime ───────────────────────────────────────────────
$BundledNode = Join-Path $InstallDir 'runtime\node.exe'
if (Test-Path $BundledNode) {
  Write-Step "Verifying bundled Node runtime..."
  try {
    $nodeVer = & $BundledNode --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "node --version returned exit code $LASTEXITCODE" }
    Write-Ok "Bundled runtime: $nodeVer"
  } catch {
    Write-Warn "Bundled Node runtime check failed: $_"
    Write-Warn "Krythor may not start correctly. Try re-downloading the installer."
  }
} else {
  Write-Warn "Bundled Node runtime not found at: $BundledNode"
  Write-Warn "The release zip may be incomplete. Try re-downloading."
}

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
"%~dp0runtime\node.exe" "%~dp0start.js" %*
'@
Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII
Write-Ok "Launcher created: krythor.bat"

# ── Add to user PATH ──────────────────────────────────────────────────────────
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable('PATH', "$userPath;$InstallDir", 'User')
  Write-Ok "Added to PATH — the 'krythor' command will work in new terminal windows"
}

# ── Rebuild better-sqlite3 against the bundled Node runtime ──────────────────
# The precompiled .node binary was built in CI against the bundled Node ABI.
# On a fresh install this should already be correct. The rebuild step here is
# a safety net in case the user installs a different zip or updates node-gyp.
$sqliteDir = Join-Path $InstallDir 'node_modules\better-sqlite3'
if ((Test-Path $sqliteDir) -and (Test-Path $BundledNode)) {
  Write-Host ""
  Write-Step "Compiling database module against bundled Node runtime..."
  try {
    Push-Location $sqliteDir
    $NodeGyp = Join-Path $sqliteDir 'node_modules\.bin\node-gyp'
    if (Test-Path $NodeGyp) {
      $rebuildOutput = & $BundledNode $NodeGyp rebuild 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-Ok "Database module compiled successfully"
      } else {
        Write-Warn "Could not compile database module automatically."
        Write-Host "  Output: $rebuildOutput" -ForegroundColor Yellow
        Write-Host "  The prebuilt binary from CI will be used instead." -ForegroundColor White
        Write-Host "  If Krythor fails to start, run: krythor repair" -ForegroundColor White
      }
    } else {
      Write-Warn "node-gyp not found in better-sqlite3 — skipping rebuild. CI binary will be used."
    }
  } catch {
    Write-Warn "Could not compile database module: $_"
  } finally {
    Pop-Location
  }
}

# ── Startup health check ──────────────────────────────────────────────────────
Write-Host ""
Write-Step "Running startup health check..."
if (Test-Path $BundledNode) {
  # Verify better-sqlite3 loads under the bundled Node
  try {
    $result = & $BundledNode -e "require('./node_modules/better-sqlite3')" 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "better-sqlite3 loads correctly"
    } else {
      Write-Warn "better-sqlite3 failed to load: $result"
      Write-Host "  Try running: krythor repair" -ForegroundColor White
    }
  } catch {
    Write-Warn "Health check failed: $_"
  }
}

# ── Run first-time setup wizard ───────────────────────────────────────────────
$setupScript = Join-Path $InstallDir 'packages\setup\dist\bin\setup.js'
if ((Test-Path $setupScript) -and -not $UpdateMode) {
  Write-Host ""
  Write-Step "Running first-time setup..."
  Write-Host ""
  try {
    if (Test-Path $BundledNode) {
      & $BundledNode $setupScript
    } else {
      & node $setupScript
    }
  } catch {
    Write-Warn "Setup wizard had an issue — you can run it later with: krythor setup"
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
