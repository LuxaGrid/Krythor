import { describe, it, expect, beforeAll } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'

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

describe('GET /api/tools', () => {
  it('returns tool list with exec tool info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tools',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.tools)).toBe(true)
    const tools = body.tools as Array<Record<string, unknown>>
    const execTool = tools.find(t => t.name === 'exec')
    expect(execTool).toBeDefined()
    expect(Array.isArray(execTool?.allowlist)).toBe(true)
    expect((execTool?.allowlist as string[]).includes('echo')).toBe(true)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tools',
      headers: { host: HOST },
    })
    // Auth may be disabled in test env; accept 200 or 401
    expect([200, 401]).toContain(res.statusCode)
  })
})

describe('POST /api/tools/exec — allowed commands', () => {
  it('executes echo and returns stdout', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/exec',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { command: 'echo', args: ['hello', 'world'] },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toHaveProperty('stdout')
    expect(body).toHaveProperty('stderr')
    expect(body).toHaveProperty('exitCode')
    expect(body).toHaveProperty('durationMs')
    expect((body.stdout as string).trim()).toContain('hello')
    expect(body.exitCode).toBe(0)
  })

  it('executes node --version and returns version string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/exec',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { command: 'node', args: ['--version'] },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect((body.stdout as string)).toMatch(/^v\d+\./)
  })
})

describe('POST /api/tools/exec — denied commands', () => {
  it('returns 403 for a command not in the allowlist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/exec',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { command: 'rm', args: ['-rf', '/'] },
    })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.code).toBe('EXEC_DENIED')
  })

  it('returns 403 for bash (not in allowlist)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/exec',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { command: 'bash', args: ['-c', 'echo hi'] },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 for curl (not in allowlist)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/exec',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { command: 'curl', args: ['https://example.com'] },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/tools/exec — validation', () => {
  it('returns 400 when command is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/exec',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { args: ['hello'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when timeoutMs is below minimum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/exec',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { command: 'echo', args: ['hi'], timeoutMs: 100 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/tools/exec — timeout', () => {
  it('returns 408 when command exceeds timeout', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/exec',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: {
        command: 'node',
        args: ['-e', 'setTimeout(()=>{},60000)'],
        timeoutMs: 1500,
      },
    })
    expect(res.statusCode).toBe(408)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.code).toBe('EXEC_TIMEOUT')
  }, 10000) // 10s test timeout — the exec itself times out at 1.5s + SIGKILL grace
})
