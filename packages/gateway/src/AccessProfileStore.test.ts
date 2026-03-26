/**
 * AccessProfileStore tests
 *
 * Uses a real temp directory per test run — same pattern as ConfigValidator.test.ts.
 * No mocked FS: the store uses sync fs functions that work fine against a tmpdir.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { AccessProfileStore, makeAuditEntry } from './AccessProfileStore.js'
import type { AccessProfile } from './AccessProfileStore.js'

const TEST_DIR = join(tmpdir(), `krythor-aps-test-${randomUUID()}`)

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterAll(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
})

// ── Helper: create a fresh store in a unique sub-directory ────────────────────
function freshStore(): AccessProfileStore {
  const dir = join(TEST_DIR, randomUUID())
  mkdirSync(dir, { recursive: true })
  return new AccessProfileStore(dir)
}

// ── getProfile defaults ───────────────────────────────────────────────────────

describe('getProfile — default behaviour', () => {
  it('returns safe for an unknown agent', () => {
    const store = freshStore()
    expect(store.getProfile('unknown-agent-xyz')).toBe('safe')
  })

  it('returns safe for empty string agent id', () => {
    const store = freshStore()
    expect(store.getProfile('')).toBe('safe')
  })
})

// ── setProfile / getProfile round-trips ──────────────────────────────────────

describe('setProfile + getProfile round-trips', () => {
  const profiles: AccessProfile[] = ['safe', 'standard', 'full_access']

  for (const profile of profiles) {
    it(`round-trips profile '${profile}'`, () => {
      const store = freshStore()
      store.setProfile('agent-1', profile)
      expect(store.getProfile('agent-1')).toBe(profile)
    })
  }

  it('overwrites a previous profile value', () => {
    const store = freshStore()
    store.setProfile('agent-2', 'standard')
    expect(store.getProfile('agent-2')).toBe('standard')
    store.setProfile('agent-2', 'full_access')
    expect(store.getProfile('agent-2')).toBe('full_access')
  })
})

// ── listProfiles ──────────────────────────────────────────────────────────────

describe('listProfiles', () => {
  it('returns empty object when no profiles set', () => {
    const store = freshStore()
    expect(store.listProfiles()).toEqual({})
  })

  it('returns all stored profiles', () => {
    const store = freshStore()
    store.setProfile('agent-a', 'safe')
    store.setProfile('agent-b', 'standard')
    store.setProfile('agent-c', 'full_access')
    const profiles = store.listProfiles()
    expect(profiles['agent-a']).toBe('safe')
    expect(profiles['agent-b']).toBe('standard')
    expect(profiles['agent-c']).toBe('full_access')
    expect(Object.keys(profiles)).toHaveLength(3)
  })

  it('returns a snapshot — mutations do not affect the store', () => {
    const store = freshStore()
    store.setProfile('agent-snap', 'standard')
    const snapshot = store.listProfiles()
    // Mutating the returned object must not change the store
    snapshot['agent-snap'] = 'full_access' as AccessProfile
    expect(store.getProfile('agent-snap')).toBe('standard')
  })
})

// ── logAudit + getAuditLog ────────────────────────────────────────────────────

describe('logAudit + getAuditLog', () => {
  it('stores a single audit entry', () => {
    const store = freshStore()
    const entry = makeAuditEntry('agent-1', 'file:read', '/some/path', 'safe', true)
    store.logAudit(entry)
    const log = store.getAuditLog()
    expect(log).toHaveLength(1)
    expect(log[0]?.agentId).toBe('agent-1')
    expect(log[0]?.operation).toBe('file:read')
    expect(log[0]?.allowed).toBe(true)
  })

  it('stores multiple entries in insertion order', () => {
    const store = freshStore()
    store.logAudit(makeAuditEntry('a', 'file:read', '/p1', 'safe', true))
    store.logAudit(makeAuditEntry('b', 'file:write', '/p2', 'standard', false, 'denied'))
    store.logAudit(makeAuditEntry('c', 'file:delete', '/p3', 'full_access', true))
    const log = store.getAuditLog()
    expect(log).toHaveLength(3)
    expect(log[0]?.agentId).toBe('a')
    expect(log[1]?.agentId).toBe('b')
    expect(log[2]?.agentId).toBe('c')
  })

  it('respects limit parameter', () => {
    const store = freshStore()
    for (let i = 0; i < 10; i++) {
      store.logAudit(makeAuditEntry(`agent-${i}`, 'file:read', '/p', 'safe', true))
    }
    const log = store.getAuditLog(3)
    expect(log).toHaveLength(3)
    // Should return the most recent 3
    expect(log[2]?.agentId).toBe('agent-9')
  })

  it('preserves the reason field when present', () => {
    const store = freshStore()
    const entry = makeAuditEntry('a', 'file:read', '/p', 'safe', false, 'outside workspace')
    store.logAudit(entry)
    const log = store.getAuditLog()
    expect(log[0]?.reason).toBe('outside workspace')
  })

  it('omits reason field when not provided', () => {
    const store = freshStore()
    const entry = makeAuditEntry('a', 'file:read', '/p', 'safe', true)
    store.logAudit(entry)
    const log = store.getAuditLog()
    expect(log[0]?.reason).toBeUndefined()
  })
})

// ── Ring buffer eviction at 500 entries ───────────────────────────────────────

describe('audit ring buffer', () => {
  it('evicts oldest entries when 501 are added', () => {
    const store = freshStore()
    for (let i = 0; i < 501; i++) {
      store.logAudit(makeAuditEntry(`agent-${i}`, 'file:read', '/p', 'safe', true))
    }
    const log = store.getAuditLog(500)
    // Ring limit is 500 — the 501st push evicts the first entry
    expect(log).toHaveLength(500)
    // First entry in the ring should be agent-1, not agent-0
    expect(log[0]?.agentId).toBe('agent-1')
    // Last entry should be agent-500
    expect(log[499]?.agentId).toBe('agent-500')
  })

  it('never returns more than 500 entries regardless of limit', () => {
    const store = freshStore()
    for (let i = 0; i < 600; i++) {
      store.logAudit(makeAuditEntry('a', 'file:read', '/p', 'safe', true))
    }
    const log = store.getAuditLog(500)
    expect(log.length).toBeLessThanOrEqual(500)
  })
})

// ── File persistence: load from existing JSON ─────────────────────────────────

describe('file persistence', () => {
  it('loads profiles written to disk before construction', () => {
    const dir = join(TEST_DIR, `persist-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'access-profiles.json'),
      JSON.stringify({ 'agent-loaded': 'full_access', 'agent-std': 'standard' }),
      'utf-8',
    )
    const store = new AccessProfileStore(dir)
    expect(store.getProfile('agent-loaded')).toBe('full_access')
    expect(store.getProfile('agent-std')).toBe('standard')
  })

  it('ignores invalid profile values in the persisted file', () => {
    const dir = join(TEST_DIR, `persist-invalid-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'access-profiles.json'),
      JSON.stringify({ 'agent-ok': 'standard', 'agent-bad': 'superuser' }),
      'utf-8',
    )
    const store = new AccessProfileStore(dir)
    expect(store.getProfile('agent-ok')).toBe('standard')
    // 'superuser' is not a valid profile — should default to 'safe'
    expect(store.getProfile('agent-bad')).toBe('safe')
  })

  it('starts with empty profiles when the JSON file is malformed', () => {
    const dir = join(TEST_DIR, `persist-malformed-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'access-profiles.json'), '{ not valid json !!!', 'utf-8')
    const store = new AccessProfileStore(dir)
    expect(store.getProfile('any-agent')).toBe('safe')
    expect(store.listProfiles()).toEqual({})
  })

  it('persists profiles to disk so a second store instance reads them', () => {
    const dir = join(TEST_DIR, `persist-roundtrip-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    const store1 = new AccessProfileStore(dir)
    store1.setProfile('agent-persist', 'full_access')

    // A second store instance reads from the same directory
    const store2 = new AccessProfileStore(dir)
    expect(store2.getProfile('agent-persist')).toBe('full_access')
  })
})

// ── makeAuditEntry factory ────────────────────────────────────────────────────

describe('makeAuditEntry', () => {
  it('returns an entry with all required fields', () => {
    const entry = makeAuditEntry('agent-1', 'file:read', '/home/user/file.txt', 'standard', true)
    expect(typeof entry.id).toBe('string')
    expect(entry.id).toHaveLength(36) // UUID format
    expect(typeof entry.ts).toBe('number')
    expect(entry.agentId).toBe('agent-1')
    expect(entry.operation).toBe('file:read')
    expect(entry.path).toBe('/home/user/file.txt')
    expect(entry.profile).toBe('standard')
    expect(entry.allowed).toBe(true)
  })

  it('includes reason when provided', () => {
    const entry = makeAuditEntry('a', 'file:write', '/p', 'safe', false, 'path outside workspace')
    expect(entry.reason).toBe('path outside workspace')
  })

  it('does not include reason key when not provided', () => {
    const entry = makeAuditEntry('a', 'file:read', '/p', 'safe', true)
    expect('reason' in entry).toBe(false)
  })

  it('generates unique IDs for each entry', () => {
    const e1 = makeAuditEntry('a', 'file:read', '/p', 'safe', true)
    const e2 = makeAuditEntry('a', 'file:read', '/p', 'safe', true)
    expect(e1.id).not.toBe(e2.id)
  })
})
