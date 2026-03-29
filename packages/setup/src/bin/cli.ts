#!/usr/bin/env node
import { readFileSync, existsSync, cpSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';

// ── Config resolution ──────────────────────────────────────────────────────────

function resolveGateway(): { url: string; token: string | null } {
  const url = process.env['KRYTHOR_URL'] ?? 'http://localhost:3001';
  const envToken = process.env['KRYTHOR_GATEWAY_TOKEN'] ?? null;
  if (envToken) return { url, token: envToken };

  // Try reading token from config file
  const cfgPath = join(homedir(), '.krythor', 'app-config.json');
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
      const token = typeof cfg['gatewayToken'] === 'string' ? cfg['gatewayToken'] : null;
      return { url, token };
    } catch { /* ignore */ }
  }
  return { url, token: null };
}

async function apiFetch(path: string, opts?: RequestInit): Promise<unknown> {
  const { url, token } = resolveGateway();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${url}${path}`, { ...opts, headers: { ...headers, ...(opts?.headers as Record<string, string> ?? {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Commands ────────────────────────────────────────────────────────────────────

async function cmdStatus(): Promise<void> {
  try {
    const health = await apiFetch('/api/health') as Record<string, unknown>;
    console.log(`Gateway: ${resolveGateway().url}`);
    console.log(`Status:  ${health['status'] ?? 'unknown'}`);
    if (health['uptime']) console.log(`Uptime:  ${Math.round((health['uptime'] as number) / 60)}m`);
  } catch (err) {
    console.error(`Gateway unreachable: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  try {
    const agents = await apiFetch('/api/agents') as { agents?: unknown[] };
    console.log(`Agents:  ${agents.agents?.length ?? 0}`);
  } catch { /* optional */ }
  try {
    const models = await apiFetch('/api/models') as { providers?: unknown[] };
    console.log(`Providers: ${models.providers?.length ?? 0}`);
  } catch { /* optional */ }
}

async function cmdSessions(): Promise<void> {
  const data = await apiFetch('/api/conversations?limit=20') as { conversations?: Array<{ id: string; title?: string; agentId?: string; updatedAt?: number }> };
  const list = data.conversations ?? [];
  if (list.length === 0) { console.log('No sessions found.'); return; }
  for (const s of list) {
    const ago = s.updatedAt ? `${Math.round((Date.now() - s.updatedAt) / 60000)}m ago` : '';
    console.log(`  ${s.id.slice(0, 8)}  ${(s.title ?? 'Untitled').padEnd(40)}  ${s.agentId ?? ''}  ${ago}`);
  }
}

async function cmdModels(): Promise<void> {
  const data = await apiFetch('/api/models') as { providers?: Array<{ id: string; name?: string; models?: Array<{ id: string; name?: string }> }> };
  const providers = data.providers ?? [];
  if (providers.length === 0) { console.log('No providers configured.'); return; }
  for (const p of providers) {
    console.log(`\n${p.name ?? p.id}`);
    for (const m of p.models ?? []) {
      console.log(`  • ${m.id}`);
    }
  }
}

async function cmdCall(text: string): Promise<void> {
  if (!text.trim()) { console.error('Usage: krythor call <text>'); process.exit(1); }
  const result = await apiFetch('/api/command', {
    method: 'POST',
    body: JSON.stringify({ input: text }),
  }) as { output?: string; error?: string };
  if (result.error) { console.error(result.error); process.exit(1); }
  console.log(result.output ?? '(no response)');
}

