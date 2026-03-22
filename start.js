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

// ── krythor security-audit ─────────────────────────────────────────────────
// Runs 7 security checks and prints PASS / WARN / FAIL per item.
// Prints a score X/7 at the end. Exit 0 if all pass, exit 1 if any fail.

async function runSecurityAudit() {
  const fs   = require('fs');
  const os   = require('os');
  const path = require('path');
  const dns  = require('dns');

  const PASS = '\x1b[32mPASS\x1b[0m';
  const WARN = '\x1b[33mWARN\x1b[0m';
  const FAIL = '\x1b[31mFAIL\x1b[0m';
  const check = (label) => process.stdout.write(`  ${label.padEnd(36)} `);

  console.log('\x1b[36m  KRYTHOR\x1b[0m — Security Audit');
  console.log('');

  const dataDir = process.env['KRYTHOR_DATA_DIR'] ||
    (process.platform === 'win32'
      ? path.join(process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local'), 'Krythor')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Krythor')
        : path.join(os.homedir(), '.local', 'share', 'krythor'));
  const configDir = path.join(dataDir, 'config');

  let passed = 0;
  const TOTAL = 7;

  // ── Check 1: Auth token is configured and auth is not disabled ───────────
  check('1. Auth token configured');
  let appCfg = {};
  const appCfgPath = path.join(configDir, 'app-config.json');
  try {
    if (existsSync(appCfgPath)) {
      appCfg = JSON.parse(fs.readFileSync(appCfgPath, 'utf-8'));
    }
  } catch { /* ignore parse errors */ }

  if (appCfg['authDisabled'] === true) {
    console.log(`${FAIL}  — authDisabled=true in app-config.json`);
    console.log('    Anyone who can reach the gateway has full access.');
    console.log('    Fix: remove "authDisabled": true from app-config.json');
  } else {
    const token = appCfg['authToken'] || appCfg['token'] || '';
    if (!token || token.length < 16) {
      console.log(`${WARN}  — no auth token found (gateway may be open)`);
      console.log('    Fix: restart Krythor to generate a token automatically');
    } else {
      console.log(`${PASS}  — token present (${token.length} chars)`);
      passed++;
    }
  }

  // ── Check 2: Gateway bound to loopback only ──────────────────────────────
  check('2. Gateway binds to loopback');
  // We check if the running gateway's /health host matches loopback.
  // If not running, inspect app-config for any custom bindHost setting.
  const bindHost = appCfg['bindHost'] || appCfg['host'] || '127.0.0.1';
  const loopbackHosts = ['127.0.0.1', 'localhost', '::1'];
  if (loopbackHosts.includes(bindHost)) {
    console.log(`${PASS}  — bound to ${bindHost}`);
    passed++;
  } else {
    console.log(`${FAIL}  — gateway configured to bind to ${bindHost}`);
    console.log('    This exposes the gateway to your network.');
    console.log(`    Fix: remove "bindHost" or "host" from app-config.json`);
  }

  // ── Check 3: CORS not expanded beyond loopback ───────────────────────────
  check('3. CORS restricted to loopback');
  const corsOrigins = process.env['CORS_ORIGINS'] || '';
  if (corsOrigins.trim().length > 0) {
    console.log(`${WARN}  — CORS_ORIGINS env var is set`);
    console.log(`    Allowed origins: ${corsOrigins}`);
    console.log('    Review whether non-loopback origins are intentional.');
  } else {
    console.log(`${PASS}  — CORS_ORIGINS not set (loopback only)`);
    passed++;
  }

  // ── Check 4: Guard engine policy is present ──────────────────────────────
  check('4. Guard policy file exists');
  const policyPath = path.join(configDir, 'policy.json');
  if (!existsSync(policyPath)) {
    console.log(`${WARN}  — policy.json not found`);
    console.log('    Guard engine starts with empty policy (allow-all default).');
    console.log('    Fix: open the Guard tab in the Control UI to configure rules');
  } else {
    let policy = {};
    try { policy = JSON.parse(fs.readFileSync(policyPath, 'utf-8')); } catch { /* ignore */ }
    const rules = Array.isArray(policy['rules']) ? policy['rules'] : [];
    const enabledRules = rules.filter(r => r && r.enabled !== false);
    const defaultAction = policy['defaultAction'] || 'allow';
    if (enabledRules.length > 0 || defaultAction === 'deny') {
      console.log(`${PASS}  — ${enabledRules.length} enabled rule(s), default=${defaultAction}`);
      passed++;
    } else {
      console.log(`${WARN}  — 0 enabled rules and defaultAction=allow (no restrictions)`);
      console.log('    Fix: add Guard rules in the Control UI → Guard tab');
    }
  }

  // ── Check 5: No cloud providers without credentials ──────────────────────
  check('5. Cloud providers have credentials');
  const providersPath = path.join(configDir, 'providers.json');
  let providerList = [];
  if (existsSync(providersPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(providersPath, 'utf-8'));
      providerList = Array.isArray(raw) ? raw
        : (raw && Array.isArray(raw['providers']) ? raw['providers'] : []);
    } catch { /* ignore */ }
  }
  const cloudTypes = ['anthropic', 'openai', 'openai-compat'];
  const unauthCloud = providerList.filter(p =>
    p && p.isEnabled !== false &&
    cloudTypes.includes(p.type) &&
    (p.authMethod === 'none' || (!p.authMethod && !p.apiKey && !p.oauthAccount))
  );
  if (unauthCloud.length > 0) {
    console.log(`${WARN}  — ${unauthCloud.length} cloud provider(s) have no credentials`);
    unauthCloud.forEach(p => console.log(`    · ${p.name || p.id} (${p.type})`));
    console.log('    Fix: add API keys in the Models tab');
  } else {
    console.log(`${PASS}  — all enabled cloud providers have credentials`);
    passed++;
  }

  // ── Check 6: No API key patterns in process.env ──────────────────────────
  check('6. No secrets in env vars');
  // Looks for common secret patterns that may have leaked into the environment.
  // Providers are expected to store keys in providers.json, not env vars.
  const secretPatterns = [
    /^sk-ant-/i,          // Anthropic
    /^sk-[a-z0-9]{32,}/i, // OpenAI-style
    /^AIza/,              // Google
    /^xoxb-/,             // Slack bot token
    /^ghp_/,              // GitHub PAT
  ];
  const suspiciousEnvKeys = Object.entries(process.env).filter(([, val]) => {
    if (typeof val !== 'string' || val.length < 20) return false;
    return secretPatterns.some(re => re.test(val));
  }).map(([k]) => k);
  if (suspiciousEnvKeys.length > 0) {
    console.log(`${WARN}  — ${suspiciousEnvKeys.length} env var(s) look like API keys`);
    suspiciousEnvKeys.forEach(k => console.log(`    · ${k}`));
    console.log('    Review whether these are intentionally set.');
    console.log('    Store API keys in providers.json (encrypted at rest) instead.');
  } else {
    console.log(`${PASS}  — no obvious API key patterns found in env vars`);
    passed++;
  }

  // ── Check 7: providers.json uses ${ENV_VAR} safely (no plaintext keys) ───
  check('7. API keys encrypted at rest');
  const ENCRYPTION_PREFIX = 'e1:';
  let plaintextKeyCount = 0;
  for (const p of providerList) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p['apiKey'] === 'string' && p['apiKey'].length > 0) {
      if (!p['apiKey'].startsWith(ENCRYPTION_PREFIX) && !p['apiKey'].startsWith('${')) {
        plaintextKeyCount++;
      }
    }
  }
  if (plaintextKeyCount > 0) {
    console.log(`${FAIL}  — ${plaintextKeyCount} provider(s) have unencrypted API keys in providers.json`);
    console.log('    Fix: restart Krythor — it auto-encrypts keys on load');
  } else {
    console.log(`${PASS}  — all API keys are encrypted or use env var placeholders`);
    passed++;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  const scoreColour = passed === TOTAL ? '\x1b[32m' : passed >= TOTAL - 2 ? '\x1b[33m' : '\x1b[31m';
  console.log(`  Security score: ${scoreColour}${passed}/${TOTAL}\x1b[0m checks passed`);
  console.log('');
  if (passed === TOTAL) {
    console.log('\x1b[32m  All security checks passed.\x1b[0m');
  } else {
    console.log('\x1b[33m  Review the items above and address any WARN or FAIL entries.\x1b[0m');
  }
  console.log('');
  process.exit(passed === TOTAL ? 0 : 1);
}

