#!/usr/bin/env node
/**
 * Krythor Bundle Script
 *
 * Prepares a self-contained distribution folder that can be zipped and shared.
 *
 * Usage:
 *   node bundle.js                              — build krythor-dist-win/ (Windows, full)
 *   node bundle.js --platform win               — same as above
 *   node bundle.js --platform linux             — build krythor-dist-linux/
 *   node bundle.js --platform mac               — build krythor-dist-mac/
 *   node bundle.js --platform mac --arch arm64  — build krythor-dist-mac/ for Apple Silicon
 *
 * Platform zip asset names (for GitHub Releases):
 *   krythor-win-x64.zip      — built on Windows CI, includes better_sqlite3.node + bundled Node
 *   krythor-linux-x64.zip    — built on Linux CI, includes linux better_sqlite3.node + bundled Node
 *   krythor-macos-x64.zip    — built on macOS CI, includes macOS better_sqlite3.node + bundled Node
 *   krythor-macos-arm64.zip  — built on macOS ARM CI, includes arm64 better_sqlite3.node + bundled Node
 *
 * The resulting folder is self-contained — users do NOT need Node.js installed.
 * A matching Node 20.19.0 runtime is downloaded and embedded in runtime/.
 */

const { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, statSync } = require('fs');
const { join, resolve } = require('path');
const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const os = require('os');

const ROOT = __dirname;

// ── Platform selection ─────────────────────────────────────────────────────────
const platformArg = (() => {
  const idx = process.argv.indexOf('--platform');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1].toLowerCase();
  // Auto-detect from current OS if not specified
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'linux')  return 'linux';
  return 'win';
})();

if (!['win', 'linux', 'mac'].includes(platformArg)) {
  console.error(`Unknown platform: ${platformArg}. Use: win, linux, mac`);
  process.exit(1);
}

// ── Arch selection ─────────────────────────────────────────────────────────────
const archArg = (() => {
  const idx = process.argv.indexOf('--arch');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1].toLowerCase();
  return 'x64';
})();

if (!['x64', 'arm64'].includes(archArg)) {
  console.error(`Unknown arch: ${archArg}. Use: x64, arm64`);
  process.exit(1);
}

const DISTDIR = join(ROOT, `krythor-dist-${platformArg}`);

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

// ── Download & embed bundled Node runtime ─────────────────────────────────────
/**
 * Downloads Node 20.19.0 for the given platform/arch, extracts the binary,
 * places it at distDir/runtime/node[.exe], verifies it works, and chmod+xs it.
 *
 * @param {string} plat  - 'win' | 'linux' | 'mac'
 * @param {string} arch  - 'x64' | 'arm64'
 * @param {string} distDir - absolute path to the dist output folder
 */