async function cmdPolicyShow(): Promise<void> {
  const data = await apiFetch('/api/guard/policy') as { policy?: Record<string, unknown>; rules?: unknown[] };
  if (data.rules) {
    console.log(`Policy has ${(data.rules as unknown[]).length} rule(s):\n`);
    for (const rule of data.rules as Array<Record<string, unknown>>) {
      const enabled = rule['enabled'] !== false ? '' : ' [disabled]';
      console.log(`  [${rule['id'] ?? '?'}]${enabled} ${rule['action'] ?? '?'} — ${rule['description'] ?? rule['operation'] ?? '(no description)'}`);
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function cmdPolicyCheck(operation: string): Promise<void> {
  if (!operation.trim()) { console.error('Usage: krythor policy check <operation>'); process.exit(1); }
  const data = await apiFetch('/api/guard/check', {
    method: 'POST',
    body: JSON.stringify({ operation, source: 'user' }),
  }) as { allowed?: boolean; action?: string; reason?: string; ruleId?: string };
  const allowed = data.allowed === true;
  console.log(`Operation:  ${operation}`);
  console.log(`Verdict:    ${allowed ? 'ALLOW' : 'DENY'}`);
  console.log(`Action:     ${data.action ?? '(unknown)'}`);
  if (data.reason) console.log(`Reason:     ${data.reason}`);
  if (data.ruleId) console.log(`Rule ID:    ${data.ruleId}`);
  process.exit(allowed ? 0 : 1);
}

async function cmdAuditTail(n: number): Promise<void> {
  const data = await apiFetch(`/api/audit?limit=${n}`) as { events?: Array<Record<string, unknown>>; entries?: Array<Record<string, unknown>> };
  const entries = data.events ?? data.entries ?? [];
  if (entries.length === 0) { console.log('No audit entries found.'); return; }
  for (const e of entries) {
    const ts = e['timestamp'] ? new Date(e['timestamp'] as string).toLocaleTimeString() : '?';
    const action = e['actionType'] ?? e['type'] ?? '?';
    const outcome = e['executionOutcome'] ?? e['policyDecision'] ?? '';
    const agent = e['agentId'] ? ` agent:${e['agentId']}` : '';
    console.log(`  [${ts}] ${action}${agent}${outcome ? ` — ${outcome}` : ''}`);
  }
}

async function cmdUpdate(channel?: string): Promise<void> {
  const ch = (channel === 'beta' || channel === 'dev') ? channel : 'stable';
  let info: Record<string, unknown>;
  try {
    info = await apiFetch(`/api/update/check${ch !== 'stable' ? `?channel=${ch}` : ''}`) as Record<string, unknown>;
  } catch (err) {
    console.error(`Could not reach gateway: ${err instanceof Error ? err.message : String(err)}`);
    console.log('Tip: start the gateway first with `krythor-setup start`, then run `krythor update`.');
    process.exit(1);
    return;
  }

  const current = info['currentVersion'] as string ?? '?';
  const latest  = info['latestVersion'] as string | null ?? null;
  const available = info['updateAvailable'] as boolean ?? false;
  const notes   = info['releaseNotes'] as string | null ?? null;
  const url     = info['releaseUrl'] as string | null ?? null;

  console.log(`Current version: v${current}`);
  if (!latest) {
    console.log('Could not reach GitHub to check for updates.');
    return;
  }

  if (!available) {
    console.log(`Latest version:  v${latest}`);
    console.log('You are up to date.');
    return;
  }

  console.log(`Latest version:  v${latest}  ← update available`);
  if (notes) {
    console.log('\nRelease notes:');
    console.log(notes.slice(0, 600) + (notes.length > 600 ? '\n…' : ''));
  }
  if (url) console.log(`\nRelease:  ${url}`);
  console.log('\nTo update, run:');
  console.log('  npm install -g krythor');
  console.log('  # or, if installed locally:');
  console.log('  npm install krythor@latest');
}

/**
 * Sync local monorepo dist builds into the installed ~/.krythor location.
 * Useful when developing from the repo and wanting the install to reflect
 * latest changes without a full GitHub release cycle.
 */
function cmdSync(fromArg?: string): void {
  // This cli.js lives at: <repo>/packages/setup/dist/bin/cli.js (dev) or
  // ~/.krythor/packages/setup/dist/bin/cli.js (installed).
  // Resolve monorepo root: use --from=<path> if provided, otherwise 4 levels up,
  // but validate it has pnpm-workspace.yaml so we don't accidentally use installRoot.
  const installRoot = join(homedir(), '.krythor');
  let repoRoot = fromArg ?? join(__dirname, '..', '..', '..', '..');

  if (!existsSync(join(repoRoot, 'pnpm-workspace.yaml'))) {
    // Fallback: check common dev locations
    const candidates = ['C:/Krythor', join(homedir(), 'Krythor'), join(homedir(), 'krythor')];
    const found = candidates.find(c => existsSync(join(c, 'pnpm-workspace.yaml')));
    if (found) {
      repoRoot = found;
    } else {
      console.error('Cannot locate monorepo root. Run from the repo or pass --from=<repo-path>.');
      console.error('  Example: krythor sync --from=C:/Krythor');
      process.exit(1);
    }
  }

  // Guard: src and dst must differ
  const repoReal = repoRoot.replace(/\\/g, '/').toLowerCase();
  const installReal = installRoot.replace(/\\/g, '/').toLowerCase();
  if (repoReal === installReal) {
    console.error(`Monorepo root and install root are the same directory (${installRoot}).`);
    console.error('Nothing to sync — you are already running from the install location.');
    process.exit(1);
  }

  if (!existsSync(join(installRoot, 'package.json'))) {
    console.error(`No installation found at ${installRoot}`);
    console.error('Run the setup wizard first: krythor-setup');
    process.exit(1);
  }

  const pkgs = ['control', 'gateway', 'core', 'guard', 'setup', 'memory', 'models', 'skills'];
  let synced = 0;

  for (const pkg of pkgs) {
    const srcDist = join(repoRoot, 'packages', pkg, 'dist');
    const dstDist = join(installRoot, 'packages', pkg, 'dist');
    if (!existsSync(srcDist)) {
      console.log(`  skip  ${pkg} (no dist — run pnpm build first)`);
      continue;
    }
    if (!existsSync(dstDist)) {
      console.log(`  skip  ${pkg} (not installed at ${dstDist})`);
      continue;
    }
    try {
      // For control: remove old hashed assets so stale files don't pile up
      if (pkg === 'control') {
        const assetsDir = join(dstDist, 'assets');
        if (existsSync(assetsDir)) {
          readdirSync(assetsDir).forEach(f => rmSync(join(assetsDir, f)));
        }
      }
      cpSync(srcDist, dstDist, { recursive: true, force: true });

      // Inject cache-busting version into sw.js after copy.
      // Always stamp a fresh timestamp so every sync forces the browser to
      // evict old cached assets — even if deploy-dist.js already ran.
      if (pkg === 'control') {
        const swPath = join(dstDist, 'sw.js');
        if (existsSync(swPath)) {
          const controlPkgPath = join(srcDist, '..', 'package.json');
          let version = 'dev';
          if (existsSync(controlPkgPath)) {
            try { version = (JSON.parse(readFileSync(controlPkgPath, 'utf-8')) as Record<string, string>)['version'] ?? 'dev'; } catch { /* ignore */ }
          }
          const cacheName = `krythor-${version}-${Date.now()}`;
          const sw = readFileSync(swPath, 'utf-8');
          // Replace placeholder OR re-stamp an already-injected version line
          const patched = sw
            .replace('__KRYTHOR_CACHE_VERSION__', cacheName)
            .replace(/krythor-[\d.]+-(?:build|\d+)/, cacheName);
          writeFileSync(swPath, patched, 'utf-8');
          console.log(`  sw    cache version: ${cacheName}`);
        }
      }

      console.log(`  ok    ${pkg}`);
      synced++;
    } catch (err) {
      console.error(`  fail  ${pkg}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nSynced ${synced}/${pkgs.length} packages.`);
  console.log('Restart the gateway for changes to take effect: Krythor.bat (or start.js)');
}

function cmdDoctor(extraArgs: string[]): void {
  // Delegate to krythor-setup (same package, different bin entry point)
  const setupBin = join(__dirname, 'setup.js');
  const result = spawnSync(process.execPath, [setupBin, 'doctor', ...extraArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 0);
}

async function cmdApprovalsPending(): Promise<void> {
  const data = await apiFetch('/api/approvals') as { approvals?: Array<Record<string, unknown>>; count?: number };
  const approvals = data.approvals ?? [];
  if (approvals.length === 0) { console.log('No pending approvals.'); return; }
  console.log(`Pending approvals: ${approvals.length}\n`);
  for (const a of approvals) {
    const expires = a['expiresAt'] ? `expires in ${Math.max(0, Math.round(((a['expiresAt'] as number) - Date.now()) / 1000))}s` : '';
    console.log(`  [${a['id']}] ${a['actionType'] ?? '?'}${a['agentId'] ? ` (agent: ${a['agentId']})` : ''}`);
    if (a['target']) console.log(`    target: ${a['target']}`);
    console.log(`    reason: ${a['reason'] ?? '(none)'}`);
    if (expires) console.log(`    ${expires}`);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;

(async () => {
  // Handle multi-word sub-commands: "policy show", "policy check <op>", "audit tail", "approvals pending"
  const fullCmd = [cmd, rest[0]].filter(Boolean).join(' ');

  if (fullCmd === 'policy show') { await cmdPolicyShow(); return; }
  if (fullCmd === 'policy check') { await cmdPolicyCheck(rest.slice(1).join(' ')); return; }
  if (cmd === 'policy' && rest[0] === 'check') { await cmdPolicyCheck(rest.slice(1).join(' ')); return; }

  if (fullCmd === 'audit tail') {
    const nFlag = rest.slice(1).find(a => a.startsWith('--n='));
    const n = nFlag ? parseInt(nFlag.replace('--n=', ''), 10) : 20;
    await cmdAuditTail(isNaN(n) ? 20 : n);
    return;
  }

  if (fullCmd === 'approvals pending') { await cmdApprovalsPending(); return; }

  switch (cmd) {
    case 'status':   await cmdStatus(); break;
    case 'sessions': await cmdSessions(); break;
    case 'models':   await cmdModels(); break;
    case 'call':     await cmdCall(rest.join(' ')); break;
    case 'update':   await cmdUpdate(rest[0]); break;
    case 'sync': {
      const fromFlag = rest.find(a => a.startsWith('--from='));
      cmdSync(fromFlag ? fromFlag.replace('--from=', '') : undefined);
      break;
    }
    case 'doctor':   cmdDoctor(rest); break;
    default:
      console.log('Usage: krythor <command>');
      console.log('  status               — check gateway health and agent/model counts');
      console.log('  sessions             — list recent sessions');
      console.log('  models               — list configured providers and models');
      console.log('  call <text>          — send a one-shot message to the default agent');
      console.log('  update [beta|dev]    — check for and show update instructions');
      console.log('  sync                 — copy monorepo dist builds into ~/.krythor (dev workflow)');
      console.log('  doctor [--fix]       — full diagnostics report; --fix auto-repairs safe issues');
      console.log('  policy show          — print current guard policy rules');
      console.log('  policy check <op>    — evaluate a guard check and show verdict');
      console.log('  audit tail [--n=20]  — show last N audit log entries');
      console.log('  approvals pending    — list pending approval requests');
      process.exit(cmd ? 1 : 0);
  }
})().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