// ── krythor tui ────────────────────────────────────────────────────────────
// Lightweight terminal dashboard. Polls /health every 5 seconds and re-renders.
// Shows: gateway status, provider list, recent memory entries, last 5 commands.
// Commands: q (quit), r (refresh), s (status), h (help), or type a message to chat.
// Uses only Node.js built-ins (readline, process.stdout).

async function runTui() {
  const readline = require('readline');

  // Put terminal in raw mode so we can detect individual keypresses
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
  }

  let running = true;
  let lastData = null;
  let tick = 0;
  let inputBuf = '';          // current command buffer being typed
  let lastResponse = null;    // last inline response to show
  let sending = false;        // true while a command is being dispatched

  /** Read the auth token from the gateway's app-config.json for API calls. */
  function getTuiToken() {
    try {
      const path = require('path');
      const fs = require('fs');
      const cfgPath = path.join(getDataDirForUpdates(), 'config', 'app-config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      return cfg.authToken || cfg.token || null;
    } catch { return null; }
  }

  function cleanup() {
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    process.stdout.write('\x1b[?25h'); // show cursor
    process.stdout.write('\n');
  }

  function cls() {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  const HELP_TEXT = [
    'TUI commands:',
    '  q         — quit',
    '  r         — refresh now',
    '  s         — show status line',
    '  h         — show this help',
    '  <message> — send message to gateway (/api/command)',
    '  Enter     — submit typed command/message',
    '  Backspace — delete last character',
  ];

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
    process.stdout.write(`${c}${b}  KRYTHOR TUI${rs}${d}  —  ${now}  —  q=quit  r=refresh  h=help${rs}\n`);
    process.stdout.write(`${d}  ─────────────────────────────────────────────────────${rs}\n`);
    process.stdout.write('\n');

    if (!data) {
      process.stdout.write(`  ${r}Gateway not reachable${rs}  (${HOST}:${PORT})\n`);
      process.stdout.write(`${d}  Start with: krythor${rs}\n`);
      process.stdout.write('\n');
      process.stdout.write(`${d}  Retrying every 5 seconds…${rs}\n`);
    } else {
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

    // Inline response area
    if (lastResponse) {
      process.stdout.write('\n');
      process.stdout.write(`${d}  ─────────────────────────────────────────────────────${rs}\n`);
      const lines = lastResponse.split('\n').slice(0, 6);
      lines.forEach(line => process.stdout.write(`  ${line}\n`));
    }

    // Command input line at the bottom
    process.stdout.write('\n');
    process.stdout.write(`${d}  ─────────────────────────────────────────────────────${rs}\n`);
    if (sending) {
      process.stdout.write(`  ${d}Sending…${rs}\n`);
    } else {
      process.stdout.write(`  ${d}>${rs} ${inputBuf}${g}▌${rs}\n`);
    }
  }

  async function dispatchCommand(cmd) {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    if (trimmed === 'q') { running = false; cleanup(); process.exit(0); }
    if (trimmed === 'h') { lastResponse = HELP_TEXT.join('\n'); return; }
    if (trimmed === 'r') { lastResponse = null; await poll(); return; }
    if (trimmed === 's') {
      if (lastData) {
        const m = lastData.models || {};
        lastResponse = `status: ${lastData.status}  v${lastData.version}  providers:${m.providerCount || 0}  models:${m.modelCount || 0}`;
      } else {
        lastResponse = 'Gateway not reachable.';
      }
      return;
    }

    // Treat as a chat message — send to /api/command
    const token = getTuiToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    sending = true;
    render(lastData);
    try {
      const resp = await fetch(`http://${HOST}:${PORT}/api/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: trimmed }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await resp.json();
      if (resp.ok) {
        const out = body.output || body.error || JSON.stringify(body);
        lastResponse = out.slice(0, 500) + (out.length > 500 ? '…' : '');
      } else {
        lastResponse = `Error: ${body.error || `HTTP ${resp.status}`}`;
      }
    } catch (err) {
      lastResponse = `Request failed: ${err.message || err}`;
    } finally {
      sending = false;
    }
  }

  // Keypress handler — accumulate input or act on special keys
  process.stdin.on('keypress', (str, key) => {
    if (!key) return;

    // Ctrl+C / Ctrl+D — always quit
    if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
      running = false; cleanup(); process.exit(0);
    }

    // Enter — dispatch current buffer
    if (key.name === 'return' || key.name === 'enter') {
      const cmd = inputBuf;
      inputBuf = '';
      void dispatchCommand(cmd).then(() => { if (running) render(lastData); });
      return;
    }

    // Backspace — remove last char
    if (key.name === 'backspace') {
      if (inputBuf.length > 0) {
        inputBuf = inputBuf.slice(0, -1);
        render(lastData);
      }
      return;
    }

    // Escape — clear buffer and response
    if (key.name === 'escape') {
      inputBuf = '';
      lastResponse = null;
      render(lastData);
      return;
    }

    // Printable character — append to buffer
    if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
      inputBuf += str;
      render(lastData);
    }
  });

  function cleanup_exit() {
    cleanup();
    process.exit(0);
  }

  process.on('SIGINT', cleanup_exit);
  process.on('SIGTERM', cleanup_exit);

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

// ── Daemon / process-management helpers ───────────────────────────────────
//
// krythor start --daemon  — spawn gateway detached; write PID to <dataDir>/krythor.pid
// krythor stop            — kill the PID from krythor.pid; remove the file
// krythor restart         — stop then start --daemon
//
// On plain `krythor start` (no --daemon): existing foreground behaviour unchanged.

function getPidFile() {
  return require('path').join(getDataDirForUpdates(), 'krythor.pid');
}

async function runDaemon() {
  const fs = require('fs');
  const path = require('path');

  // If already running, abort gracefully
  if (await isKrythorRunning()) {
    console.log('\x1b[32m  Krythor is already running.\x1b[0m');
    console.log(`  Control UI: http://${HOST}:${PORT}`);
    process.exit(0);
  }

  console.log('\x1b[36m  KRYTHOR\x1b[0m — Starting daemon…');

  const logFile = path.join(require('os').tmpdir(), 'krythor-gateway.log');
  const logStream = fs.openSync(logFile, 'w');

  const child = spawn(NODE_BIN, [gatewayDist], {
    stdio: ['ignore', logStream, logStream],
    detached: true,
  });
  child.unref();

  // Wait up to 10 seconds for gateway to respond
  let ready = false;
  for (let i = 0; i < 14; i++) {
    await new Promise(r => setTimeout(r, 700));
    if (await isKrythorRunning()) { ready = true; break; }
  }

  if (!ready) {
    console.error('\x1b[31m  Gateway did not start within 10 seconds.\x1b[0m');
    try {
      const log = fs.readFileSync(logFile, 'utf-8').trim();
      if (log) {
        console.error('  Gateway output:');
        log.split('\n').slice(-10).forEach(l => console.error('    ' + l));
      }
    } catch {}
    process.exit(1);
  }

  // Write PID file
  const pidFile = getPidFile();
  try {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(child.pid), 'utf-8');
  } catch { /* PID file write is best-effort */ }

  console.log(`\x1b[32m  Krythor started (PID ${child.pid})\x1b[0m`);
  console.log(`  Control UI: http://${HOST}:${PORT}`);
  console.log(`  Stop with:  krythor stop`);
  console.log('');
}

async function runStop() {
  const fs = require('fs');
  const pidFile = getPidFile();

  // First try reading PID from file
  let pid;
  try {
    const raw = fs.readFileSync(pidFile, 'utf-8').trim();
    pid = parseInt(raw, 10);
  } catch { /* no PID file — attempt to find by port */ }

  if (!pid || isNaN(pid)) {
    // No PID file — check if gateway is running at all
    if (!await isKrythorRunning()) {
      console.log('\x1b[33m  Krythor is not running.\x1b[0m');
      process.exit(0);
    }
    console.log('\x1b[33m  No PID file found. If Krythor is running in foreground, press Ctrl+C in that terminal.\x1b[0m');
    process.exit(1);
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    // Process may already be gone
    console.log('\x1b[33m  Process not found (may have already stopped).\x1b[0m');
  }

  // Remove PID file
  try { fs.unlinkSync(pidFile); } catch {}

  // Wait briefly to confirm it stopped
  await new Promise(r => setTimeout(r, 800));
  if (await isKrythorRunning()) {
    console.log('\x1b[33m  Gateway is still responding — it may take a moment to shut down.\x1b[0m');
  } else {
    console.log(`\x1b[32m  Krythor stopped\x1b[0m`);
  }
}

async function runRestart() {
  await runStop();
  await new Promise(r => setTimeout(r, 1000));
  await runDaemon();
}

// ── krythor backup ─────────────────────────────────────────────────────────
// Creates a timestamped archive of the data directory.
// Windows: PowerShell Compress-Archive; Mac/Linux: zip or tar.

async function runBackup() {
  const fs = require('fs');
  const path = require('path');
  const cp = require('child_process');

  const outputArg = (() => {
    const idx = process.argv.indexOf('--output');
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    return null;
  })();

  const dataDir = getDataDirForUpdates();
  if (!fs.existsSync(dataDir)) {
    console.error('\x1b[31m  Data directory not found:\x1b[0m', dataDir);
    process.exit(1);
  }

  // Build timestamped filename
  const now = new Date();
  const ts = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  const archiveName = `krythor-backup-${ts}`;
  const destDir = outputArg || process.cwd();

  console.log('\x1b[36m  KRYTHOR\x1b[0m — Backup');
  console.log(`  Source: ${dataDir}`);

  let archivePath;

  if (process.platform === 'win32') {
    archivePath = path.join(destDir, `${archiveName}.zip`);
    try {
      cp.execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${dataDir}' -DestinationPath '${archivePath}' -Force"`,
        { stdio: 'pipe' }
      );
    } catch (e) {
      console.error('\x1b[31m  Backup failed:\x1b[0m', e.message || String(e));
      process.exit(1);
    }
  } else {
    // Prefer zip; fall back to tar
    let useZip = false;
    try { cp.execSync('which zip', { stdio: 'pipe' }); useZip = true; } catch {}
    if (useZip) {
      archivePath = path.join(destDir, `${archiveName}.zip`);
      try {
        cp.execSync(`zip -r "${archivePath}" "${dataDir}"`, { stdio: 'pipe' });
      } catch (e) {
        console.error('\x1b[31m  Backup failed:\x1b[0m', e.message || String(e));
        process.exit(1);
      }
    } else {
      archivePath = path.join(destDir, `${archiveName}.tar.gz`);
      try {
        cp.execSync(`tar -czf "${archivePath}" -C "${path.dirname(dataDir)}" "${path.basename(dataDir)}"`, { stdio: 'pipe' });
      } catch (e) {
        console.error('\x1b[31m  Backup failed:\x1b[0m', e.message || String(e));
        process.exit(1);
      }
    }
  }

  // Report size
  let sizeStr = '';
  try {
    const bytes = fs.statSync(archivePath).size;
    if (bytes > 1024 * 1024) sizeStr = ` (${(bytes / 1024 / 1024).toFixed(1)} MB)`;
    else sizeStr = ` (${Math.round(bytes / 1024)} KB)`;
  } catch {}

  console.log(`\x1b[32m  Backup saved to:\x1b[0m ${archivePath}${sizeStr}`);
  console.log('');
  process.exit(0);
}

// ── krythor uninstall ──────────────────────────────────────────────────────
// Removes the install directory (~/.krythor on Mac/Linux; the Krythor app folder
// on Windows). User data at LOCALAPPDATA\Krythor is always preserved.

async function runUninstall() {
  const fs = require('fs');
  const path = require('path');
  const readline = require('readline');

  // Determine install dir (where start.js lives) vs data dir (where data lives)
  const installDir = __dirname;
  const dataDir = getDataDirForUpdates();

  console.log('\x1b[36m  KRYTHOR\x1b[0m — Uninstall');
  console.log('');

  // Compute what will be removed
  console.log(`  This will remove the Krythor installation at:`);
  console.log(`    ${installDir}`);
  console.log('');
  console.log(`  Your data at:`);
  console.log(`    ${dataDir}`);
  console.log(`  is \x1b[32mpreserved\x1b[0m — it will not be touched.`);
  console.log('');

  // Prompt
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question('  Continue? [y/N] ', ans => { rl.close(); resolve(ans.trim().toLowerCase()); });
  });

  if (answer !== 'y') {
    console.log('  Uninstall cancelled.');
    process.exit(0);
  }

  // Stop daemon if running
  const pidFile = getPidFile();
  try {
    const raw = fs.readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    if (!isNaN(pid)) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
      console.log(`  Stopped running gateway (PID ${pid}).`);
    }
    try { fs.unlinkSync(pidFile); } catch {}
  } catch { /* no PID file — fine */ }

  // Remove install directory
  try {
    fs.rmSync(installDir, { recursive: true, force: true });
    console.log(`  Removed: ${installDir}`);
  } catch (e) {
    console.error(`\x1b[31m  Failed to remove ${installDir}:\x1b[0m ${e.message}`);
    console.log('  You may need to remove it manually.');
  }

  console.log('');
  console.log('\x1b[32m  Krythor has been uninstalled.\x1b[0m');
  console.log('');
  if (process.platform === 'win32') {
    console.log('  To complete removal, also remove the PATH entry in:');
    console.log('    Settings > System > About > Advanced system settings > Environment Variables');
    console.log('  Remove the entry pointing to the Krythor bin/ folder.');
  } else {
    console.log('  To complete removal, remove any PATH entry in your shell config:');
    console.log('    ~/.bashrc, ~/.zshrc, or ~/.profile');
    console.log('  Look for a line containing "krythor" or the path above.');
  }
  console.log('');
  process.exit(0);
}

