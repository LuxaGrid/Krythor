#!/usr/bin/env node
/**
 * sign.js
 *
 * Signs Krythor Windows binaries using Microsoft signtool.
 *
 * Signs:
 *   1. krythor.exe           (SEA executable)
 *   2. installer-out/Krythor-Setup-{version}.exe  (Inno Setup installer)
 *
 * Prerequisites:
 *   - Windows SDK installed (provides signtool.exe)
 *     https://developer.microsoft.com/windows/downloads/windows-sdk/
 *   - A code signing certificate in PFX format
 *
 * Environment variables (set these — do NOT hardcode or commit):
 *   KRYTHOR_SIGN_PFX       — absolute path to your .pfx certificate file
 *   KRYTHOR_SIGN_PASSWORD  — PFX password (use a secure secret store in CI)
 *
 * Usage:
 *   node sign.js                    — sign all release artifacts
 *   node sign.js --dry-run          — print what would be signed, don't sign
 *   node sign.js --skip-if-no-cert  — exit 0 silently if cert not configured (dev builds)
 *
 * Timestamp server:
 *   Uses Sectigo RFC 3161 timestamp server by default.
 *   Override with:  KRYTHOR_SIGN_TIMESTAMP=https://your.tsa.server/rfc3161
 */

const { existsSync, readdirSync } = require('fs');
const { join, basename } = require('path');
const { spawnSync, execSync } = require('child_process');

