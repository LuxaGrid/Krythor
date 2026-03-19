#!/usr/bin/env node
/**
 * build-installer.js
 *
 * Builds a Windows installer (Krythor-Setup-{version}.exe) using Inno Setup.
 *
 * Steps:
 *   1. Verify krythor-dist-win/ exists (run: node bundle.js first)
 *   2. Fetch Node.js runtime for bundling (installer/fetch-node.js)
 *   3. Compile the Inno Setup script (installer/krythor.iss)
 *
 * Prerequisites:
 *   - Inno Setup 6 installed: https://jrsoftware.org/isinfo.php
 *   - krythor-dist-win/ must exist: run  pnpm build && node bundle.js  first
 *
 * Usage:
 *   node build-installer.js
 */

const { existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT      = __dirname;
const DIST_DIR  = join(ROOT, 'krythor-dist-win');
const ISS_FILE  = join(ROOT, 'installer', 'krythor.iss');
const OUT_DIR   = join(ROOT, 'installer-out');

const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

function ok(msg)   { console.log(`${GREEN}✓${RESET} ${msg}`); }
function fail(msg) { console.error(`${RED}✗${RESET} ${msg}`); process.exit(1); }
function head(msg) { console.log(`\n${CYAN}${msg}${RESET}`); }

function findInnoSetup() {
  const candidates = [
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Try PATH
  try {
    const result = execSync('where ISCC', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = result.split('\n')[0].trim();
    if (first && existsSync(first)) return first;
  } catch { /* not in PATH */ }
  return null;
}

async function main() {
  console.log(`\n${CYAN}  KRYTHOR — Build Installer${RESET}\n`);

  // ── Step 1: Verify dist exists ────────────────────────────────────────────
  head('Step 1 — Verify distribution bundle');
  if (!existsSync(DIST_DIR)) {
    fail('krythor-dist-win/ not found. Run: pnpm build && node bundle.js');
  }
  if (!existsSync(join(DIST_DIR, 'packages', 'gateway', 'dist', 'index.js'))) {
    fail('krythor-dist-win/ is incomplete. Run: pnpm build && node bundle.js');
  }
  ok('krythor-dist-win/ found');

  // ── Step 2: Fetch node.exe for bundling ───────────────────────────────────
  head('Step 2 — Fetch Node.js runtime');
  const fetchResult = spawnSync('node', [join(ROOT, 'installer', 'fetch-node.js')], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (fetchResult.status !== 0) fail('Failed to fetch node.exe');
  ok('node.exe ready');

  // ── Step 3: Find Inno Setup ───────────────────────────────────────────────
  head('Step 3 — Locate Inno Setup compiler');
  const iscc = findInnoSetup();
  if (!iscc) {
    fail(
      'Inno Setup not found.\n' +
      '  Install from: https://jrsoftware.org/isdl.php\n' +
      '  Then re-run this script.'
    );
  }
  ok(`Found: ${iscc}`);

  // ── Step 4: Create output dir ─────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });

  // ── Step 5: Compile installer ─────────────────────────────────────────────
  head('Step 4 — Compile installer');
  console.log(`${DIM}  ${iscc} "${ISS_FILE}"${RESET}\n`);

  const compileResult = spawnSync(iscc, [ISS_FILE], {
    stdio: 'inherit',
    cwd: join(ROOT, 'installer'),
  });

  if (compileResult.status !== 0) {
    fail('Inno Setup compilation failed. Check the output above.');
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  head('Done');
  const pkg = JSON.parse(require('fs').readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const outExe = join(OUT_DIR, `Krythor-Setup-${pkg.version}.exe`);
  if (existsSync(outExe)) {
    const size = (require('fs').statSync(outExe).size / 1024 / 1024).toFixed(1);
    ok(`Krythor-Setup-${pkg.version}.exe  ${DIM}(${size} MB)${RESET}`);
  } else {
    ok(`installer-out/ — check for Krythor-Setup-*.exe`);
  }
  console.log(`\n  ${DIM}Output: ${OUT_DIR}${RESET}`);
  console.log(`  ${DIM}Ship the .exe file to users — no zip extraction needed.${RESET}\n`);
}

main().catch(e => {
  fail('Build installer failed: ' + (e instanceof Error ? e.message : String(e)));
});
