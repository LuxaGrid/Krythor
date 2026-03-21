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
const noUpdateCheck = process.argv.includes('--no-update-check');

// Read version from package.json (same approach as gateway)
let KRYTHOR_VERSION = '';
try {
  const rootPkg = JSON.parse(require('fs').readFileSync(join(__dirname, 'package.json'), 'utf-8'));
  KRYTHOR_VERSION = rootPkg.version || '';
} catch { /* non-fatal — version display is best-effort */ }

// ── Auto-update check ─────────────────────────────────────────────────────
// Checks GitHub releases API for a newer version in the background.
// Caches the result for 24 hours in the data directory so we don't hit
// GitHub on every launch. Non-blocking — never delays startup.
// Skip with --no-update-check flag.

function getDataDirForUpdates() {
  if (process.env['KRYTHOR_DATA_DIR']) return process.env['KRYTHOR_DATA_DIR'];
  const os = require('os');
  const path = require('path');
  if (process.platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local'), 'Krythor');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Krythor');
  }
  return path.join(os.homedir(), '.local', 'share', 'krythor');
}

/**
 * Compares two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal.
 * Only handles MAJOR.MINOR.PATCH (no pre-release suffixes needed here).
 */
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Check GitHub releases API for the latest Krythor version.
 * Returns { latestVersion, updateAvailable } or null on failure.
 * Results are cached for 24 hours in <dataDir>/update-check.json.
 */
async function checkForUpdate() {
  if (noUpdateCheck || !KRYTHOR_VERSION) return null;
  const path = require('path');
  const fs = require('fs');

  const dataDir  = getDataDirForUpdates();
  const cacheFile = path.join(dataDir, 'update-check.json');
  const ONE_DAY  = 24 * 60 * 60 * 1000;

  // Read cached result if fresh (< 24h)
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    if (Date.now() - (cached.checkedAt || 0) < ONE_DAY && cached.latestVersion) {
      return {
        latestVersion:   cached.latestVersion,
        updateAvailable: compareSemver(cached.latestVersion, KRYTHOR_VERSION) > 0,
      };
    }
  } catch { /* cache missing or invalid — continue */ }

  // Fetch from GitHub
  try {
    const resp = await fetch(
      'https://api.github.com/repos/LuxaGrid/Krythor/releases/latest',
      {
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'Krythor-update-check/1.0', Accept: 'application/vnd.github+json' },
      },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const latestVersion = (data.tag_name || '').replace(/^v/, '');
    if (!latestVersion) return null;

    // Cache the result
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ latestVersion, checkedAt: Date.now() }), 'utf-8');
    } catch { /* cache write failure is non-fatal */ }

    return {
      latestVersion,
      updateAvailable: compareSemver(latestVersion, KRYTHOR_VERSION) > 0,
    };
  } catch { return null; }
}

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

// ── krythor status ─────────────────────────────────────────────────────────
// Quick health summary — hits /health and prints key metrics.
// Exit 0 if gateway responds, exit 1 if not reachable.
// Pass --json for machine-readable JSON output (useful for scripting/CI).
async function runStatus() {
  const jsonMode = process.argv.includes('--json');
  const g = '\x1b[32m';
  const y = '\x1b[33m';
  const r = '\x1b[31m';
  const d = '\x1b[2m';
  const rs = '\x1b[0m';

  if (!jsonMode) {
    process.stdout.write(`${d}  Checking gateway at http://${HOST}:${PORT}…${rs} `);
  }
  try {
    const resp = await fetch(`http://${HOST}:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) {
      if (jsonMode) {
        console.log(JSON.stringify({ ok: false, error: `HTTP ${resp.status}`, url: `http://${HOST}:${PORT}` }));
      } else {
        console.log(`${r}FAIL${rs} (HTTP ${resp.status})`);
      }
      process.exit(1);
    }
    const data = await resp.json();

    if (jsonMode) {
      // Machine-readable output: emit the full health payload with an ok flag
      console.log(JSON.stringify({ ok: true, ...data }, null, 2));
      process.exit(0);
    }

    console.log(`${g}OK${rs}`);
    console.log('');
    console.log(`  ${d}Version${rs}        ${g}${data.version ?? '?'}${rs}`);
    console.log(`  ${d}Node${rs}           ${data.nodeVersion ?? '?'}`);
    console.log(`  ${d}Uptime${rs}         ${data.timestamp ?? 'unknown'}`);
    console.log(`  ${d}Providers${rs}      ${data.models?.providerCount ?? 0}`);
    console.log(`  ${d}Models${rs}         ${data.models?.modelCount ?? 0}`);
    console.log(`  ${d}Agents${rs}         ${data.agents?.agentCount ?? 0}`);
    console.log(`  ${d}Memory${rs}         ${data.memory?.entryCount ?? 0} entries`);
    const embOk = data.memory?.embeddingDegraded === false;
    console.log(`  ${d}Embedding${rs}      ${embOk ? `${g}active${rs} (${data.memory?.embeddingProvider ?? '?'})` : `${y}keyword-only${rs}`}`);
    const hb = data.heartbeat;
    console.log(`  ${d}Heartbeat${rs}      ${hb?.enabled ? `${g}enabled${rs}` : `${y}disabled${rs}`}${hb?.lastRun ? ` — last run: ${hb.lastRun}` : ''}`);
    if (data.firstRun) {
      console.log('');
      console.log(`  ${y}⚠  First run — no providers configured.${rs}`);
      console.log(`  ${d}  Run: krythor setup${rs}`);
    }
    if (data.dataDir) {
      console.log('');
      console.log(`  ${d}Data dir:   ${data.dataDir}${rs}`);
      console.log(`  ${d}Config dir: ${data.configDir}${rs}`);
    }
    console.log('');
    process.exit(0);
  } catch {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: 'gateway not reachable', url: `http://${HOST}:${PORT}` }));
    } else {
      console.log(`${r}not running${rs}`);
      console.log('');
      console.log(`  ${d}Start with: krythor${rs}`);
      console.log('');
    }
    process.exit(1);
  }
}

