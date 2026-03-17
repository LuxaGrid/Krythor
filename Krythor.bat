@echo off
setlocal

:: ============================================================
::  KRYTHOR — Launcher
::  https://github.com/krythor
:: ============================================================

:: ── Check Node.js is installed ──────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo ========================================
    echo  KRYTHOR - Missing Requirement
    echo ========================================
    echo Node.js is not installed on this computer.
    echo.
    echo Please install Node.js ^(version 18 or higher^) from:
    echo   https://nodejs.org
    echo.
    echo After installing Node.js, run this file again.
    echo ========================================
    echo Press any key to open the Node.js website...
    pause >nul
    start "" "https://nodejs.org/en/download"
    exit /b 1
)

:: ── Check Node.js version >= 18 ─────────────────────────────
for /f "tokens=1 delims=v." %%i in ('node --version') do set NODE_MAJOR=%%i
if %NODE_MAJOR% lss 18 (
    echo.
    echo ========================================
    echo  KRYTHOR - Node.js Version Too Old
    echo ========================================
    echo Krythor requires Node.js version 18 or higher.
    echo You have version %NODE_MAJOR%. Please update from:
    echo   https://nodejs.org
    echo ========================================
    echo Press any key to open the Node.js website...
    pause >nul
    start "" "https://nodejs.org/en/download"
    exit /b 1
)

:: ── Check if gateway is built ────────────────────────────────
if not exist "%~dp0packages\gateway\dist\index.js" (
    :: Not built yet — check for pnpm
    where pnpm >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo.
        echo ========================================
        echo  KRYTHOR - Missing Requirement
        echo ========================================
        echo pnpm is not installed.
        echo.
        echo Install pnpm by running this command in a terminal:
        echo   npm install -g pnpm
        echo.
        echo Then run this file again.
        echo ========================================
        pause
        exit /b 1
    )
    echo.
    echo First run detected -- building Krythor ^(this takes about 30 seconds^)...
    echo.
    pushd "%~dp0"
    call pnpm install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo ERROR: pnpm install failed. Check the output above for details.
        pause
        exit /b 1
    )
    call pnpm build
    if %ERRORLEVEL% neq 0 (
        echo.
        echo ERROR: pnpm build failed. Check the output above for details.
        pause
        exit /b 1
    )
    popd
    echo.
    echo Build complete!
    echo.
)

:: ── Launch ───────────────────────────────────────────────────
node "%~dp0start.js" %*
