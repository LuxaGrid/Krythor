#!/usr/bin/env node
/**
 * Krythor Bundle Script
 *
 * Prepares a self-contained distribution folder (krythor-dist/) that can be
 * zipped and shared with users who have Node.js 20+ installed.
 *
 * What it does:
 *   1. Verifies the build exists (pnpm build must have run first)
 *   2. Creates krythor-dist/ with all required runtime files
 *   3. Copies launcher scripts and entry points
 *   4. Writes a minimal package.json for the dist folder
 *   5. Prints a clear summary of what to ship
 *
 * Usage: node bundle.js
 *
 * The resulting krythor-dist/ folder is the only thing users need.
 * They do NOT need pnpm — only Node.js 20+.
 */

const { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, statSync } = require('fs');
const { join, resolve } = require('path');
const { execSync } = require('child_process');

const ROOT    = __dirname;
const DISTDIR = join(ROOT, 'krythor-dist');

const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

function ok(msg)   { console.log(`${GREEN}✓${RESET} ${msg}`); }
function err(msg)  { console.error(`${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`${DIM}  ${msg}${RESET}`); }
function head(msg) { console.log(`\n${CYAN}${msg}${RESET}`); }

function copy(src, dest, opts = {}) {
  if (!existsSync(src)) {
    if (opts.optional) return;
    err(`Required path not found: ${src}`);
    process.exit(1);
  }
  // Resolve symlinks before copying — pnpm stores packages as symlinks on Windows
  const { realpathSync } = require('fs');
  const realSrc = (() => { try { return realpathSync(src); } catch { return src; } })();
  mkdirSync(join(DISTDIR, dest, '..'), { recursive: true });
  cpSync(realSrc, join(DISTDIR, dest), { recursive: true, ...opts });
}

async function main() {
  console.log(`\n${CYAN}  KRYTHOR — Bundle${RESET}`);
  console.log(`${DIM}  Building a self-contained distribution folder…${RESET}\n`);

  // ── Preflight ──────────────────────────────────────────────────────────────
  const gatewayDist = join(ROOT, 'packages', 'gateway', 'dist', 'index.js');
  if (!existsSync(gatewayDist)) {
    err('Gateway not built. Run: pnpm build');
    process.exit(1);
  }

  // ── Clean output dir ───────────────────────────────────────────────────────
  if (existsSync(DISTDIR)) {
    cpSync(DISTDIR, DISTDIR + '.old', { recursive: true });
    require('fs').rmSync(DISTDIR, { recursive: true, force: true });
    require('fs').rmSync(DISTDIR + '.old', { recursive: true, force: true });
  }
  mkdirSync(DISTDIR, { recursive: true });
  head('Copying built packages');

  // ── Copy built package dist folders ───────────────────────────────────────
  const pkgs = ['gateway', 'setup', 'memory', 'models', 'core', 'guard', 'skills'];
  for (const pkg of pkgs) {
    const src = join(ROOT, 'packages', pkg, 'dist');
    if (existsSync(src)) {
      copy(src, join('packages', pkg, 'dist'));
      ok(`packages/${pkg}/dist`);
    }
  }

  // ── Copy migration SQL files (not compiled — runtime-loaded) ───────────────
  head('Copying runtime assets');
  const migrSrc = join(ROOT, 'packages', 'memory', 'src', 'db', 'migrations');
  if (existsSync(migrSrc)) {
    copy(migrSrc, join('packages', 'memory', 'dist', 'migrations'));
    ok('migrations SQL files');
  }

  // ── Copy only better-sqlite3 runtime files (all JS deps are bundled inline) ─
  // All JS dependencies are inlined into each package's dist/index.js by tsup.
  // Only better-sqlite3 must remain external — it ships a native .node addon.
  // Runtime needs: lib/ (JS wrapper), package.json, build/Release/better_sqlite3.node only.
  // All build artifacts (.pdb, .iobj, obj/, deps/, src/) are excluded.
  head('Copying native bindings (better-sqlite3 only)');
  const { realpathSync: rps, copyFileSync } = require('fs');
  const sqliteNm = join(ROOT, 'node_modules', 'better-sqlite3');
  if (existsSync(sqliteNm)) {
    const realSqlite = (() => { try { return rps(sqliteNm); } catch { return sqliteNm; } })();
    // lib/ and package.json
    for (const sub of ['lib', 'package.json']) {
      const subSrc = join(realSqlite, sub);
      if (existsSync(subSrc)) {
        const subDest = join(DISTDIR, 'node_modules', 'better-sqlite3', sub);
        mkdirSync(join(subDest, '..'), { recursive: true });
        cpSync(subSrc, subDest, { recursive: true });
      }
    }
    // Only the compiled .node binary from build/Release/
    const nodeBin = join(realSqlite, 'build', 'Release', 'better_sqlite3.node');
    if (existsSync(nodeBin)) {
      const binDest = join(DISTDIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
      mkdirSync(join(binDest, '..'), { recursive: true });
      copyFileSync(nodeBin, binDest);
    }
    ok('node_modules/better-sqlite3 (runtime only: lib + .node binary)');
  }
  // better-sqlite3 sub-deps: bindings and file-uri-to-path
  for (const dep of ['bindings', 'file-uri-to-path']) {
    const depSrc = join(ROOT, 'node_modules', dep);
    if (existsSync(depSrc)) {
      copy(depSrc, join('node_modules', dep));
      ok(`node_modules/${dep}`);
    }
  }

  // ── Copy launcher files ────────────────────────────────────────────────────
  head('Copying launcher files');
  const launchers = [
    ['start.js',             'start.js'],
    ['Krythor.bat',          'Krythor.bat'],
    ['Krythor-Setup.bat',    'Krythor-Setup.bat'],
    ['install.sh',           'install.sh'],
    ['install.ps1',          'install.ps1'],
    ['CHANGELOG.md',         'CHANGELOG.md'],
  ];
  for (const [src, dest] of launchers) {
    const srcPath = join(ROOT, src);
    if (existsSync(srcPath)) {
      cpSync(srcPath, join(DISTDIR, dest));
      ok(dest);
    }
  }

  // ── Optional: include pre-built SEA executable if it exists ──────────────
  const exeSrc = join(ROOT, 'krythor.exe');
  if (existsSync(exeSrc)) {
    cpSync(exeSrc, join(DISTDIR, 'krythor.exe'));
    ok('krythor.exe (SEA executable)');
    // Also copy node.exe alongside it for gateway spawning
    cpSync(process.execPath, join(DISTDIR, 'node.exe'));
    ok('node.exe (required for gateway spawning)');
  }

  // ── Write a minimal package.json for the dist folder ──────────────────────
  head('Writing dist package.json');
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const distPkg = {
    name:        'krythor',
    version:     rootPkg.version,
    description: rootPkg.description,
    engines:     rootPkg.engines,
    scripts: {
      start:  'node start.js',
      setup:  'node packages/setup/dist/bin/setup.js',
      doctor: 'node packages/setup/dist/bin/setup.js doctor',
    },
  };
  writeFileSync(join(DISTDIR, 'package.json'), JSON.stringify(distPkg, null, 2));
  ok('package.json');

  // ── Write a README for the dist folder ────────────────────────────────────
  head('Writing INSTALL.txt');
  const installTxt = `KRYTHOR — Local-first AI command platform
Version: ${rootPkg.version}

REQUIREMENTS
  - Node.js 20 or higher  (https://nodejs.org)
  - That's it. No pnpm, no cloud accounts required.

INSTALL — Windows
  1. Extract this folder anywhere on your computer.
  2. Double-click  Krythor-Setup.bat  to configure your AI provider.
  3. Double-click  Krythor.bat  to launch.

WINDOWS SECURITY NOTE
  If Windows shows "Windows protected your PC" when running Krythor.bat:
  1. Click "More info"
  2. Click "Run anyway"
  This is normal for software that has not been code-signed.
  Krythor is open source and runs entirely on your local machine.

INSTALL — macOS / Linux
  1. Extract this folder anywhere on your computer.
  2. Run:  node packages/setup/dist/bin/setup.js
  3. Run:  node start.js

COMMANDS (from this folder)
  node start.js                              — launch gateway + open browser
  node packages/setup/dist/bin/setup.js     — run setup wizard
  node packages/setup/dist/bin/setup.js doctor  — run diagnostics

YOUR DATA
  All data is stored in your user profile — NOT in this folder.
  Windows:  %LOCALAPPDATA%\\Krythor\\
  macOS:    ~/Library/Application Support/Krythor/
  Linux:    ~/.local/share/krythor/

UNINSTALL
  Delete this folder.
  Delete the data folder above if you want to remove all settings and history.
`;
  writeFileSync(join(DISTDIR, 'INSTALL.txt'), installTxt);
  ok('INSTALL.txt');

  // ── Write RELEASE-NOTES.txt ────────────────────────────────────────────────
  head('Writing RELEASE-NOTES.txt');
  const releaseNotes = `Krythor v${rootPkg.version} — Release Notes

Highlights:
- Local-first AI command platform
- Multi-provider model routing with automatic fallback
- Agent system with persistent memory
- Skills framework and guard engine
- Transparent execution (see which model ran and why)
- Heartbeat monitoring
- Windows installer (Krythor-Setup-${rootPkg.version}.exe)
- Bundle-slimmed distribution (~8 MB vs ~80 MB in earlier releases)

Known Issues:
- Windows SmartScreen may appear — build is unsigned
- krythor.exe requires node.exe beside it (included in installer)
- Streaming transparency fields not populated in all run modes

Installation:
  Installer:  Run Krythor-Setup-${rootPkg.version}.exe
  Zip:        Extract, run Krythor-Setup.bat, then Krythor.bat
  Open:       http://localhost:47200
`;
  writeFileSync(join(DISTDIR, 'RELEASE-NOTES.txt'), releaseNotes);
  ok('RELEASE-NOTES.txt');

  // ── Write README-DISTRIBUTION.txt ─────────────────────────────────────────
  head('Writing README-DISTRIBUTION.txt');
  const readmeDist = `Krythor v${rootPkg.version} — Distribution Package Contents
=====================================================================

This folder is a self-contained Krythor installation.
It contains everything needed to run Krythor on any machine with Node.js 20+.

FOLDER STRUCTURE
  packages/            — Compiled Krythor packages (gateway, setup, memory, etc.)
                         These are pre-built JavaScript files, not source code.
  node_modules/        — Contains only better-sqlite3 native bindings.
                         All other dependencies are bundled into packages/*/dist/.
                         DO NOT DELETE this folder — Krythor cannot run without it.
  start.js             — Main launcher. Run: node start.js
  Krythor.bat          — Windows launcher (double-click to start)
  Krythor-Setup.bat    — Windows setup wizard (run first on a new machine)
  install.sh           — macOS/Linux setup helper
  package.json         — Minimal package manifest for this distribution
  INSTALL.txt          — Quick-start instructions
  RELEASE-NOTES.txt    — What's new in this release
  CHANGELOG.md         — Full version history

IMPORTANT NOTES
  - node_modules/ is required at runtime and must travel with this folder.
  - All user data (settings, history, models) is stored outside this folder
    in your OS user profile — deleting this folder does NOT delete your data.
  - To update Krythor, replace this folder with a newer distribution package.

SUPPORT
  Run diagnostics:  node start.js doctor
  Documentation:    https://github.com/krythor/krythor
`;
  writeFileSync(join(DISTDIR, 'README-DISTRIBUTION.txt'), readmeDist);
  ok('README-DISTRIBUTION.txt');

  // ── Summary ────────────────────────────────────────────────────────────────
  head('Bundle complete');

  // ── Size summary ───────────────────────────────────────────────────────────
  function countFiles(dir) {
    if (!existsSync(dir)) return 0;
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
      else count += 1;
    }
    return count;
  }
  function dirSizeMB(dir) {
    if (!existsSync(dir)) return '–';
    let bytes = 0;
    function walk(d) {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else bytes += statSync(full).size;
      }
    }
    walk(dir);
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
  const totalFiles = countFiles(DISTDIR);
  const keyDirs = ['packages', 'node_modules'].map(d => {
    const present = existsSync(join(DISTDIR, d));
    return `    ${present ? GREEN + '✓' : RED + '✗'}${RESET}  ${d}/  ${present ? DIM + '(' + dirSizeMB(join(DISTDIR, d)) + ')' + RESET : DIM + 'missing' + RESET}`;
  });
  console.log(`  Total files copied:  ${totalFiles.toLocaleString()}`);
  console.log(`  Total dist size:     ${dirSizeMB(DISTDIR)}`);
  console.log('  Key directories:');
  keyDirs.forEach(l => console.log(l));
  console.log('');
  console.log(`  Output folder:  ${DISTDIR}`);
  console.log('');
  console.log('  To distribute:');
  console.log(`    Zip the  krythor-dist/  folder and share it.`);
  console.log('    Users need only Node.js 20+ installed.');
  console.log('    Windows users: double-click Krythor-Setup.bat, then Krythor.bat');
  console.log('');
}

main().catch(e => {
  err('Bundle failed: ' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
