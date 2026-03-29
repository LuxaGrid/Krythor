import { describe, it, expect, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { TokenBudgetStore } from './TokenBudgetStore.js'

function makeTmpDir(): string {
  const dir = join(tmpdir(), `krythor-budget-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

let tmpDir: string
let store: TokenBudgetStore

beforeEach(() => {
  tmpDir = makeTmpDir()
  store = new TokenBudgetStore(tmpDir)
})

describe('TokenBudgetStore CRUD', () => {
  it('returns null for unknown agent', () => {
    expect(store.get('unknown')).toBeNull()
  })

  it('upsert creates a budget', () => {
    const b = store.upsert('agent-1', { dailyLimit: 10000, sessionLimit: 5000 })
    expect(b.agentId).toBe('agent-1')
    expect(b.dailyLimit).toBe(10000)
    expect(b.sessionLimit).toBe(5000)
  })

  it('upsert updates existing budget', () => {
    store.upsert('agent-1', { dailyLimit: 10000 })
    const updated = store.upsert('agent-1', { dailyLimit: 20000 })
    expect(updated.dailyLimit).toBe(20000)
  })

  it('upsert clears limit when null passed', () => {
    store.upsert('agent-1', { dailyLimit: 10000 })
    const updated = store.upsert('agent-1', { dailyLimit: null })
    expect(updated.dailyLimit).toBeUndefined()
  })

  it('list returns all budgets', () => {
    store.upsert('agent-1', { dailyLimit: 1000 })
    store.upsert('agent-2', { sessionLimit: 500 })
    expect(store.list().length).toBe(2)
  })

  it('remove deletes budget', () => {
    store.upsert('agent-1', { dailyLimit: 1000 })
    store.remove('agent-1')
    expect(store.get('agent-1')).toBeNull()
  })

  it('persists to disk and reloads', () => {
    store.upsert('agent-1', { dailyLimit: 9999 })
    const store2 = new TokenBudgetStore(tmpDir)
    expect(store2.get('agent-1')?.dailyLimit).toBe(9999)
  })
})

describe('TokenBudgetStore.check()', () => {
  it('allows when no budget configured', () => {
    expect(store.check('no-budget').allowed).toBe(true)
  })

  it('allows when under limits', () => {
    store.upsert('agent-1', { dailyLimit: 10000, sessionLimit: 5000 })
    store.record('agent-1', 100)
    const result = store.check('agent-1')
    expect(result.allowed).toBe(true)
    expect(result.sessionUsed).toBe(100)
    expect(result.dailyUsed).toBe(100)
    expect(result.sessionRemaining).toBe(4900)
    expect(result.dailyRemaining).toBe(9900)
  })

  it('blocks when session limit exceeded', () => {
    store.upsert('agent-1', { sessionLimit: 100 })
    store.record('agent-1', 100)
    const result = store.check('agent-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/session/i)
    expect(result.sessionRemaining).toBe(0)
  })

  it('blocks when daily limit exceeded', () => {
    store.upsert('agent-1', { dailyLimit: 100 })
    store.record('agent-1', 100)
    const result = store.check('agent-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/daily/i)
    expect(result.dailyRemaining).toBe(0)
  })

  it('session limit checked before daily limit', () => {
    store.upsert('agent-1', { dailyLimit: 500, sessionLimit: 50 })
    store.record('agent-1', 100)
    const result = store.check('agent-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/session/i)
  })
})

describe('TokenBudgetStore.usage()', () => {
  it('returns zero usage for new agent', () => {
    store.upsert('agent-1', { dailyLimit: 1000 })
    const u = store.usage('agent-1')
    expect(u.sessionUsed).toBe(0)
    expect(u.dailyUsed).toBe(0)
    expect(u.budget?.agentId).toBe('agent-1')
  })

  it('records usage correctly', () => {
    store.upsert('agent-1', { dailyLimit: 1000 })
    store.record('agent-1', 300)
    store.record('agent-1', 200)
    const u = store.usage('agent-1')
    expect(u.sessionUsed).toBe(500)
    expect(u.dailyUsed).toBe(500)
  })

  it('ignores zero or negative tokens', () => {
    store.upsert('agent-1', { dailyLimit: 1000 })
    store.record('agent-1', 0)
    store.record('agent-1', -5)
    expect(store.usage('agent-1').sessionUsed).toBe(0)
  })

  it('remove clears usage counters', () => {
    store.upsert('agent-1', { dailyLimit: 1000 })
    store.record('agent-1', 500)
    store.remove('agent-1')
    // Re-add and check counters are cleared
    store.upsert('agent-1', { dailyLimit: 1000 })
    expect(store.usage('agent-1').sessionUsed).toBe(0)
  })
})