const ROOT    = __dirname;
const pkg     = JSON.parse(require('fs').readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

const DRY_RUN        = process.argv.includes('--dry-run');
const SKIP_IF_NO_CERT = process.argv.includes('--skip-if-no-cert');

function ok(msg)   { console.log(`${GREEN}✓${RESET} ${msg}`); }
function fail(msg) { console.error(`${RED}✗${RESET} ${msg}`); process.exit(1); }
function info(msg) { console.log(`${DIM}  ${msg}${RESET}`); }
function head(msg) { console.log(`\n${CYAN}${msg}${RESET}`); }
function warn(msg) { console.warn(`\x1b[33m⚠${RESET}  ${msg}`); }

// ── Locate signtool.exe ────────────────────────────────────────────────────────
function findSigntool() {
  // Common Windows SDK paths (newest first)
  const sdkBase = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (existsSync(sdkBase)) {
    const versions = readdirSync(sdkBase)
      .filter(d => d.match(/^10\./))
      .sort()
      .reverse();
    for (const ver of versions) {
      const candidate = join(sdkBase, ver, 'x64', 'signtool.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  // Try PATH
  try {
    const result = execSync('where signtool', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = result.split('\n')[0].trim();
    if (first && existsSync(first)) return first;
  } catch { /* not in PATH */ }
  return null;
}

// ── Sign a single file ────────────────────────────────────────────────────────
function signFile(signtool, pfxPath, pfxPassword, timestampUrl, filePath) {
  if (!existsSync(filePath)) {
    fail(`File to sign not found: ${filePath}`);
  }

  if (DRY_RUN) {
    info(`[dry-run] Would sign: ${filePath}`);
    return;
  }

  info(`Signing: ${basename(filePath)}`);

  const args = [
    'sign',
    '/fd', 'SHA256',            // digest algorithm
    '/f',  pfxPath,             // certificate file
    '/p',  pfxPassword,         // certificate password
    '/tr', timestampUrl,        // RFC 3161 timestamp server
    '/td', 'SHA256',            // timestamp digest algorithm
    '/d',  'Krythor',           // description shown in UAC prompt
    '/du', 'https://github.com/LuxaGrid/Krythor',  // description URL
    filePath,
  ];

  const result = spawnSync(signtool, args, { stdio: 'inherit' });

  if (result.status !== 0) {
    fail(`Signing failed for: ${filePath}`);
  }

  ok(`Signed: ${basename(filePath)}`);
}

// ── Verify a signed file ──────────────────────────────────────────────────────
function verifyFile(signtool, filePath) {
  if (DRY_RUN) return;
  const result = spawnSync(signtool, ['verify', '/pa', '/v', filePath], { stdio: 'pipe' });
  if (result.status === 0) {
    ok(`Verified: ${basename(filePath)}`);
  } else {
    warn(`Verification warning for: ${basename(filePath)} — check manually`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${CYAN}  KRYTHOR — Sign Release Artifacts${RESET}`);
  if (DRY_RUN) console.log(`${DIM}  [dry-run mode — no files will be modified]${RESET}`);
  console.log('');

  // ── Read cert config from environment ───────────────────────────────────────
  const pfxPath    = process.env.KRYTHOR_SIGN_PFX;
  const pfxPassword = process.env.KRYTHOR_SIGN_PASSWORD;
  const timestampUrl = process.env.KRYTHOR_SIGN_TIMESTAMP || 'http://timestamp.sectigo.com';

  if (!pfxPath || !pfxPassword) {
    if (SKIP_IF_NO_CERT) {
      warn('KRYTHOR_SIGN_PFX or KRYTHOR_SIGN_PASSWORD not set — skipping signing (dev build).');
      process.exit(0);
    }
    fail(
      'Certificate not configured.\n\n' +
      '  Set these environment variables before signing:\n' +
      '    KRYTHOR_SIGN_PFX       — path to your .pfx file\n' +
      '    KRYTHOR_SIGN_PASSWORD  — PFX password\n\n' +
      '  Or use --skip-if-no-cert to skip signing in dev builds.'
    );
  }

  if (!existsSync(pfxPath)) {
    fail(`PFX file not found: ${pfxPath}`);
  }

  // ── Locate signtool ──────────────────────────────────────────────────────────
  head('Locating signtool');
  const signtool = findSigntool();
  if (!signtool) {
    fail(
      'signtool.exe not found.\n\n' +
      '  Install Windows SDK: https://developer.microsoft.com/windows/downloads/windows-sdk/\n' +
      '  Or ensure signtool.exe is on your PATH.'
    );
  }
  ok(`Found: ${signtool}`);

  // ── Define artifacts to sign ─────────────────────────────────────────────────
  head('Signing artifacts');
  info(`Certificate: ${pfxPath}`);
  info(`Timestamp:   ${timestampUrl}`);
  console.log('');

  // 1. krythor.exe (SEA executable) — sign before bundling into installer
  const exePath = join(ROOT, 'krythor.exe');
  if (existsSync(exePath)) {
    signFile(signtool, pfxPath, pfxPassword, timestampUrl, exePath);
  } else {
    warn('krythor.exe not found — skipping (build with: node build-exe.js)');
  }

  // 2. Installer exe
  const installerDir = join(ROOT, 'installer-out');
  const installerExe = join(installerDir, `Krythor-Setup-${VERSION}.exe`);
  if (existsSync(installerExe)) {
    signFile(signtool, pfxPath, pfxPassword, timestampUrl, installerExe);
  } else {
    warn(`Krythor-Setup-${VERSION}.exe not found — skipping (build with: node build-installer.js)`);
  }

  // ── Verify signatures ────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    head('Verifying signatures');
    if (existsSync(exePath))       verifyFile(signtool, exePath);
    if (existsSync(installerExe))  verifyFile(signtool, installerExe);
  }

  head('Done');
  console.log(`  ${GREEN}Release artifacts signed successfully.${RESET}\n`);
  if (!DRY_RUN) {
    console.log(`  Ship these files:`);
    if (existsSync(exePath))       console.log(`    ${exePath}`);
    if (existsSync(installerExe))  console.log(`    ${installerExe}`);
    console.log('');
  }
}

main().catch(e => {
  fail('sign.js failed: ' + (e instanceof Error ? e.message : String(e)));
});
