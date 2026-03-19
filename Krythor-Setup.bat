@echo off
setlocal

:: ============================================================
::  KRYTHOR — Setup Wizard
::  Run this once after installing Krythor to configure
::  your AI provider and create your first agent.
:: ============================================================
echo.
echo ========================================
echo  KRYTHOR - Setup Wizard
echo ========================================
echo.

:: ── Check Node.js is installed ──────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed on this computer.
    echo.
    echo Please install Node.js ^(version 20 or higher^) from:
    echo   https://nodejs.org
    echo.
    echo After installing Node.js, run this file again.
    echo ========================================
    echo Press any key to open the Node.js website...
    pause >nul
    start "" "https://nodejs.org/en/download"
    exit /b 1
)

:: ── Check Node.js version >= 20 ─────────────────────────────
for /f "tokens=1 delims=v." %%i in ('node --version') do set NODE_MAJOR=%%i
if %NODE_MAJOR% lss 20 (
    echo ERROR: Krythor requires Node.js version 20 or higher.
    echo You have version %NODE_MAJOR%. Please update from:
    echo   https://nodejs.org
    echo ========================================
    echo Press any key to open the Node.js website...
    pause >nul
    start "" "https://nodejs.org/en/download"
    exit /b 1
)

:: ── Check if setup package is built ─────────────────────────
if not exist "%~dp0packages\setup\dist\bin\setup.js" (
    where pnpm >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo ERROR: pnpm is not installed.
        echo.
        echo Install pnpm by running this command in a terminal:
        echo   npm install -g pnpm
        echo.
        echo Then run this file again.
        echo ========================================
        pause
        exit /b 1
    )
    echo Building Krythor ^(this takes about 30 seconds^)...
    echo.
    pushd "%~dp0"
    call pnpm install
    if %ERRORLEVEL% neq 0 (
        echo ERROR: pnpm install failed. Check the output above for details.
        pause
        exit /b 1
    )
    call pnpm build
    if %ERRORLEVEL% neq 0 (
        echo ERROR: pnpm build failed. Check the output above for details.
        pause
        exit /b 1
    )
    popd
    echo Build complete!
    echo.
)

:: ── Run setup wizard ─────────────────────────────────────────
echo This wizard will configure your AI provider and create your first agent.
echo You can re-run it any time to change providers or reset configuration.
echo.
node "%~dp0packages\setup\dist\bin\setup.js" %*