// ── krythor help ───────────────────────────────────────────────────────────
// Prints a list of all available commands, or detailed help for one command.

const COMMAND_HELP = {
  start: {
    summary: 'Start the Krythor gateway (foreground)',
    detail: [
      'Usage: krythor [start] [--daemon] [--no-browser] [--no-update-check]',
      '',
      '  (no flags)       Start in foreground. Press Ctrl+C to stop.',
      '  --daemon         Start as a detached background process.',
      '                   Writes PID to <dataDir>/krythor.pid.',
      '  --no-browser     Do not open the Control UI in the browser.',
      '  --no-update-check  Skip the GitHub update check at startup.',
    ],
  },
  stop: {
    summary: 'Stop the background daemon',
    detail: [
      'Usage: krythor stop',
      '',
      'Reads the PID from <dataDir>/krythor.pid and sends SIGTERM.',
      'Removes the PID file after stopping.',
      '',
      'If no PID file exists and the gateway is not responding, reports not running.',
    ],
  },
  restart: {
    summary: 'Restart the background daemon (stop + start --daemon)',
    detail: [
      'Usage: krythor restart',
      '',
      'Stops the running daemon (if any), then starts a new one.',
      'Equivalent to: krythor stop && krythor start --daemon',
    ],
  },
  status: {
    summary: 'Quick health check of the running gateway',
    detail: [
      'Usage: krythor status [--json]',
      '',
      'Hits GET /health and prints: version, providers, models, agents,',
      'memory entry count, embedding status, heartbeat status, data dir.',
      '',
      '  --json   Emit raw health payload as JSON (useful for scripting).',
      '',
      'Exit 0 if gateway responds, exit 1 if not reachable.',
    ],
  },
  tui: {
    summary: 'Terminal dashboard — live status view',
    detail: [
      'Usage: krythor tui',
      '',
      'Polls GET /health every 5 seconds and renders a live dashboard.',
      'Shows: gateway status, providers, models, agents, memory, heartbeat, tokens.',
      '',
      'Press q, Ctrl+C, or Ctrl+D to exit.',
      'Works even when the gateway is offline — shows a reconnecting state.',
    ],
  },
  update: {
    summary: 'Print one-line update instructions',
    detail: [
      'Usage: krythor update',
      '',
      'Prints the platform-specific one-line installer command to update Krythor.',
      'Run that command to download and install the latest release.',
      '',
      'Your data, settings, and memory are always preserved during updates.',
    ],
  },
  repair: {
    summary: 'Check runtime components and credentials',
    detail: [
      'Usage: krythor repair',
      '',
      'Checks:',
      '  1. Bundled Node runtime — exists and executes',
      '  2. better-sqlite3 native module — loads under bundled Node',
      '  3. Gateway health endpoint — responds (if already running)',
      '  4. providers.json — exists and is valid JSON',
      '  5. Provider count — warns if zero',
      '  6. Per-provider credentials — API key or OAuth present',
      '',
      'Exit 0 if all checks pass, exit 1 if any fail.',
    ],
  },
  setup: {
    summary: 'Run the interactive setup wizard',
    detail: [
      'Usage: krythor setup',
      '',
      'Guides you through:',
      '  - Provider selection (Anthropic, OpenAI, Ollama, etc.)',
      '  - API key or OAuth configuration',
      '  - Model selection',
      '  - Default agent creation',
      '  - Gateway launch',
      '',
      'Safe to re-run — will ask before overwriting existing config.',
    ],
  },
  doctor: {
    summary: 'Full diagnostics report',
    detail: [
      'Usage: krythor doctor',
      '',
      'Checks:',
      '  - Node.js version',
      '  - Config directory and files',
      '  - providers.json — count, auth, per-provider status',
      '  - agents.json — count',
      '  - Memory database — exists, size',
      '  - Gateway — running, version, provider count',
      '  - Embedding — active or keyword-only',
      '  - Migration integrity',
      '  - Stale agent model references',
      '',
      'Prints PASS / WARN / FAIL per check. Exit 1 on critical issues.',
    ],
  },
  backup: {
    summary: 'Create a timestamped backup of the data directory',
    detail: [
      'Usage: krythor backup [--output <dir>]',
      '',
      '  --output <dir>   Save backup to <dir> instead of current directory.',
      '',
      'Creates a zip or tar.gz of <dataDir> with a timestamped filename:',
      '  krythor-backup-YYYY-MM-DD-HHmmss.zip',
      '',
      'Windows: uses PowerShell Compress-Archive.',
      'Mac/Linux: uses zip (falls back to tar).',
      '',
      'Prints the backup path and file size when complete.',
    ],
  },
  uninstall: {
    summary: 'Remove the Krythor installation',
    detail: [
      'Usage: krythor uninstall',
      '',
      'Stops the daemon (if running), then removes the Krythor install directory.',
      '',
      'Your data at:',
      `  Windows: %LOCALAPPDATA%\\Krythor`,
      `  macOS:   ~/Library/Application Support/Krythor`,
      `  Linux:   ~/.local/share/krythor`,
      'is PRESERVED — it is never deleted by uninstall.',
      '',
      'After uninstalling, also remove the PATH entry from your shell config.',
    ],
  },
  'security-audit': {
    summary: 'Run a security hardening check (7 checks, scored)',
    detail: [
      'Usage: krythor security-audit',
      '',
      'Checks:',
      '  1. Auth token is configured and auth is not disabled',
      '  2. Gateway binds to loopback (127.0.0.1) only',
      '  3. CORS not expanded beyond loopback via CORS_ORIGINS',
      '  4. Guard policy.json exists with rules or deny default',
      '  5. Enabled cloud providers all have credentials',
      '  6. No obvious API key patterns found in process.env',
      '  7. All API keys in providers.json are encrypted at rest',
      '',
      'Prints PASS / WARN / FAIL for each check.',
      'Security score: X/7 checks passed.',
      '',
      'Exit 0 if all 7 pass, exit 1 if any WARN or FAIL.',
    ],
  },
  help: {
    summary: 'Print this help text',
    detail: [
      'Usage: krythor help [<command>]',
      '',
      'Without arguments: lists all commands with short descriptions.',
      'With a command name: prints detailed help for that command.',
      '',
      'Examples:',
      '  krythor help',
      '  krythor help start',
      '  krythor help doctor',
      '  krythor help security-audit',
    ],
  },
};

