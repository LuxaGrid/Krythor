#!/usr/bin/env node
/**
 * Krythor TUI — live terminal dashboard
 * Displays gateway health, agent list, and recent sessions.
 * Uses ANSI escape codes only — no external TUI framework needed.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── ANSI helpers ───────────────────────────────────────────────────────────────
const ESC = '\x1b[';
const RESET   = '\x1b[0m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const RED     = '\x1b[31m';
const CYAN    = '\x1b[36m';
const WHITE   = '\x1b[37m';

function clear(): void    { process.stdout.write('\x1b[2J\x1b[H'); }
function moveTo(r: number, c: number): void { process.stdout.write(`${ESC}${r};${c}H`); }
function hideCursor(): void { process.stdout.write('\x1b[?25l'); }
function showCursor(): void { process.stdout.write('\x1b[?25h'); }

// ── Config ─────────────────────────────────────────────────────────────────────
function resolveGateway(): { url: string; token: string | null } {
  const url = process.env['KRYTHOR_URL'] ?? 'http://localhost:3001';
  const envToken = process.env['KRYTHOR_GATEWAY_TOKEN'] ?? null;
  if (envToken) return { url, token: envToken };
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

async function apiFetch<T>(path: string): Promise<T> {
  const { url, token } = resolveGateway();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${url}${path}`, { headers, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Data types ─────────────────────────────────────────────────────────────────
interface HealthData  { status?: string; uptime?: number; totalTokens?: number }
interface Agent       { id: string; name: string; modelId?: string }
interface AgentsData  { agents?: Agent[] }
interface Session     { id: string; title?: string; agentId?: string; updatedAt?: number }
interface SessionsData { conversations?: Session[] }

interface DashState {
  health:   HealthData | null;
  agents:   Agent[];
  sessions: Session[];
  error:    string | null;
  lastRefresh: number;
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderDash(state: DashState): void {
  const cols = process.stdout.columns || 80;
  const { url } = resolveGateway();

  clear();
  moveTo(1, 1);

  // Header
  const title = ' Krythor TUI ';
  const pad = Math.max(0, Math.floor((cols - title.length) / 2));
  process.stdout.write(BOLD + CYAN + ' '.repeat(pad) + title + RESET + '\n');
  process.stdout.write(DIM + '─'.repeat(cols) + RESET + '\n');

  // Gateway status
  process.stdout.write('\n');
  const statusColor = state.health?.status === 'ok' ? GREEN : (state.error ? RED : YELLOW);
  const statusText  = state.health?.status ?? (state.error ? 'OFFLINE' : 'checking...');
  process.stdout.write(`${BOLD}  Gateway:${RESET}  ${url}\n`);
  process.stdout.write(`${BOLD}  Status:${RESET}   ${statusColor}${statusText}${RESET}\n`);
  if (state.health?.uptime !== undefined) {
    process.stdout.write(`${BOLD}  Uptime:${RESET}   ${Math.round(state.health.uptime / 60)}m\n`);
  }
  if (state.health?.totalTokens !== undefined) {
    process.stdout.write(`${BOLD}  Tokens:${RESET}   ${state.health.totalTokens.toLocaleString()}\n`);
  }
  if (state.error) {
    process.stdout.write(`${DIM}  Error:  ${state.error}${RESET}\n`);
  }

  // Agents
  process.stdout.write('\n' + DIM + '─'.repeat(cols) + RESET + '\n');
  process.stdout.write(`${BOLD}  Agents (${state.agents.length})${RESET}\n`);
  for (const a of state.agents.slice(0, 8)) {
    process.stdout.write(`  ${GREEN}•${RESET} ${a.name.padEnd(28)} ${DIM}${a.id.slice(0, 12)}${RESET}  ${a.modelId ?? ''}\n`);
  }
  if (state.agents.length > 8) {
    process.stdout.write(`  ${DIM}... and ${state.agents.length - 8} more${RESET}\n`);
  }

  // Recent sessions
  process.stdout.write('\n' + DIM + '─'.repeat(cols) + RESET + '\n');
  process.stdout.write(`${BOLD}  Recent Sessions (${state.sessions.length})${RESET}\n`);
  for (const s of state.sessions.slice(0, 6)) {
    const ago = s.updatedAt ? `${Math.round((Date.now() - s.updatedAt) / 60000)}m ago` : '';
    const sessionTitle = (s.title ?? 'Untitled').slice(0, 38).padEnd(38);
    process.stdout.write(`  ${CYAN}${s.id.slice(0, 8)}${RESET}  ${sessionTitle}  ${DIM}${ago}${RESET}\n`);
  }

  // Footer
  process.stdout.write('\n' + DIM + '─'.repeat(cols) + RESET + '\n');
  const refreshed = new Date(state.lastRefresh).toLocaleTimeString();
  process.stdout.write(`${DIM}  Last refresh: ${refreshed}   Press q to quit, r to refresh${RESET}\n`);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function fetchState(): Promise<DashState> {
  const state: DashState = { health: null, agents: [], sessions: [], error: null, lastRefresh: Date.now() };
  try {
    state.health = await apiFetch<HealthData>('/health');
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  try {
    const agentsData = await apiFetch<AgentsData>('/api/agents');
    state.agents = agentsData.agents ?? [];
  } catch { /* non-fatal */ }
  try {
    const sessData = await apiFetch<SessionsData>('/api/conversations?limit=10');
    state.sessions = sessData.conversations ?? [];
  } catch { /* non-fatal */ }
  return state;
}

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    console.error('TUI requires a TTY terminal.');
    process.exit(1);
  }

  hideCursor();
  let running = true;

  // Raw mode for keypress
  const stdin = process.stdin;
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf-8');

  const onKey = (chunk: Buffer | string): void => {
    const key = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    if (key === 'q' || key === 'Q' || key === '\u0003') {
      running = false;
    }
  };

  const onRefresh = async (chunk: Buffer | string): Promise<void> => {
    const key = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    if ((key === 'r' || key === 'R') && running) {
      state = await fetchState();
      renderDash(state);
    }
  };

  stdin.on('data', onKey);
  stdin.on('data', onRefresh);

  const cleanup = (): void => {
    showCursor();
    if (stdin.setRawMode) stdin.setRawMode(false);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { running = false; process.exit(0); });

  let state = await fetchState();
  renderDash(state);

  const interval = setInterval(async () => {
    if (!running) {
      clearInterval(interval);
      cleanup();
      clear();
      process.exit(0);
    }
    state = await fetchState();
    renderDash(state);
  }, 5000);

}

main().catch(err => {
  showCursor();
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
