/**
 * ChatChannelRegistry tests
 *
 * Uses a real temp directory per test run — same pattern as ConfigValidator.test.ts.
 * testConnection() network calls are not exercised; only the logic paths that
 * do not require network I/O are tested here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { ChatChannelRegistry } from './ChatChannelRegistry.js'
import type { ChatChannelConfig } from './ChatChannelRegistry.js'

const TEST_DIR = join(tmpdir(), `krythor-ccr-test-${randomUUID()}`)

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterAll(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
})

function freshRegistry(): ChatChannelRegistry {
  const dir = join(TEST_DIR, randomUUID())
  mkdirSync(dir, { recursive: true })
  return new ChatChannelRegistry(dir)
}

// ── Provider metadata ─────────────────────────────────────────────────────────

describe('listProviders', () => {
  it('returns all providers (telegram, discord, whatsapp, webchat)', () => {
    const reg = freshRegistry()
    const providers = reg.listProviders()
    const ids = providers.map(p => p.id)
    expect(ids).toContain('telegram')
    expect(ids).toContain('discord')
    expect(ids).toContain('whatsapp')
    expect(ids).toContain('webchat')
    expect(providers.length).toBeGreaterThanOrEqual(4)
  })

  it('each provider has required meta fields', () => {
    const reg = freshRegistry()
    for (const p of reg.listProviders()) {
      expect(typeof p.id).toBe('string')
      expect(typeof p.displayName).toBe('string')
      expect(typeof p.description).toBe('string')
      expect(Array.isArray(p.credentialFields)).toBe(true)
      expect(typeof p.requiresPairing).toBe('boolean')
      // docsUrl is optional — only check when present
      if (p.docsUrl !== undefined) {
        expect(typeof p.docsUrl).toBe('string')
      }
    }
  })
})

describe('getProvider', () => {
  it('returns the telegram provider meta', () => {
    const reg = freshRegistry()
    const p = reg.getProvider('telegram')
    expect(p).toBeDefined()
    expect(p?.id).toBe('telegram')
    expect(p?.type).toBe('telegram')
    expect(p?.requiresPairing).toBe(false)
  })

  it('returns the discord provider meta', () => {
    const reg = freshRegistry()
    const p = reg.getProvider('discord')
    expect(p).toBeDefined()
    expect(p?.id).toBe('discord')
    expect(p?.type).toBe('discord')
    expect(p?.requiresPairing).toBe(false)
  })

  it('returns the whatsapp provider meta', () => {
    const reg = freshRegistry()
    const p = reg.getProvider('whatsapp')
    expect(p).toBeDefined()
    expect(p?.id).toBe('whatsapp')
    expect(p?.type).toBe('whatsapp')
    expect(p?.requiresPairing).toBe(true)
  })

  it("returns undefined for unknown provider id", () => {
    const reg = freshRegistry()
    expect(reg.getProvider('unknown')).toBeUndefined()
    expect(reg.getProvider('')).toBeUndefined()
    expect(reg.getProvider('nonexistent-channel')).toBeUndefined()
  })
})

// ── Config CRUD lifecycle ─────────────────────────────────────────────────────

describe('saveConfig + getConfig + deleteConfig lifecycle', () => {
  it('saveConfig makes the config retrievable via getConfig', () => {
    const reg = freshRegistry()
    const config: ChatChannelConfig = {
      id: 'telegram',
      type: 'telegram',
      displayName: 'My Telegram Bot',
      enabled: true,
      credentials: { botToken: 'abc123' },
    }
    reg.saveConfig(config)
    const retrieved = reg.getConfig('telegram')
    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe('telegram')
    expect(retrieved?.displayName).toBe('My Telegram Bot')
    expect(retrieved?.credentials['botToken']).toBe('abc123')
  })

  it('getConfig returns undefined for unconfigured channel', () => {
    const reg = freshRegistry()
    expect(reg.getConfig('telegram')).toBeUndefined()
  })

  it('listConfigs returns all saved configs', () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'telegram', type: 'telegram', displayName: 'TG', enabled: true, credentials: {} })
    reg.saveConfig({ id: 'discord', type: 'discord', displayName: 'DC', enabled: false, credentials: {} })
    const configs = reg.listConfigs()
    expect(configs).toHaveLength(2)
    const ids = configs.map(c => c.id)
    expect(ids).toContain('telegram')
    expect(ids).toContain('discord')
  })

  it('deleteConfig removes the config', () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'telegram', type: 'telegram', displayName: 'TG', enabled: true, credentials: {} })
    expect(reg.getConfig('telegram')).toBeDefined()
    reg.deleteConfig('telegram')
    expect(reg.getConfig('telegram')).toBeUndefined()
  })

  it('deleteConfig is a no-op for non-existent id', () => {
    const reg = freshRegistry()
    expect(() => reg.deleteConfig('never-existed')).not.toThrow()
  })

  it('saveConfig updates an existing entry in-place', () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'discord', type: 'discord', displayName: 'Old', enabled: true, credentials: { token: 't.o.k', channelId: '123' } })
    reg.saveConfig({ id: 'discord', type: 'discord', displayName: 'New', enabled: false, credentials: { token: 't.o.k', channelId: '456' } })
    const cfg = reg.getConfig('discord')
    expect(cfg?.displayName).toBe('New')
    expect(cfg?.enabled).toBe(false)
    expect(cfg?.credentials['channelId']).toBe('456')
  })

  it('persists configs across registry instances', () => {
    const dir = join(TEST_DIR, `persist-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    const reg1 = new ChatChannelRegistry(dir)
    reg1.saveConfig({ id: 'telegram', type: 'telegram', displayName: 'TG', enabled: true, credentials: { botToken: 'tok123' } })

    const reg2 = new ChatChannelRegistry(dir)
    const cfg = reg2.getConfig('telegram')
    expect(cfg).toBeDefined()
    expect(cfg?.credentials['botToken']).toBe('tok123')
  })
})

// ── getStatus ─────────────────────────────────────────────────────────────────

describe('getStatus', () => {
  it("returns 'not_installed' for unconfigured channel", () => {
    const reg = freshRegistry()
    expect(reg.getStatus('telegram')).toBe('not_installed')
  })

  it("returns 'installed' when channel is disabled", () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'telegram', type: 'telegram', displayName: 'TG', enabled: false, credentials: {} })
    expect(reg.getStatus('telegram')).toBe('installed')
  })

  it("returns 'credentials_missing' when enabled but required credentials absent", () => {
    const reg = freshRegistry()
    // Telegram requires botToken
    reg.saveConfig({ id: 'telegram', type: 'telegram', displayName: 'TG', enabled: true, credentials: {} })
    expect(reg.getStatus('telegram')).toBe('credentials_missing')
  })

  it("returns 'credentials_missing' when discord is missing channelId", () => {
    const reg = freshRegistry()
    // Discord requires token and channelId
    reg.saveConfig({ id: 'discord', type: 'discord', displayName: 'DC', enabled: true, credentials: { token: 'a.b.c' } })
    expect(reg.getStatus('discord')).toBe('credentials_missing')
  })

  it("returns 'awaiting_pairing' for whatsapp with credentials but no pairing", () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'whatsapp', type: 'whatsapp', displayName: 'WA', enabled: true, credentials: {} })
    // whatsapp has no required credential fields; it requires pairing
    expect(reg.getStatus('whatsapp')).toBe('awaiting_pairing')
  })

  it("returns 'connected' after health check records 'ok'", () => {
    const reg = freshRegistry()
    reg.saveConfig({
      id: 'telegram',
      type: 'telegram',
      displayName: 'TG',
      enabled: true,
      credentials: { botToken: 'tok' },
      lastHealthCheck: Date.now(),
      lastHealthStatus: 'ok',
    })
    expect(reg.getStatus('telegram')).toBe('connected')
  })

  it("returns 'error' after health check records 'error'", () => {
    const reg = freshRegistry()
    reg.saveConfig({
      id: 'telegram',
      type: 'telegram',
      displayName: 'TG',
      enabled: true,
      credentials: { botToken: 'tok' },
      lastHealthCheck: Date.now(),
      lastHealthStatus: 'error',
      lastError: 'Connection refused',
    })
    expect(reg.getStatus('telegram')).toBe('error')
  })

  it("returns 'installed' when enabled + credentials present but no health check yet", () => {
    const reg = freshRegistry()
    reg.saveConfig({
      id: 'telegram',
      type: 'telegram',
      displayName: 'TG',
      enabled: true,
      credentials: { botToken: 'tok' },
      // no lastHealthStatus set
    })
    expect(reg.getStatus('telegram')).toBe('installed')
  })
})

// ── validateCredentials ───────────────────────────────────────────────────────

describe('validateCredentials', () => {
  it('returns null when all required telegram fields are present', () => {
    const reg = freshRegistry()
    const result = reg.validateCredentials('telegram', { botToken: 'abc123' })
    expect(result).toBeNull()
  })

  it('returns an error string when telegram botToken is missing', () => {
    const reg = freshRegistry()
    const result = reg.validateCredentials('telegram', {})
    expect(typeof result).toBe('string')
    expect(result).toContain('botToken')
  })

  it('returns an error string when telegram botToken is empty string', () => {
    const reg = freshRegistry()
    const result = reg.validateCredentials('telegram', { botToken: '   ' })
    expect(typeof result).toBe('string')
  })

  it('returns null for whatsapp (no required credential fields)', () => {
    const reg = freshRegistry()
    const result = reg.validateCredentials('whatsapp', {})
    expect(result).toBeNull()
  })

  it('returns null for discord when all required fields present', () => {
    const reg = freshRegistry()
    const result = reg.validateCredentials('discord', { token: 'a.b.c', channelId: '123456' })
    expect(result).toBeNull()
  })

  it('returns an error for discord when channelId is missing', () => {
    const reg = freshRegistry()
    const result = reg.validateCredentials('discord', { token: 'a.b.c' })
    expect(typeof result).toBe('string')
    expect(result).toContain('channelId')
  })

  it('returns an error string for unknown channel id', () => {
    const reg = freshRegistry()
    const result = reg.validateCredentials('nonexistent-channel', {})
    expect(typeof result).toBe('string')
    expect(result).toContain('nonexistent-channel')
  })
})

// ── generatePairingCode ───────────────────────────────────────────────────────

describe('generatePairingCode', () => {
  it('returns an 8-character alphanumeric code', async () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'whatsapp', type: 'whatsapp', displayName: 'WA', enabled: true, credentials: {} })
    const { code } = await reg.generatePairingCode('whatsapp')
    expect(typeof code).toBe('string')
    expect(code).toHaveLength(8)
    expect(/^[A-Z2-9]+$/.test(code)).toBe(true)
  })

  it('returns an expiresAt timestamp ~60 minutes in the future', async () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'whatsapp', type: 'whatsapp', displayName: 'WA', enabled: true, credentials: {} })
    const before = Date.now()
    const { expiresAt } = await reg.generatePairingCode('whatsapp')
    const after = Date.now()
    const sixtyMin = 60 * 60 * 1_000
    expect(expiresAt).toBeGreaterThanOrEqual(before + sixtyMin - 100)
    expect(expiresAt).toBeLessThanOrEqual(after + sixtyMin + 100)
  })

  it('stores the pairing code in the config', async () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'whatsapp', type: 'whatsapp', displayName: 'WA', enabled: true, credentials: {} })
    const { code } = await reg.generatePairingCode('whatsapp')
    const cfg = reg.getConfig('whatsapp')
    expect(cfg?.pairingCode).toBe(code)
  })

  it('generates different codes on successive calls', async () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'whatsapp', type: 'whatsapp', displayName: 'WA', enabled: true, credentials: {} })
    const codes = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const { code } = await reg.generatePairingCode('whatsapp')
      codes.add(code)
    }
    // Very unlikely all 5 are equal given the character space
    expect(codes.size).toBeGreaterThan(1)
  })

  it('throws when channel id does not exist', async () => {
    const reg = freshRegistry()
    await expect(reg.generatePairingCode('whatsapp')).rejects.toThrow()
  })

  it('throws when channel type is not whatsapp', async () => {
    const reg = freshRegistry()
    reg.saveConfig({ id: 'telegram', type: 'telegram', displayName: 'TG', enabled: true, credentials: {} })
    await expect(reg.generatePairingCode('telegram')).rejects.toThrow()
  })
})