function runHelp() {
  const d  = '\x1b[2m';
  const g  = '\x1b[32m';
  const c  = '\x1b[36m';
  const b  = '\x1b[1m';
  const rs = '\x1b[0m';

  // Check if a specific command was requested: `krythor help <cmd>`
  const helpCmdArg = process.argv[3]; // argv[2] === 'help', argv[3] is the sub-command

  if (helpCmdArg && COMMAND_HELP[helpCmdArg]) {
    const info = COMMAND_HELP[helpCmdArg];
    console.log(`${c}  KRYTHOR${rs} — ${b}${helpCmdArg}${rs}`);
    console.log('');
    console.log(`  ${info.summary}`);
    console.log('');
    for (const line of info.detail) {
      console.log(line ? `  ${line}` : '');
    }
    console.log('');
    process.exit(0);
  }

  if (helpCmdArg) {
    console.log(`\x1b[31m  Unknown command:\x1b[0m ${helpCmdArg}`);
    console.log(`  Run \x1b[36mkrythor help\x1b[0m to see all commands.`);
    console.log('');
    process.exit(1);
  }

  // Full command listing
  const versionTag = KRYTHOR_VERSION ? ` v${KRYTHOR_VERSION}` : '';
  console.log(`${c}  KRYTHOR${rs}${d}${versionTag}${rs} — Local-first AI command platform`);
  console.log('');
  console.log(`${b}  Available commands:${rs}`);
  console.log('');
  const maxLen = Math.max(...Object.keys(COMMAND_HELP).map(k => k.length));
  for (const [cmd, info] of Object.entries(COMMAND_HELP)) {
    console.log(`  ${g}${cmd.padEnd(maxLen)}${rs}  ${d}${info.summary}${rs}`);
  }
  console.log('');
  console.log(`${d}  Run \x1b[0m\x1b[36mkrythor help <command>\x1b[0m${d} for detailed usage.${rs}`);
  console.log(`${d}  Gateway UI: http://${HOST}:${PORT}${rs}`);
  console.log('');
  process.exit(0);
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
// ── krythor stop ───────────────────────────────────────────────────────────
else if (process.argv.includes('stop')) {
  runStop().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
}
// ── krythor restart ────────────────────────────────────────────────────────
else if (process.argv.includes('restart')) {
  runRestart().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
}
// ── krythor backup ─────────────────────────────────────────────────────────
else if (process.argv.includes('backup')) {
  runBackup().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
}
// ── krythor uninstall ──────────────────────────────────────────────────────
else if (process.argv.includes('uninstall')) {
  runUninstall().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
}
// ── krythor security-audit ─────────────────────────────────────────────────
else if (process.argv[2] === 'security-audit') {
  runSecurityAudit().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
}
// ── krythor help ───────────────────────────────────────────────────────────
else if (process.argv.includes('help')) {
  runHelp();
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
} else if (process.argv.includes('--daemon')) {
  // krythor start --daemon
  runDaemon().catch(e => {
    console.error('\x1b[31mFatal:\x1b[0m', e.message);
    process.exit(1);
  });
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
