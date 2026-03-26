/**
 * Shell tool route tests — /api/tools/shell/*
 *
 * Access-profile enforcement and input validation are the primary concerns.
 * child_process.spawn / exec are mocked — no real shell commands are run.
 *
 * Pattern matches existing route test files: buildServer() + inject() + authToken.
 */

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'

// ─── Mock child_process ───────────────────────────────────────────────────────
//
// We mock 'node:child_process' so no real processes are spawned.
// spawn() returns an EventEmitter-like object that immediately emits 'close'.
// exec() returns a callback that immediately resolves with empty output.
//

import { EventEmitter } from 'node:events'

vi.mock('node:child_process', () => {
  function makeFakeChild() {
    const ee = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => void;
    }
    ee.stdout = new EventEmitter()
    ee.stderr = new EventEmitter()
    ee.kill = () => {}
    // Emit close on next tick so handlers are attached first
    setImmediate(() => ee.emit('close', 0))
    return ee
  }

  return {
    spawn: vi.fn(() => makeFakeChild()),
    exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      setImmediate(() => cb(null, '', ''))
      return new EventEmitter()
    }),
  }
})

// ─── Test setup ───────────────────────────────────────────────────────────────

let app: Awaited<ReturnType<typeof buildServer>>
let authToken: string
const HOST = `127.0.0.1:${GATEWAY_PORT}`

function getDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor')
  }
  return join(homedir(), '.local', 'share', 'krythor')
}

beforeAll(async () => {
  app = await buildServer()
  await app.ready()
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'))
  authToken = cfg.token ?? ''
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    authorization: `Bearer ${authToken}`,
    host: HOST,
    'content-type': 'application/json',
  }
}

function getHeaders() {
  return {
    authorization: `Bearer ${authToken}`,
    host: HOST,
  }
}

/**
 * Create an agent and set its access profile, returning the created agent id.
 */
async function createAgentWithProfile(name: string, profile: 'safe' | 'standard' | 'full_access'): Promise<string> {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: authHeaders(),
    payload: JSON.stringify({ name, systemPrompt: `Test agent for shell tests (${profile})` }),
  })
  const agent = JSON.parse(createRes.body) as { id: string }
  const agentId = agent.id

  if (profile !== 'safe') {
    await app.inject({
      method: 'PUT',
      url: `/api/agents/${agentId}/access-profile`,
      headers: authHeaders(),
      payload: { profile },
    })
  }

  return agentId
}

// ─── POST /api/tools/shell/exec ───────────────────────────────────────────────

describe('POST /api/tools/shell/exec — safe profile', () => {
  it('returns 403 SHELL_DENIED for unregistered agent (defaults to safe)', async () => {
    // A completely unknown agentId is not in the orchestrator — but AccessProfileStore.getProfile()
    // defaults to 'safe' for any unknown id. The guard check uses guard.check() which defaults to
    // allow for unknown agents, so it reaches the profile check and gets SHELL_DENIED.
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/exec',
      headers: authHeaders(),
      payload: { command: 'echo', args: ['hello'], agentId: 'agent-safe-shell-unk' },
    })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body) as { code: string; error: string }
    expect(body.code).toBe('SHELL_DENIED')
  })
})