async function downloadNodeRuntime(plat, arch, distDir) {
  const NODE_VERSION = '20.19.0';

  // Determine download URL and the path of node inside the archive
  let url, archiveName, nodePathInArchive;

  if (plat === 'win') {
    archiveName = `node-v${NODE_VERSION}-win-x64.zip`;
    url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
    nodePathInArchive = `node-v${NODE_VERSION}-win-x64/node.exe`;
  } else if (plat === 'linux') {
    archiveName = `node-v${NODE_VERSION}-linux-x64.tar.gz`;
    url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
    nodePathInArchive = `node-v${NODE_VERSION}-linux-x64/bin/node`;
  } else if (plat === 'mac') {
    if (arch === 'arm64') {
      archiveName = `node-v${NODE_VERSION}-darwin-arm64.tar.gz`;
      url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
      nodePathInArchive = `node-v${NODE_VERSION}-darwin-arm64/bin/node`;
    } else {
      archiveName = `node-v${NODE_VERSION}-darwin-x64.tar.gz`;
      url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
      nodePathInArchive = `node-v${NODE_VERSION}-darwin-x64/bin/node`;
    }
  } else {
    err(`downloadNodeRuntime: unknown platform '${plat}'`);
    process.exit(1);
  }

  const runtimeDir = join(distDir, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });

  const destBinary = plat === 'win'
    ? join(runtimeDir, 'node.exe')
    : join(runtimeDir, 'node');

  // ── Download the archive ────────────────────────────────────────────────────
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'krythor-node-'));
  const tmpArchive = join(tmpDir, archiveName);

  info(`Downloading Node.js ${NODE_VERSION} for ${plat}-${arch}...`);
  info(`  URL: ${url}`);

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpArchive);
    function get(requestUrl) {
      https.get(requestUrl, (res) => {
        // Follow redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    }
    get(url);
  });

  const archiveStat = fs.statSync(tmpArchive);
  if (archiveStat.size < 10000) {
    err(`Downloaded archive is suspiciously small (${archiveStat.size} bytes) — aborting`);
    process.exit(1);
  }
  info(`  Downloaded: ${(archiveStat.size / 1024 / 1024).toFixed(1)} MB`);

  // ── Extract the node binary ─────────────────────────────────────────────────
  const extractDir = join(tmpDir, 'extracted');
  mkdirSync(extractDir, { recursive: true });

  if (plat === 'win') {
    // Use PowerShell Expand-Archive on Windows
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${tmpArchive}' -DestinationPath '${extractDir}' -Force"`,
      { stdio: 'inherit' }
    );
    const srcExe = join(extractDir, `node-v${NODE_VERSION}-win-x64`, 'node.exe');
    if (!existsSync(srcExe)) {
      err(`node.exe not found in archive at expected path: ${srcExe}`);
      process.exit(1);
    }
    fs.copyFileSync(srcExe, destBinary);
  } else {
    // Linux / macOS — use tar
    execSync(`tar -xzf "${tmpArchive}" -C "${extractDir}"`, { stdio: 'inherit' });
    const srcNode = join(extractDir, nodePathInArchive);
    if (!existsSync(srcNode)) {
      err(`node binary not found in archive at expected path: ${srcNode}`);
      process.exit(1);
    }
    fs.copyFileSync(srcNode, destBinary);
    fs.chmodSync(destBinary, 0o755);
  }

  // ── Clean up temp files ─────────────────────────────────────────────────────
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* non-fatal */ }

  // ── Verify the binary works ─────────────────────────────────────────────────
  try {
    const result = execSync(`"${destBinary}" --version`, { encoding: 'utf-8' }).trim();
    ok(`Bundled Node runtime: ${result}  →  runtime/${plat === 'win' ? 'node.exe' : 'node'}`);
  } catch (e) {
    err(`Bundled Node binary failed to execute: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  console.log(`\n${CYAN}  KRYTHOR — Bundle [${platformArg}/${archArg}]${RESET}`);
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
  const pkgs = ['gateway', 'control', 'setup', 'memory', 'models', 'core', 'guard', 'skills'];
  for (const pkg of pkgs) {
    const src = join(ROOT, 'packages', pkg, 'dist');
    if (existsSync(src)) {
      copy(src, join('packages', pkg, 'dist'));
      ok(`packages/${pkg}/dist`);
    }
  }

  // ── Write node_modules/@krythor/* stubs ───────────────────────────────────
  // The gateway and other packages require('@krythor/core') etc at runtime.
  // Node resolves these via node_modules — write minimal package.json stubs
  // that point "main" to the already-copied dist files.
  head('Writing @krythor package stubs');
  const krythorPkgs = ['core', 'memory', 'models', 'guard', 'skills'];
  for (const pkg of krythorPkgs) {
    const distMain = join(DISTDIR, 'packages', pkg, 'dist', 'index.js');
    if (!existsSync(distMain)) continue;
    const stubDir = join(DISTDIR, 'node_modules', '@krythor', pkg);
    mkdirSync(stubDir, { recursive: true });
    // Relative path from stub dir to the dist index
    const rel = `../../../packages/${pkg}/dist/index.js`;
    writeFileSync(join(stubDir, 'package.json'), JSON.stringify({
      name: `@krythor/${pkg}`,
      version: '0.0.0',
      main: rel,
    }, null, 2));
    ok(`node_modules/@krythor/${pkg}`);
  }

  // ── Copy migration SQL files (not compiled — runtime-loaded) ───────────────
  head('Copying runtime assets');
  const migrSrc = join(ROOT, 'packages', 'memory', 'src', 'db', 'migrations');
  if (existsSync(migrSrc)) {
    copy(migrSrc, join('packages', 'memory', 'dist', 'migrations'));
    ok('migrations SQL files');
  }

  // ── Copy native bindings (better-sqlite3) ─────────────────────────────────
  // Each platform bundle ships only the .node binary compiled for that OS/arch.
  // The binary in node_modules was compiled on the machine running bundle.js,
  // so it is always correct for the current platform.
  // For cross-platform builds (e.g. building linux/mac bundle on Windows),
  // the .node binary is intentionally omitted — CI must build on the target OS.
  head('Copying native bindings (better-sqlite3 only)');
  const { realpathSync: rps, copyFileSync } = require('fs');
  const sqliteNm = join(ROOT, 'node_modules', 'better-sqlite3');
  const currentOS = process.platform === 'darwin' ? 'mac'
                  : process.platform === 'linux'  ? 'linux'
                  : 'win';
  const binaryIsForThisPlatform = (currentOS === platformArg);

  if (existsSync(sqliteNm)) {
    const realSqlite = (() => { try { return rps(sqliteNm); } catch { return sqliteNm; } })();
    const sqliteDest = join(DISTDIR, 'node_modules', 'better-sqlite3');

    // Copy the full package source so the installer can recompile if needed.
    // deps/ contains common.gypi required by node-gyp.
    // node_modules/ contains build-time deps (prebuild-install etc.).
    const subsToCopy = ['lib', 'src', 'deps', 'node_modules', 'package.json', 'binding.gyp', 'README.md'];
    for (const sub of subsToCopy) {
      const subSrc = join(realSqlite, sub);
      if (existsSync(subSrc)) {
        const subDest = join(sqliteDest, sub);
        mkdirSync(join(subDest, '..'), { recursive: true });
        cpSync(subSrc, subDest, { recursive: true });
      }
    }

    if (binaryIsForThisPlatform) {
      // Include the pre-built binary — already compiled against bundled Node in CI
      const nodeBin = join(realSqlite, 'build', 'Release', 'better_sqlite3.node');
      if (existsSync(nodeBin)) {
        const binDest = join(sqliteDest, 'build', 'Release', 'better_sqlite3.node');
        mkdirSync(join(binDest, '..'), { recursive: true });
        copyFileSync(nodeBin, binDest);
        ok('node_modules/better-sqlite3 (full source + prebuilt binary)');
      } else {
        ok('node_modules/better-sqlite3 (full source — no prebuilt binary)');
      }
    } else {
      ok(`node_modules/better-sqlite3 (full source — binary must be compiled on ${platformArg})`);
    }
  }
  // better-sqlite3 sub-deps: bindings and file-uri-to-path
  for (const dep of ['bindings', 'file-uri-to-path']) {
    const depSrc = join(ROOT, 'node_modules', dep);
    if (existsSync(depSrc)) {
      copy(depSrc, join('node_modules', dep));
      ok(`node_modules/${dep}`);
    }
  }

  // ── Download & embed bundled Node runtime ─────────────────────────────────
  head('Downloading bundled Node runtime');
  await downloadNodeRuntime(platformArg, archArg, DISTDIR);

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
  }

  // ── Write a minimal package.json for the dist folder ──────────────────────
  head('Writing dist package.json');
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  // Read better-sqlite3 version from the source package so the dist package.json
  // lists it as a dependency — required for node-gyp rebuild to work.
  let sqliteVersion = '*';
  try {
    const sqlitePkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'better-sqlite3', 'package.json'), 'utf-8'));
    sqliteVersion = sqlitePkg.version;
  } catch { /* non-fatal */ }

  const distPkg = {
    name:        'krythor',
    version:     rootPkg.version,
    description: rootPkg.description,
    // engines field omitted — runtime is bundled, no system Node required
    scripts: {
      start:  'node start.js',
      setup:  'node packages/setup/dist/bin/setup.js',
      doctor: 'node packages/setup/dist/bin/setup.js doctor',
    },
    // Declare better-sqlite3 so rebuild commands target it correctly
    dependencies: {
      'better-sqlite3': sqliteVersion,
    },
  };
  writeFileSync(join(DISTDIR, 'package.json'), JSON.stringify(distPkg, null, 2));
  ok('package.json');

  // ── Write a README for the dist folder ────────────────────────────────────
  head('Writing INSTALL.txt');
  const installTxt = `KRYTHOR — Local-first AI command platform
Version: ${rootPkg.version}

REQUIREMENTS
  No Node.js required — this release includes a bundled Node.js runtime.
  No pnpm, no cloud accounts required.

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
  2. Run:  ./runtime/node packages/setup/dist/bin/setup.js
  3. Run:  ./start.js   (or: ./runtime/node start.js)

COMMANDS (from this folder)
  ./runtime/node start.js                              — launch gateway + open browser
  ./runtime/node packages/setup/dist/bin/setup.js     — run setup wizard
  ./runtime/node packages/setup/dist/bin/setup.js doctor  — run diagnostics

  On Windows use:  runtime\\node.exe start.js

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
- Bundled Node.js runtime — no system Node.js required

Known Issues:
- Windows SmartScreen may appear — build is unsigned
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
It contains everything needed to run Krythor — including a bundled Node.js runtime.
No system Node.js installation is required.

FOLDER STRUCTURE
  packages/            — Compiled Krythor packages (gateway, setup, memory, etc.)
                         These are pre-built JavaScript files, not source code.
  node_modules/        — Contains only better-sqlite3 native bindings.
                         All other dependencies are bundled into packages/*/dist/.
                         DO NOT DELETE this folder — Krythor cannot run without it.
  runtime/             — Bundled Node.js 20 runtime binary.
                         Windows: runtime/node.exe
                         macOS/Linux: runtime/node
                         DO NOT DELETE this folder — it is required to run Krythor.
  start.js             — Main launcher. Run: ./runtime/node start.js
  Krythor.bat          — Windows launcher (double-click to start)
  Krythor-Setup.bat    — Windows setup wizard (run first on a new machine)
  install.sh           — macOS/Linux setup helper
  package.json         — Minimal package manifest for this distribution
  INSTALL.txt          — Quick-start instructions
  RELEASE-NOTES.txt    — What's new in this release
  CHANGELOG.md         — Full version history

IMPORTANT NOTES
  - node_modules/ and runtime/ are required at runtime and must travel with this folder.
  - All user data (settings, history, models) is stored outside this folder
    in your OS user profile — deleting this folder does NOT delete your data.
  - To update Krythor, replace this folder with a newer distribution package.

SUPPORT
  Run diagnostics:  ./runtime/node start.js doctor
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
  const keyDirs = ['packages', 'node_modules', 'runtime'].map(d => {
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
  console.log(`    Zip the  krythor-dist-${platformArg}/  folder as  krythor-${platformArg}-${archArg}.zip`);
  console.log('    Upload to GitHub Releases as a release asset.');
  console.log('    Users do NOT need Node.js installed — runtime is bundled.');
  if (platformArg === 'win') {
    console.log('    Windows users: double-click Krythor-Setup.bat, then Krythor.bat');
  } else {
    console.log(`    ${platformArg} users: run  ./runtime/node start.js  after install`);
  }
  console.log('');
}

main().catch(e => {
  err('Bundle failed: ' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
