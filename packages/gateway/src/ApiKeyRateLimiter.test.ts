import { describe, it, expect, beforeEach } from 'vitest'
import { ApiKeyRateLimiter } from './ApiKeyRateLimiter.js'

const KEY_BASE = { id: 'test-key-id' }

describe('ApiKeyRateLimiter', () => {
  let limiter: ApiKeyRateLimiter

  beforeEach(() => {
    limiter = new ApiKeyRateLimiter()
  })

  it('allows all requests when no limits configured', () => {
    for (let i = 0; i < 100; i++) {
      expect(limiter.check(KEY_BASE).allowed).toBe(true)
    }
  })

  it('enforces per-minute rate limit', () => {
    const key = { ...KEY_BASE, rateLimit: 3 }
    expect(limiter.check(key).allowed).toBe(true)
    expect(limiter.check(key).allowed).toBe(true)
    expect(limiter.check(key).allowed).toBe(true)
    const result = limiter.check(key)
    expect(result.allowed).toBe(false)
    expect(result.remainingMinute).toBe(0)
    expect(typeof result.retryAfterSeconds).toBe('number')
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('returns remaining count after each allowed request', () => {
    const key = { ...KEY_BASE, id: 'key-remaining', rateLimit: 5 }
    const r1 = limiter.check(key)
    expect(r1.allowed).toBe(true)
    expect(r1.remainingMinute).toBe(4)
    const r2 = limiter.check(key)
    expect(r2.remainingMinute).toBe(3)
  })

  it('enforces daily limit', () => {
    const key = { ...KEY_BASE, id: 'key-daily', dailyLimit: 2 }
    expect(limiter.check(key).allowed).toBe(true)
    expect(limiter.check(key).allowed).toBe(true)
    const result = limiter.check(key)
    expect(result.allowed).toBe(false)
    expect(result.remainingDay).toBe(0)
    expect(result.reason).toMatch(/daily quota/i)
  })

  it('respects both rate limit and daily limit independently', () => {
    const key = { ...KEY_BASE, id: 'key-both', rateLimit: 10, dailyLimit: 2 }
    expect(limiter.check(key).allowed).toBe(true)
    expect(limiter.check(key).allowed).toBe(true)
    // daily limit hit
    const result = limiter.check(key)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/daily quota/i)
  })

  it('reset clears counters for a key', () => {
    const key = { ...KEY_BASE, id: 'key-reset', rateLimit: 1 }
    limiter.check(key) // exhaust
    expect(limiter.check(key).allowed).toBe(false)
    limiter.reset(key.id)
    expect(limiter.check(key).allowed).toBe(true)
  })

  it('tracks separate counters per key id', () => {
    const key1 = { id: 'sep-key-1', rateLimit: 1 }
    const key2 = { id: 'sep-key-2', rateLimit: 1 }
    limiter.check(key1) // exhaust key1
    expect(limiter.check(key1).allowed).toBe(false)
    expect(limiter.check(key2).allowed).toBe(true)
  })
})
