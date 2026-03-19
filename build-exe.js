#!/usr/bin/env node
/**
 * Builds a Krythor Windows executable using Node.js Single Executable Application (SEA).
 *
 * Requirements:
 *   - Node.js 20+ (sea-launcher.js must be a single CommonJS file with no imports)
 *   - Windows (postject targets Windows PE format)
 *   - Run AFTER pnpm build (gateway must be compiled)
 *
 * Output: krythor.exe in the project root
 *
 * Usage: node build-exe.js
 */

const { execSync, spawnSync } = require('child_process');
const { existsSync, copyFileSync, writeFileSync, readFileSync } = require('fs');
const { join } = require('path');

const ROOT = __dirname;
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const DIM   = '\x1b[2m';
const CYAN  = '\x1b[36m';
const RESET = '\x1b[0m';

function ok(msg)   { console.log(`${GREEN}✓${RESET} ${msg}`); }
function err(msg)  { console.error(`${RED}✗${RESET} ${msg}`); process.exit(1); }
function info(msg) { console.log(`${DIM}  ${msg}${RESET}`); }
function head(msg) { console.log(`\n${CYAN}${msg}${RESET}`); }

async function main() {
  console.log(`\n${CYAN}  KRYTHOR — Build Executable (SEA)${RESET}\n`);

  // ── Preflight checks ──────────────────────────────────────────────────────
  head('Preflight checks');

  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) err(`Node.js 20+ required for SEA. Current: ${process.version}`);
  ok(`Node.js ${process.version} (SEA supported)`);

  if (process.platform !== 'win32') err('SEA executable build is Windows-only. Use start.js on other platforms.');
  ok('Windows platform');

  if (!existsSync(join(ROOT, 'sea-launcher.js'))) err('sea-launcher.js not found. It should be in the project root.');
  ok('sea-launcher.js present');

  const gatewayDist = join(ROOT, 'packages', 'gateway', 'dist', 'index.js');
  if (!existsSync(gatewayDist)) err('Gateway not built. Run: pnpm build');
  ok('Gateway built');

  // ── Install postject if needed ─────────────────────────────────────────────
  head('Checking postject');
  try {
    require.resolve('postject');
    ok('postject available');
  } catch {
    info('Installing postject…');
    execSync('npm install --no-save postject', { cwd: ROOT, stdio: 'inherit' });
    ok('postject installed');
  }

  // ── Generate the SEA blob ──────────────────────────────────────────────────
  head('Generating SEA blob');
  const blobPath = join(ROOT, 'sea-prep.blob');
  execSync('node --experimental-sea-config sea-config.json', { cwd: ROOT, stdio: 'inherit' });
  if (!existsSync(blobPath)) err('SEA blob generation failed — sea-prep.blob not created');
  ok('sea-prep.blob generated');

  // ── Copy node.exe as base for the executable ───────────────────────────────
  head('Preparing executable');
  const exePath = join(ROOT, 'krythor.exe');
  copyFileSync(process.execPath, exePath);
  ok(`Copied node.exe → krythor.exe`);

  // ── Inject the SEA blob ────────────────────────────────────────────────────
  head('Injecting SEA blob');
  const postjectPath = require.resolve('postject/dist/cli.js');
  const result = spawnSync(process.execPath, [
    postjectPath,
    exePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    '--overwrite',
  ], { cwd: ROOT, stdio: 'inherit' });

  if (result.status !== 0) err('postject injection failed');
  ok('SEA blob injected into krythor.exe');

  // ── Verify ────────────────────────────────────────────────────────────────
  head('Verifying executable');
  const stat = require('fs').statSync(exePath);
  ok(`krythor.exe — ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

  console.log('');
  console.log(`  ${GREEN}krythor.exe is ready.${RESET}`);
  console.log(`${DIM}  Users can run it directly — no "node" command needed.${RESET}`);
  console.log(`${DIM}  Include node.exe alongside krythor.exe for gateway spawning.${RESET}`);
  console.log('');
  console.log('  Distribution package should contain:');
  console.log('    krythor.exe          ← launcher (no Node.js required on PATH)');
  console.log('    node.exe             ← copy of node.exe for gateway spawning');
  console.log('    packages/            ← compiled gateway + other packages');
  console.log('    node_modules/        ← runtime dependencies');
  console.log('');
}

main().catch(e => {
  console.error(`${RED}Fatal:${RESET}`, e instanceof Error ? e.message : String(e));
  process.exit(1);
});
