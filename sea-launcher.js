#!/usr/bin/env node
// Krythor launcher — starts the gateway and opens the control UI.
// Usage: node sea-launcher.js [--no-browser]
//
// SEA-aware version of start.js: uses findNodeExe() instead of process.execPath
// when spawning the gateway, so that running as a compiled .exe still works.

// ── Node version check ─────────────────────────────────────────────────────
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error('Krythor requires Node.js 18 or higher. Please update at https://nodejs.org');
  process.exit(1);
}

const { spawn, execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const net = require('net');

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

// ── Find the real node.exe to use for spawning child processes ─────────────
// When running as a SEA executable, process.execPath is the .exe itself.
// We need the real node binary to spawn the gateway as a child process.
// Search order: node.exe next to this executable, then PATH.
function findNodeExe() {
  const { existsSync } = require('fs');
  const { join, dirname } = require('path');

  // 1. node.exe alongside this executable (bundled distribution)
  const sibling = join(dirname(process.execPath), 'node.exe');
  if (existsSync(sibling)) return sibling;

  // 2. node in PATH (dev mode or user has node installed)
  try {
    const { execSync } = require('child_process');
    const result = execSync('where node', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = result.split('\n')[0].trim();
    if (first && existsSync(first)) return first;
  } catch { /* not in PATH */ }

  // 3. Fallback: use process.execPath (dev mode — process.execPath IS node)
  return process.execPath;
}

// ── Validate node.exe is usable when running as SEA ────────────────────────
function assertNodeExe() {
  const isSea = process.execPath.toLowerCase().endsWith('.exe') &&
    !process.execPath.toLowerCase().includes('node');
  if (!isSea) return; // running as plain node — no check needed

  const nodeExe = findNodeExe();
  // If findNodeExe returned process.execPath, node.exe was not found
  if (nodeExe === process.execPath) {
    console.error('');
    console.error('\x1b[31mKrythor could not start because node.exe was not found beside krythor.exe.\x1b[0m');
    console.error('Re-extract the full package and try again.');
    console.error('');
    process.exit(1);
  }
}

assertNodeExe();

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
  const child = spawn(findNodeExe(), [gatewayDist], {
    stdio: ['ignore', 'ignore', 'ignore'],
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
    console.log('');
    console.log(`  Open \x1b[36mhttp://${HOST}:${PORT}\x1b[0m in your browser to get started.`);
    console.log(`  First time? Run the setup wizard:  node start.js setup`);
    console.log('');
    // Show data location so users know where their data lives
    const dataDir = process.platform === 'win32'
      ? (process.env['LOCALAPPDATA'] || require('path').join(require('os').homedir(), 'AppData', 'Local')) + '\\Krythor'
      : process.platform === 'darwin'
        ? require('path').join(require('os').homedir(), 'Library', 'Application Support', 'Krythor')
        : require('path').join(require('os').homedir(), '.local', 'share', 'krythor');
    console.log(`\x1b[2m  Control UI:  http://${HOST}:${PORT}\x1b[0m`);
    console.log(`\x1b[2m  Your data:   ${dataDir}\x1b[0m`);
    console.log(`\x1b[2m  Diagnostics: node start.js doctor  (or pnpm doctor)\x1b[0m`);
    console.log('');
    if (!noBrowser) tryOpen(`http://${HOST}:${PORT}`);
  } else {
    console.log('\x1b[31mKrythor gateway did not start within 10 seconds.\x1b[0m');
    console.log('');
    console.log('  To diagnose the issue, run the gateway directly:');
    console.log(`    node packages/gateway/dist/index.js`);
    console.log('');
    console.log('  Or run the diagnostic tool:');
    console.log('    node packages/setup/dist/bin/setup.js doctor');
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

// Allow `node sea-launcher.js doctor` as an alias for the doctor command
if (process.argv.includes('doctor')) {
  const { execSync } = require('child_process');
  const { join } = require('path');
  const doctorScript = join(__dirname, 'packages', 'setup', 'dist', 'bin', 'setup.js');
  try {
    execSync(`node "${doctorScript}" doctor`, { stdio: 'inherit' });
  } catch { /* exit code from setup.js propagates */ }
  process.exit(0);
}

main().catch(err => {
  console.error('\x1b[31mFatal:\x1b[0m', err.message);
  process.exit(1);
});