// ── krythor repair ─────────────────────────────────────────────────────────
// Verify that all runtime components are healthy.
// Each check prints PASS / WARN / FAIL with a fix suggestion on failure.
//   1. Bundled Node runtime exists and executes
//   2. better-sqlite3 native module loads under the bundled Node
//   3. Gateway health endpoint responds (if already running)
//   4. providers.json exists and is parseable JSON
//   5. At least one provider is configured (zero-provider warning)
//   6. All enabled providers have credentials (API key or OAuth)
async function runRepair() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // ANSI helpers
  const PASS  = '\x1b[32mPASS\x1b[0m';
  const WARN  = '\x1b[33mWARN\x1b[0m';
  const FAIL  = '\x1b[31mFAIL\x1b[0m';
  const check = (label) => process.stdout.write(`  ${label.padEnd(28)} ... `);

  console.log('\x1b[36m  KRYTHOR\x1b[0m — Repair / Health Check');
  console.log('');

  let allOk = true;
  const fixes = []; // Suggested fix commands to print at the end

  // ── Check 1: bundled runtime ────────────────────────────────────────────
  check('Bundled Node runtime');
  if (!existsSync(BUNDLED_NODE)) {
    console.log(`${FAIL}  — runtime/ folder missing`);
    console.log(`    Expected: ${BUNDLED_NODE}`);
    console.log('    Fix: Re-download or reinstall Krythor.');
    fixes.push('Re-download Krythor — the runtime/ folder was not found');
    allOk = false;
  } else {
    try {
      const ver = execSync(`"${NODE_BIN}" --version`, { encoding: 'utf-8' }).trim();
      console.log(`${PASS}  (${ver})`);
    } catch (e) {
      console.log(`${FAIL}  — could not execute`);
      console.log(`    Error: ${e.message}`);
      fixes.push('Re-download Krythor — the bundled Node binary could not be executed');
      allOk = false;
    }
  }

  // ── Check 2: better-sqlite3 loads ──────────────────────────────────────
  check('better-sqlite3 module');
  const sqliteDir = join(__dirname, 'node_modules', 'better-sqlite3');
  if (!existsSync(sqliteDir)) {
    console.log(`${FAIL}  — module not found`);
    console.log('    node_modules/better-sqlite3 not found.');
    fixes.push('Re-download or reinstall Krythor — better-sqlite3 is missing');
    allOk = false;
  } else {
    try {
      execSync(
        `"${NODE_BIN}" -e "require('./node_modules/better-sqlite3')"`,
        { cwd: __dirname, stdio: 'pipe', encoding: 'utf-8' }
      );
      console.log(PASS);
    } catch (e) {
      console.log(`${FAIL}  — failed to load`);
      const msg = (e.stderr || e.message || '').toString().split('\n')[0];
      console.log(`    Error: ${msg}`);
      console.log('    The native module may need to be recompiled for this runtime.');
      fixes.push('Run the installer again to recompile better-sqlite3, or contact support');
      allOk = false;
    }
  }

  // ── Check 3: gateway health (only if already running) ──────────────────
  check('Gateway health endpoint');
  if (await isKrythorRunning()) {
    console.log(`${PASS}  (http://${HOST}:${PORT}/health)`);
  } else {
    console.log(`\x1b[2mSKIP\x1b[0m  — not running (start with: krythor)`);
    // Not a failure — gateway not running is expected during repair
  }

  // ── Check 4: providers.json exists and is parseable JSON ───────────────
  const dataDir = process.env['KRYTHOR_DATA_DIR'] ||
    (process.platform === 'win32'
      ? path.join(process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local'), 'Krythor')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Krythor')
        : path.join(os.homedir(), '.local', 'share', 'krythor'));
  const configDir = path.join(dataDir, 'config');
  const providersPath = path.join(configDir, 'providers.json');

  check('providers.json');
  let providerList = [];
  if (!existsSync(providersPath)) {
    console.log(`${WARN}  — file not found`);
    console.log('    providers.json not found — no providers configured.');
    fixes.push('Run: krythor setup  — providers.json is missing');
    allOk = false;
  } else {
    try {
      const raw = JSON.parse(fs.readFileSync(providersPath, 'utf-8'));
      // Handle both formats: flat array or { providers: [] }
      if (Array.isArray(raw)) {
        providerList = raw;
      } else if (raw && typeof raw === 'object' && Array.isArray(raw.providers)) {
        providerList = raw.providers;
      }
      console.log(`${PASS}  (valid JSON, ${providerList.length} provider(s))`);
    } catch (e) {
      console.log(`${FAIL}  — invalid JSON`);
      console.log(`    Error: ${e.message}`);
      console.log(`    File: ${providersPath}`);
      fixes.push('Fix providers.json (syntax error) or run: krythor setup');
      allOk = false;
    }
  }

  // ── Check 5: at least one provider configured ──────────────────────────
  if (existsSync(providersPath) && providerList.length === 0) {
    check('Provider count');
    console.log(`${WARN}  — zero providers configured`);
    console.log('    providers.json is empty — Krythor will start but cannot run AI tasks.');
    fixes.push('Add a provider: krythor setup  OR  open Models tab in the Control UI');
  }

  // ── Check 6: per-provider credential validation ────────────────────────
  if (providerList.length > 0) {
    console.log('  Provider credentials:');
    let credWarnings = 0;
    for (const p of providerList) {
      if (!p || typeof p !== 'object') continue;
      const name = p.name || 'unknown';
      const authMethod = p.authMethod || 'none';
      const isEnabled = p.isEnabled !== false;
      if (!isEnabled) {
        console.log(`    \x1b[2m${name} — disabled (skipped)\x1b[0m`);
        continue;
      }
      if (authMethod === 'api_key') {
        const hasKey = typeof p.apiKey === 'string' && p.apiKey.length > 0;
        if (hasKey) {
          console.log(`    ${PASS}  ${name} — API key present`);
        } else {
          console.log(`    ${FAIL}  ${name} — API key MISSING`);
          console.log(`            Fix: krythor setup  OR  Models tab → edit provider`);
          fixes.push(`Add API key for "${name}": krythor setup  OR  Models tab → edit provider`);
          credWarnings++;
          allOk = false;
        }
      } else if (authMethod === 'oauth') {
        const oa = p.oauthAccount;
        const hasToken = oa && typeof oa.accessToken === 'string' && oa.accessToken.length > 0;
        if (hasToken) {
          const expired = oa.expiresAt && oa.expiresAt < Date.now();
          if (expired) {
            console.log(`    ${WARN}  ${name} — OAuth token EXPIRED`);
            console.log(`            Fix: open Models tab → OAuth to reconnect`);
            fixes.push(`Reconnect OAuth for "${name}": open Models tab → OAuth`);
            credWarnings++;
          } else {
            console.log(`    ${PASS}  ${name} — OAuth connected`);
          }
        } else {
          console.log(`    ${WARN}  ${name} — OAuth not connected`);
          console.log(`            Fix: open Models tab → OAuth to connect`);
          fixes.push(`Connect OAuth for "${name}": open the Models tab → OAuth`);
          credWarnings++;
        }
      } else if (authMethod === 'none') {
        const localTypes = ['ollama', 'gguf', 'openai-compat'];
        if (localTypes.includes(p.type) || !p.type) {
          console.log(`    ${PASS}  ${name} — local/compat provider (no auth required)`);
        } else {
          console.log(`    ${WARN}  ${name} — no auth configured (cloud provider without credentials)`);
          console.log(`            Fix: krythor setup  OR  Models tab → add credentials`);
          fixes.push(`Add credentials for "${name}": krythor setup  OR  Models tab`);
          credWarnings++;
        }
      }
    }
    if (credWarnings > 0) {
      console.log(`\n    \x1b[33m${credWarnings} provider(s) need attention\x1b[0m`);
    }
  }

  console.log('');

  // ── Summary and suggested fixes ────────────────────────────────────────
  if (allOk) {
    console.log('\x1b[32m  All checks passed.\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31m  One or more checks failed. See above for details.\x1b[0m');
    if (fixes.length > 0) {
      console.log('');
      console.log('  Suggested fixes:');
      fixes.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
    }
    process.exit(1);
  }
}

