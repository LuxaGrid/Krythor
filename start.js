#!/usr/bin/env node
// Krythor launcher — starts the gateway and opens the control UI.
// Usage: node start.js [--no-browser]
// The bundled Node runtime in runtime/ is used automatically when present.

const { spawn, execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const net = require('net');

// ── Resolve bundled Node binary ────────────────────────────────────────────
// When running from the distribution folder, prefer the bundled Node runtime
// so that spawned subprocesses (gateway, setup) use the same binary and ABI
// as the native modules compiled in CI. Falls back to the current process
// executable (e.g. when running from source with a system Node).
const BUNDLED_NODE = process.platform === 'win32'
  ? join(__dirname, 'runtime', 'node.exe')
  : join(__dirname, 'runtime', 'node');
const NODE_BIN = existsSync(BUNDLED_NODE) ? BUNDLED_NODE : process.execPath;

const PORT = 47200;
const HOST = '127.0.0.1';
const gatewayDist = join(__dirname, 'packages', 'gateway', 'dist', 'index.js');
const noBrowser = process.argv.includes('--no-browser');

// Read version from package.json (same approach as gateway)
let KRYTHOR_VERSION = '';
try {
  const rootPkg = JSON.parse(require('fs').readFileSync(join(__dirname, 'package.json'), 'utf-8'));
  KRYTHOR_VERSION = rootPkg.version || '';
} catch { /* non-fatal — version display is best-effort */ }

// ── Check build ────────────────────────────────────────────────────────────
if (!existsSync(gatewayDist)) {
  console.error('\x1b[31mKrythor has not been built yet.\x1b[0m');
  console.error('');
  console.error('Run "Krythor.bat" to auto-build, or manually run:');
  console.error('  pnpm install');
  console.error('  pnpm build');
  process.exit(1);
}

// ── Check if Krythor health endpoint is responding ────────────────────────
async function isKrythorRunning() {
  try {
    const r = await fetch(`http://${HOST}:${PORT}/health`, { signal: AbortSignal.timeout(800) });
    if (!r.ok) return false;
    const body = await r.json();
    // Verify it's actually Krythor, not something else
    return body && body.status === 'ok' && typeof body.version === 'string';
  } catch { return false; }
}

// ── Check if port is in use by a non-Krythor process ─────────────────────
async function isPortInUse() {
  return new Promise((resolve) => {
    const client = net.createConnection({ host: HOST, port: PORT });
    client.setTimeout(500);
    client.on('connect', () => { client.destroy(); resolve(true); });
    client.on('error', () => resolve(false));
    client.on('timeout', () => { client.destroy(); resolve(false); });
  });
}

// ── krythor repair ─────────────────────────────────────────────────────────
// Verify that all runtime components are healthy:
//   1. Bundled Node runtime exists and executes
//   2. better-sqlite3 native module loads under the bundled Node
//   3. Gateway health endpoint responds (if already running)
async function runRepair() {
  console.log('\x1b[36m  KRYTHOR\x1b[0m — Repair / Health Check');
  console.log('');

  let allOk = true;

  // Check 1: bundled runtime
  process.stdout.write('  Bundled Node runtime ... ');
  if (!existsSync(BUNDLED_NODE)) {
    console.log('\x1b[31mMISSING\x1b[0m');
    console.log(`    Expected: ${BUNDLED_NODE}`);
    console.log('    The runtime/ folder was not found. Re-download or reinstall Krythor.');
    allOk = false;
  } else {
    try {
      const ver = execSync(`"${NODE_BIN}" --version`, { encoding: 'utf-8' }).trim();
      console.log(`\x1b[32mOK\x1b[0m  (${ver})`);
    } catch (e) {
      console.log('\x1b[31mFAIL\x1b[0m');
      console.log(`    Error: ${e.message}`);
      allOk = false;
    }
  }

  // Check 2: better-sqlite3 loads
  process.stdout.write('  better-sqlite3 module  ... ');
  const sqliteDir = join(__dirname, 'node_modules', 'better-sqlite3');
  if (!existsSync(sqliteDir)) {
    console.log('\x1b[31mMISSING\x1b[0m');
    console.log('    node_modules/better-sqlite3 not found. Re-download or reinstall Krythor.');
    allOk = false;
  } else {
    try {
      execSync(
        `"${NODE_BIN}" -e "require('./node_modules/better-sqlite3')"`,
        { cwd: __dirname, stdio: 'pipe', encoding: 'utf-8' }
      );
      console.log('\x1b[32mOK\x1b[0m');
    } catch (e) {
      console.log('\x1b[31mFAIL\x1b[0m');
      const msg = (e.stderr || e.message || '').toString().split('\n')[0];
      console.log(`    Error: ${msg}`);
      console.log('    The native module may need to be recompiled for this runtime.');
      console.log('    Run the installer again to recompile, or contact support.');
      allOk = false;
    }
  }

  // Check 3: gateway health (only if already running)
  process.stdout.write('  Gateway health endpoint ... ');
  if (await isKrythorRunning()) {
    console.log(`\x1b[32mOK\x1b[0m  (http://${HOST}:${PORT}/health)`);
  } else {
    console.log('\x1b[2mnot running\x1b[0m  (start with: krythor)');
    // Not a failure — gateway not running is expected if user just ran repair
  }

  console.log('');
  if (allOk) {
    console.log('\x1b[32m  All checks passed.\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31m  One or more checks failed. See above for details.\x1b[0m');
    process.exit(1);
  }
}

// ── Allow `node start.js doctor` as an alias for the doctor command ────────
if (process.argv.includes('doctor')) {
  const doctorScript = join(__dirname, 'packages', 'setup', 'dist', 'bin', 'setup.js');
  try {
    execSync(`"${NODE_BIN}" "${doctorScript}" doctor`, { stdio: 'inherit' });
  } catch { /* exit code from setup.js propagates */ }
  process.exit(0);
}

// ── Allow `node start.js setup` as an alias for the setup wizard ───────────
if (process.argv.includes('setup')) {
  const setupScript = join(__dirname, 'packages', 'setup', 'dist', 'bin', 'setup.js');
  try {
    execSync(`"${NODE_BIN}" "${setupScript}"`, { stdio: 'inherit' });
  } catch { /* exit code from setup.js propagates */ }
  process.exit(0);
}

// ── Allow `node start.js repair` to run the health check ──────────────────
if (process.argv.includes('repair')) {
  runRepair().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
  // runRepair handles process.exit internally — do not call main()
} else {
  main().catch(err => {
    console.error('\x1b[31mFatal:\x1b[0m', err.message);
    process.exit(1);
  });
}

async function main() {
  const versionTag = KRYTHOR_VERSION ? `\x1b[2m v${KRYTHOR_VERSION}\x1b[0m` : '';
  console.log(`\x1b[36m  KRYTHOR\x1b[0m${versionTag} — Local-first AI command platform`);
  console.log('');

  // If already running (our process), just open the browser
  if (await isKrythorRunning()) {
    console.log(`\x1b[32m✓ Gateway already running\x1b[0m  →  http://${HOST}:${PORT}`);
    if (!noBrowser) tryOpen(`http://${HOST}:${PORT}`);
    return;
  }

  // Check if port is occupied by something else
  if (await isPortInUse()) {
    console.warn(`\x1b[33mWarning: Port ${PORT} is already in use by another application.\x1b[0m`);
    console.warn('Krythor may not start correctly.');
    console.warn('');
  }

  console.log('Starting gateway...');

  // Use a temp log file so startup errors are visible if the gateway times out
  const os = require('os');
  const fs = require('fs');
  const logFile = join(os.tmpdir(), 'krythor-gateway.log');
  const logStream = fs.openSync(logFile, 'w');

  // Use the bundled Node binary so the gateway loads native modules compiled
  // for the bundled runtime's ABI — avoids ERR_DLOPEN_FAILED at startup.
  const child = spawn(NODE_BIN, [gatewayDist], {
    stdio: ['ignore', logStream, logStream],
    detached: true,
  });
  child.unref();

  child.on('error', err => {
    console.error('\x1b[31m✗ Failed to start gateway:\x1b[0m', err.message);
    process.exit(1);
  });

  // Wait for gateway to be ready (up to ~10 seconds)
  let ready = false;
  for (let i = 0; i < 14; i++) {
    await new Promise(r => setTimeout(r, 700));
    if (await isKrythorRunning()) { ready = true; break; }
    process.stdout.write('.');
  }
  console.log('');

  if (ready) {
    console.log(`\x1b[32m✓ Krythor is running\x1b[0m  →  http://${HOST}:${PORT}`);
    console.log('  Press Ctrl+C to stop the gateway.');
    console.log('');
    console.log(`  Open \x1b[36mhttp://${HOST}:${PORT}\x1b[0m in your browser to get started.`);
    console.log(`  First time? Run the setup wizard:  krythor setup`);
    console.log('');
    // Show data location so users know where their data lives
    const dataDir = process.platform === 'win32'
      ? (process.env['LOCALAPPDATA'] || require('path').join(require('os').homedir(), 'AppData', 'Local')) + '\\Krythor'
      : process.platform === 'darwin'
        ? require('path').join(require('os').homedir(), 'Library', 'Application Support', 'Krythor')
        : require('path').join(require('os').homedir(), '.local', 'share', 'krythor');
    console.log(`\x1b[2m  Control UI:  http://${HOST}:${PORT}\x1b[0m`);
    console.log(`\x1b[2m  Your data:   ${dataDir}\x1b[0m`);
    console.log(`\x1b[2m  Diagnostics: krythor doctor\x1b[0m`);
    console.log(`\x1b[2m  Repair:      krythor repair\x1b[0m`);
    console.log('');
    if (!noBrowser) tryOpen(`http://${HOST}:${PORT}`);
  } else {
    console.log('\x1b[31mKrythor gateway did not start within 10 seconds.\x1b[0m');
    console.log('');
    // Show last lines of the gateway log to surface the actual error
    try {
      const log = fs.readFileSync(logFile, 'utf-8').trim();
      if (log) {
        console.log('  Gateway output:');
        log.split('\n').slice(-20).forEach(l => console.log('    ' + l));
        console.log('');
      }
    } catch { /* log unavailable */ }
    console.log('  To diagnose the issue, run the gateway directly:');
    console.log(`    krythor doctor`);
    console.log('');
    console.log('  Or run the repair check:');
    console.log('    krythor repair');
  }
}

function tryOpen(url) {
  if (noBrowser) return;
  try {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` :
                process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    execSync(cmd, { stdio: 'ignore' });
  } catch { /* browser open is best-effort */ }
}