describe('POST /api/tools/shell/exec — input validation', () => {
  it('returns 400 when command is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/exec',
      headers: authHeaders(),
      payload: { agentId: 'agent-safe-shell-unk' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when command is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/exec',
      headers: authHeaders(),
      payload: { command: '', agentId: 'agent-safe-shell-unk' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when timeoutMs exceeds maximum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/exec',
      headers: authHeaders(),
      payload: { command: 'echo', timeoutMs: 999_999_999, agentId: 'agent-safe-shell-unk' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/tools/shell/exec — standard profile', () => {
  it('is allowed and returns stdout/stderr/exitCode (mocked spawn)', async () => {
    const agentId = await createAgentWithProfile('Shell Exec Standard Agent', 'standard')

    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/exec',
      headers: authHeaders(),
      payload: { command: 'echo', args: ['hello'], agentId },
    })

    // Should be 200 (gate opens) — mock spawn exits with code 0
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as {
      stdout: string; stderr: string; exitCode: number | null;
      durationMs: number; command: string; profile: string;
      confirmationRequired: boolean;
    }
    expect(body.command).toBe('echo')
    expect(body.profile).toBe('standard')
    expect(typeof body.durationMs).toBe('number')
    expect(body.exitCode).toBe(0)
    // standard profile must include confirmationRequired field
    expect(body.confirmationRequired).toBe(false)
  })
})

// ─── GET /api/tools/shell/processes ──────────────────────────────────────────

describe('GET /api/tools/shell/processes — safe profile', () => {
  it('returns 403 SHELL_DENIED for unregistered agent (defaults to safe)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tools/shell/processes?agentId=proc-safe-agent-unk',
      headers: getHeaders(),
    })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body) as { code: string }
    expect(body.code).toBe('SHELL_DENIED')
  })
})

describe('GET /api/tools/shell/processes — standard profile', () => {
  it('is allowed and returns processes array', async () => {
    const agentId = await createAgentWithProfile('Shell Processes Standard Agent', 'standard')

    const res = await app.inject({
      method: 'GET',
      url: `/api/tools/shell/processes?agentId=${encodeURIComponent(agentId)}`,
      headers: getHeaders(),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { processes: unknown[] }
    expect(Array.isArray(body.processes)).toBe(true)
  })
})

// ─── POST /api/tools/shell/kill ───────────────────────────────────────────────

describe('POST /api/tools/shell/kill — safe profile', () => {
  it('returns 403 SHELL_DENIED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/kill',
      headers: authHeaders(),
      payload: { pid: 9999, agentId: 'kill-safe-agent-unk' },
    })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body) as { code: string }
    expect(body.code).toBe('SHELL_DENIED')
  })
})

describe('POST /api/tools/shell/kill — standard profile', () => {
  it('returns 403 SHELL_DENIED (kill requires full_access)', async () => {
    const agentId = await createAgentWithProfile('Shell Kill Standard Agent', 'standard')

    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/kill',
      headers: authHeaders(),
      payload: { pid: 9999, agentId },
    })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body) as { code: string }
    expect(body.code).toBe('SHELL_DENIED')
  })
})

describe('POST /api/tools/shell/kill — full_access profile', () => {
  it('allows kill for a valid PID (mocked process.kill)', async () => {
    const agentId = await createAgentWithProfile('Shell Kill Full Agent', 'full_access')

    // Mock process.kill to avoid actually signalling a process
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/kill',
      headers: authHeaders(),
      payload: { pid: 12345, signal: 'SIGTERM', agentId },
    })

    killSpy.mockRestore()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; pid: number; signal: string }
    expect(body.ok).toBe(true)
    expect(body.pid).toBe(12345)
    expect(body.signal).toBe('SIGTERM')
  })

  it('returns 404 NO_SUCH_PROCESS when PID does not exist', async () => {
    const agentId = await createAgentWithProfile('Shell Kill Full Agent 2', 'full_access')

    // Mock process.kill to throw ESRCH (no such process)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = Object.assign(new Error('No such process'), { code: 'ESRCH' })
      throw err
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/kill',
      headers: authHeaders(),
      payload: { pid: 99999999, agentId },
    })

    killSpy.mockRestore()

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as { code: string }
    expect(body.code).toBe('NO_SUCH_PROCESS')
  })
})

describe('POST /api/tools/shell/kill — input validation', () => {
  it('returns 400 when pid is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/shell/kill',
      headers: authHeaders(),
      payload: { agentId: 'kill-safe-agent-unk' },
    })
    expect(res.statusCode).toBe(400)
  })
})
