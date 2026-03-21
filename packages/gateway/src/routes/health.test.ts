import { describe, it, expect, beforeAll } from 'vitest'
import { buildServer } from '../server.js'

// Build once — do not close; vitest tears down the process cleanly.
// Calling app.close() triggers better-sqlite3 to emit a sync error on
// process exit (DB already closed), which vitest reports as an unhandled
// error even though all tests pass. Letting the process exit naturally
// avoids this and is the recommended Fastify + vitest pattern.
let app: Awaited<ReturnType<typeof buildServer>>

beforeAll(async () => {
  app = await buildServer()
  await app.ready()
})

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.version).toBeDefined()
    expect(body.nodeVersion).toBeDefined()
  })

  it('includes all subsystem stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.memory).toBeDefined()
    expect(body.models).toBeDefined()
    expect(body.guard).toBeDefined()
    expect(body.agents).toBeDefined()
  })

  it('includes dataDir and configDir in response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.dataDir).toBe('string')
    expect(typeof body.configDir).toBe('string')
    // configDir should be a subdirectory of dataDir
    expect((body.configDir as string).startsWith(body.dataDir as string)).toBe(true)
  })

  it('includes firstRun flag indicating whether providers are configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.firstRun).toBe('boolean')
  })
})
