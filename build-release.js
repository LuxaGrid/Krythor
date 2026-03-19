#!/usr/bin/env node
/**
 * build-release.js
 *
 * Full Krythor release pipeline:
 *
 *   1. pnpm build              — compile all packages
 *   2. node bundle.js          — create krythor-dist/
 *   3. node build-exe.js       — build krythor.exe (SEA)
 *   4. node sign.js (exe only) — sign krythor.exe before installer bundles it
 *   5. node build-installer.js — compile Inno Setup installer
 *   6. node sign.js            — sign Krythor-Setup-{version}.exe
 *
 * Signing is skipped automatically if KRYTHOR_SIGN_PFX is not set.
 * Set KRYTHOR_SIGN_PFX and KRYTHOR_SIGN_PASSWORD to enable signing.
 *
 * Usage:
 *   node build-release.js
 *   node build-release.js --skip-exe     (skip SEA exe build)
 *   node build-release.js --skip-sign    (force skip signing even if cert is set)
 */

const { spawnSync } = require('child_process');
const { join } = require('path');

const ROOT = __dirname;
const node = process.execPath;

const SKIP_EXE  = process.argv.includes('--skip-exe');
const SKIP_SIGN = process.argv.includes('--skip-sign');

const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

function step(label) { console.log(`\n${CYAN}══ ${label} ${RESET}`); }
function ok(msg)     { console.log(`${GREEN}✓${RESET} ${msg}`); }
function fail(msg)   { console.error(`${RED}✗ ${msg}${RESET}`); process.exit(1); }

function run(script, extraArgs = []) {
  const result = spawnSync(node, [join(ROOT, script), ...extraArgs], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  if (result.status !== 0) fail(`${script} failed (exit ${result.status})`);
}

function runPnpm(args) {
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) fail(`pnpm ${args.join(' ')} failed`);
}

const hasCert = !SKIP_SIGN && !!(process.env.KRYTHOR_SIGN_PFX && process.env.KRYTHOR_SIGN_PASSWORD);

async function main() {
  console.log(`\n${CYAN}  KRYTHOR — Full Release Build${RESET}`);
  if (!hasCert) console.log(`${DIM}  Signing: skipped (KRYTHOR_SIGN_PFX not set)${RESET}`);
  else          console.log(`${DIM}  Signing: enabled${RESET}`);

  // ── 1. Build all packages ────────────────────────────────────────────────────
  step('Step 1 — Build packages');
  runPnpm(['build']);
  ok('All packages built');

  // ── 2. Bundle dist ────────────────────────────────────────────────────────────
  step('Step 2 — Bundle distribution');
  run('bundle.js');
  ok('krythor-dist/ ready');

  // ── 3. Build SEA exe ──────────────────────────────────────────────────────────
  if (!SKIP_EXE) {
    step('Step 3 — Build SEA executable');
    run('build-exe.js');
    ok('krythor.exe ready');

    // ── 4. Sign krythor.exe BEFORE it goes into the installer ──────────────────
    if (hasCert) {
      step('Step 4 — Sign krythor.exe');
      run('sign.js');
      ok('krythor.exe signed');
    } else {
      step('Step 4 — Sign krythor.exe');
      console.log(`${DIM}  Skipped — no certificate configured${RESET}`);
    }
  } else {
    console.log(`\n${DIM}  Skipping SEA exe build (--skip-exe)${RESET}`);
  }

  // ── 5. Build installer (bundles krythor.exe + krythor-dist/) ──────────────────
  step('Step 5 — Build installer');
  run('build-installer.js');
  ok('Installer ready');

  // ── 6. Sign installer ─────────────────────────────────────────────────────────
  if (hasCert) {
    step('Step 6 — Sign installer');
    run('sign.js');
    ok('Installer signed');
  } else {
    step('Step 6 — Sign installer');
    console.log(`${DIM}  Skipped — no certificate configured${RESET}`);
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  const pkg = JSON.parse(require('fs').readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  console.log(`\n${CYAN}══ Release Complete ══${RESET}`);
  console.log(`\n  ${GREEN}Krythor v${pkg.version} release artifacts:${RESET}`);
  console.log(`    installer-out/Krythor-Setup-${pkg.version}.exe`);
  if (!SKIP_EXE) console.log(`    krythor.exe`);
  console.log(`    krythor-dist/  (zip this for zip distribution)`);
  if (!hasCert) {
    console.log(`\n  ${DIM}Note: artifacts are unsigned.`);
    console.log(`  Set KRYTHOR_SIGN_PFX + KRYTHOR_SIGN_PASSWORD to enable signing.${RESET}`);
  }
  console.log('');
}

main().catch(e => {
  fail('build-release.js failed: ' + (e instanceof Error ? e.message : String(e)));
});