// ── krythor tui ────────────────────────────────────────────────────────────
// Lightweight terminal dashboard. Polls /health every 5 seconds and re-renders.
// Shows: gateway status, provider list, recent memory entries, last 5 commands.
// Press q to quit. Uses only Node.js built-ins (readline, process.stdout).

async function runTui() {
  const readline = require('readline');

  // Put terminal in raw mode so we can detect 'q' without Enter
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
  }

  let running = true;
  let lastData = null;
  let tick = 0;

  // Exit on 'q', Ctrl+C, or Ctrl+D
  process.stdin.on('keypress', (str, key) => {
    if (
      str === 'q' ||
      (key && key.ctrl && (key.name === 'c' || key.name === 'd'))
    ) {
      running = false;
      cleanup();
      process.exit(0);
    }
  });

  function cleanup() {
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    process.stdout.write('\x1b[?25h'); // show cursor
  }

  function cls() {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  function render(data) {
    const g  = '\x1b[32m';
    const y  = '\x1b[33m';
    const r  = '\x1b[31m';
    const c  = '\x1b[36m';
    const d  = '\x1b[2m';
    const b  = '\x1b[1m';
    const rs = '\x1b[0m';

    cls();
    process.stdout.write('\x1b[?25l'); // hide cursor

    const now = new Date().toLocaleTimeString();
    process.stdout.write(`${c}${b}  KRYTHOR TUI${rs}${d}  —  ${now}  —  press q to quit${rs}\n`);
    process.stdout.write(`${d}  ─────────────────────────────────────────────────────${rs}\n`);
    process.stdout.write('\n');

    if (!data) {
      process.stdout.write(`  ${r}Gateway not reachable${rs}  (${HOST}:${PORT})\n`);
      process.stdout.write(`${d}  Start with: krythor${rs}\n`);
      process.stdout.write('\n');
      process.stdout.write(`${d}  Retrying every 5 seconds…${rs}\n`);
      return;
    }

    // Status
    const statusColor = data.status === 'ok' ? g : r;
    process.stdout.write(`  ${b}Gateway${rs}   ${statusColor}${data.status || 'unknown'}${rs}  ${d}v${data.version || '?'}${rs}  ${d}(Node ${data.nodeVersion || '?'})${rs}\n`);

    // Providers / Models
    const prov = data.models || {};
    const provColor = (prov.providerCount || 0) > 0 ? g : y;
    process.stdout.write(`  ${b}Providers${rs} ${provColor}${prov.providerCount || 0}${rs} configured  ${d}${prov.modelCount || 0} models${rs}\n`);

    // Agents
    const ag = data.agents || {};
    process.stdout.write(`  ${b}Agents${rs}    ${g}${ag.agentCount || 0}${rs} defined${ag.activeRunCount > 0 ? `  ${y}${ag.activeRunCount} running${rs}` : ''}\n`);

    // Memory
    const mem = data.memory || {};
    process.stdout.write(`  ${b}Memory${rs}    ${mem.entryCount || 0} entries`);
    if (mem.embeddingDegraded === false) {
      process.stdout.write(`  ${g}embedding active${rs}`);
    } else {
      process.stdout.write(`  ${d}keyword-only${rs}`);
    }
    process.stdout.write('\n');

    // Heartbeat
    const hb = data.heartbeat || {};
    process.stdout.write(`  ${b}Heartbeat${rs} ${hb.enabled ? g + 'enabled' : d + 'disabled'}${rs}`);
    if (hb.lastRun) process.stdout.write(`  ${d}last: ${hb.lastRun}${rs}`);
    if (hb.warnings && hb.warnings.length > 0) process.stdout.write(`  ${y}${hb.warnings.length} warning(s)${rs}`);
    process.stdout.write('\n');

    // Tokens
    if (typeof data.totalTokens === 'number') {
      process.stdout.write(`  ${b}Tokens${rs}    ${data.totalTokens.toLocaleString()} this session\n`);
    }

    process.stdout.write('\n');

    // First-run / no providers warning
    if (data.firstRun || (prov.providerCount || 0) === 0) {
      process.stdout.write(`  ${y}No providers configured.${rs}  Run: ${b}krythor setup${rs}\n`);
      process.stdout.write('\n');
    }

    process.stdout.write(`${d}  ─────────────────────────────────────────────────────${rs}\n`);
    process.stdout.write(`${d}  http://${HOST}:${PORT}  |  ${data.dataDir || ''}${rs}\n`);
    process.stdout.write(`${d}  Polling every 5s  •  tick #${tick}${rs}\n`);
  }

  async function poll() {
    try {
      const resp = await fetch(`http://${HOST}:${PORT}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        lastData = await resp.json();
      } else {
        lastData = null;
      }
    } catch {
      lastData = null;
    }
    tick++;
    if (running) render(lastData);
  }

  // First render immediately
  await poll();

  // Poll every 5 seconds
  const interval = setInterval(async () => {
    if (!running) { clearInterval(interval); return; }
    await poll();
  }, 5000);
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

// ── krythor tui — terminal dashboard ──────────────────────────────────────
if (process.argv.includes('tui')) {
  runTui().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
}
// ── krythor update — print instructions (actual update is the installer) ──
else if (process.argv.includes('update')) {
  console.log('\x1b[36m  KRYTHOR\x1b[0m — Update');
  console.log('');
  console.log('  To update Krythor, run the one-line installer again:');
  console.log('');
  console.log('  \x1b[33mMac / Linux:\x1b[0m');
  console.log('    curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash');
  console.log('');
  console.log('  \x1b[33mWindows (PowerShell):\x1b[0m');
  console.log('    iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex');
  console.log('');
  console.log('  Your settings, memory, and data are always preserved during updates.');
  console.log('');
  process.exit(0);
}
// ── Allow `node start.js status` as a quick health summary ────────────────
else if (process.argv.includes('status')) {
  runStatus().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
} else if (process.argv.includes('repair')) {
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

  // Fire update check in background — result is displayed after gateway starts.
  // Does not await here so it never delays startup.
  const updateCheckPromise = checkForUpdate().catch(() => null);

  // If already running (our process), just open the browser
  if (await isKrythorRunning()) {
    console.log(`\x1b[32m✓ Gateway already running\x1b[0m  →  http://${HOST}:${PORT}`);
    // Show update notice if check resolves quickly
    const upd = await Promise.race([updateCheckPromise, Promise.resolve(null)]);
    if (upd?.updateAvailable) {
      console.log(`\x1b[33m  Update available: v${upd.latestVersion}  —  run: krythor update\x1b[0m`);
    }
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
    // Show data location so users know where their data lives.
    // Respects KRYTHOR_DATA_DIR override if set.
    const dataDir = process.env['KRYTHOR_DATA_DIR'] ||
      (process.platform === 'win32'
        ? (process.env['LOCALAPPDATA'] || require('path').join(require('os').homedir(), 'AppData', 'Local')) + '\\Krythor'
        : process.platform === 'darwin'
          ? require('path').join(require('os').homedir(), 'Library', 'Application Support', 'Krythor')
          : require('path').join(require('os').homedir(), '.local', 'share', 'krythor'));
    console.log(`\x1b[2m  Control UI:  http://${HOST}:${PORT}\x1b[0m`);
    console.log(`\x1b[2m  Your data:   ${dataDir}\x1b[0m`);
    console.log(`\x1b[2m  Diagnostics: krythor doctor\x1b[0m`);
    console.log(`\x1b[2m  Repair:      krythor repair\x1b[0m`);
    console.log('');

    // Show update notice — by now the background check has usually completed.
    // If it hasn't (slow network), we skip to avoid blocking the user.
    const upd = await Promise.race([updateCheckPromise, Promise.resolve(null)]);
    if (upd?.updateAvailable) {
      console.log(`\x1b[33m  Update available: v${upd.latestVersion}  —  run: krythor update\x1b[0m`);
      console.log('');
    }

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
