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

$OldInstallDir = $null
if (Test-Path $InstallDir) {
  Write-Step "Removing old version..."
  # Windows cannot delete a locked .node DLL — but it CAN rename the directory.
  # Rename the old install out of the way, install fresh into $InstallDir,
  # then clean up the renamed directory in the background after the process exits.
  $OldInstallDir = "$InstallDir-old-$(Get-Random)"
  try {
    Rename-Item -Path $InstallDir -NewName $OldInstallDir -ErrorAction Stop
    Write-Ok "Old version moved aside (will be cleaned up on next reboot or manually)"
  } catch {
    Write-Fail "Could not move old install directory. Close Krythor and try again. Error: $_"
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

# ── Verify native module loads under bundled runtime ─────────────────────────
# CI rebuilds better-sqlite3 against the bundled Node before packaging,
# so the prebuilt binary in the zip is already correct — no rebuild needed here.

# ── Startup health check ──────────────────────────────────────────────────────
Write-Host ""
Write-Step "Running startup health check..."
if (Test-Path $BundledNode) {
  # Verify better-sqlite3 loads under the bundled Node
  # Must run from $InstallDir so require('./node_modules/...') resolves correctly
  try {
    Push-Location $InstallDir
    $result = & $BundledNode -e "require('./node_modules/better-sqlite3')" 2>&1
    Pop-Location
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "better-sqlite3 loads correctly"
    } else {
      Write-Warn "better-sqlite3 failed to load."
      Write-Host "  Error: $result" -ForegroundColor Yellow
      # Check if the .node binary exists at all
      $nodeBin = Join-Path $InstallDir 'node_modules\better-sqlite3\build\Release\better_sqlite3.node'
      if (-not (Test-Path $nodeBin)) {
        Write-Warn "Native binary not found: $nodeBin"
        Write-Host "  The release zip may be missing the prebuilt binary." -ForegroundColor White
      }
      Write-Host "  Krythor may not start. Try: krythor repair" -ForegroundColor White
    }
  } catch {
    Pop-Location -ErrorAction SilentlyContinue
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
# ── Clean up renamed old install (best-effort, may still be locked) ──────────
if ($OldInstallDir -and (Test-Path $OldInstallDir)) {
  try {
    Remove-Item -Recurse -Force $OldInstallDir -ErrorAction Stop
    Write-Ok "Old version cleaned up"
  } catch {
    # The .node binary may still be locked if the old Krythor process didn't exit.
    # Schedule deletion on next reboot via cmd /c rd in a detached process.
    Start-Process -FilePath 'cmd.exe' `
      -ArgumentList "/c timeout /t 5 /nobreak >nul & rd /s /q `"$OldInstallDir`"" `
      -WindowStyle Hidden -ErrorAction SilentlyContinue
    Write-Warn "Old version will be cleaned up automatically in a few seconds."
  }
}

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
