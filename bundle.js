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
  mkdirSync(join(DISTDIR, dest, '..'), { recursive: true });
  cpSync(src, join(DISTDIR, dest), { recursive: true, ...opts });
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

  // ── Copy node_modules (production only via pnpm pack approach) ─────────────
  // We copy the workspace node_modules that are actually needed at runtime.
  // This is the simplest cross-platform approach without pkg or esbuild bundling.
  head('Copying node_modules (runtime only)');
  info('This may take 10-20 seconds…');
  const nmSrc = join(ROOT, 'node_modules');
  if (existsSync(nmSrc)) {
    copy(nmSrc, 'node_modules');
    ok('node_modules');
  }

  // ── Copy launcher files ────────────────────────────────────────────────────
  head('Copying launcher files');
  const launchers = [
    ['start.js',             'start.js'],
    ['Krythor.bat',          'Krythor.bat'],
    ['Krythor-Setup.bat',    'Krythor-Setup.bat'],
    ['install.sh',           'install.sh'],
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

What's new in v0.2:
- System readiness card on first launch
- Model health and fallback visibility in run details
- Memory search mode indicator (semantic vs keyword)
- Heartbeat warnings persist across restarts
- GGUF/local provider guidance improved
- Embedding recovery probing
- Cleaner distribution packaging

Installation:
1. Extract the krythor-dist folder
2. Double-click Krythor.bat (Windows) or run: node start.js
3. Open http://localhost:47200 in your browser
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
  node_modules/        — Runtime dependencies. DO NOT DELETE this folder.
                         Krythor cannot run without it. It is NOT safe to prune
                         or deduplicate this folder after distribution.
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
