#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

// ── Entry point ─────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;

(async () => {
  switch (cmd) {
    case 'status':   await cmdStatus(); break;
    case 'sessions': await cmdSessions(); break;
    case 'models':   await cmdModels(); break;
    case 'call':     await cmdCall(rest.join(' ')); break;
    default:
      console.log('Usage: krythor <command>');
      console.log('  status    — check gateway health and agent/model counts');
      console.log('  sessions  — list recent sessions');
      console.log('  models    — list configured providers and models');
      console.log('  call <text> — send a one-shot message to the default agent');
      process.exit(cmd ? 1 : 0);
  }
})().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
