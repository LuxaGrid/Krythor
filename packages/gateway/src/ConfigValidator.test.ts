/**
 * ITEM 4 — ConfigValidator tests
 *
 * validateProviderConfig: valid config passes, missing required fields skipped,
 * malformed JSON caught.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { validateProvidersConfig } from './ConfigValidator.js'

// Create a temp directory per test run to avoid inter-test pollution
const TEST_DIR = join(tmpdir(), `krythor-cv-test-${randomUUID()}`)
const CONFIG_DIR = join(TEST_DIR, 'config')

beforeAll(() => {
  mkdirSync(CONFIG_DIR, { recursive: true })
})

afterAll(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
})

function writeProv(content: string): void {
  writeFileSync(join(CONFIG_DIR, 'providers.json'), content, 'utf-8')
}

function cleanProv(): void {
  try { rmSync(join(CONFIG_DIR, 'providers.json')) } catch {}
}

describe('validateProvidersConfig — file not found', () => {
  it('returns fileNotFound:true when providers.json is missing', () => {
    cleanProv()
    const result = validateProvidersConfig(CONFIG_DIR)
    expect(result.fileNotFound).toBe(true)
    expect(result.providers).toHaveLength(0)
    expect(result.malformedJson).toBe(false)
  })
})

describe('validateProvidersConfig — valid config', () => {
  it('parses a valid providers array', () => {
    writeProv(JSON.stringify([
      {
        id:         'p1',
        name:       'Ollama Local',
        type:       'ollama',
        endpoint:   'http://localhost:11434',
        authMethod: 'none',
        isDefault:  true,
        isEnabled:  true,
        models:     ['llama3.2'],
      },
    ]))
    const result = validateProvidersConfig(CONFIG_DIR)
    expect(result.fileNotFound).toBe(false)
    expect(result.malformedJson).toBe(false)
    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]?.id).toBe('p1')
    expect(result.skippedCount).toBe(0)
  })

  it('parses wrapped format { version, providers }', () => {
    writeProv(JSON.stringify({
      version: '1',
      providers: [
        {
          id:         'p2',
          name:       'Test OpenAI',
          type:       'openai',
          endpoint:   'https://api.openai.com/v1',
          authMethod: 'api_key',
          apiKey:     'sk-test',
          isDefault:  false,
          isEnabled:  true,
          models:     ['gpt-4o'],
        },
      ],
    }))
    const result = validateProvidersConfig(CONFIG_DIR)
    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]?.name).toBe('Test OpenAI')
    expect(result.skippedCount).toBe(0)
  })
})

describe('validateProvidersConfig — missing required fields', () => {
  it('skips entries missing required id/name/type/endpoint', () => {
    writeProv(JSON.stringify([
      {
        // missing id, type, endpoint
        name: 'Bad Provider',
        authMethod: 'none',
        isDefault: false,
        isEnabled: true,
        models: [],
      },
    ]))
    const result = validateProvidersConfig(CONFIG_DIR)
    expect(result.providers).toHaveLength(0)
    expect(result.skippedCount).toBe(1)
    expect(result.validationErrors.length).toBeGreaterThan(0)
  })

  it('skips entries with invalid type', () => {
    writeProv(JSON.stringify([
      {
        id:         'bad-type',
        name:       'Bad Type',
        type:       'unknown-provider-type',
        endpoint:   'http://localhost:1234',
        authMethod: 'none',
        isDefault:  false,
        isEnabled:  true,
        models:     [],
      },
    ]))
    const result = validateProvidersConfig(CONFIG_DIR)
    expect(result.providers).toHaveLength(0)
    expect(result.skippedCount).toBe(1)
  })

  it('returns valid entries even when some are invalid (mixed)', () => {
    writeProv(JSON.stringify([
      {
        id:         'good-p',
        name:       'Good Provider',
        type:       'ollama',
        endpoint:   'http://localhost:11434',
        authMethod: 'none',
        isDefault:  true,
        isEnabled:  true,
        models:     ['llama3.2'],
      },
      {
        // missing type and endpoint
        name: 'Bad Provider',
      },
    ]))
    const result = validateProvidersConfig(CONFIG_DIR)
    expect(result.providers).toHaveLength(1)
    expect(result.skippedCount).toBe(1)
    expect(result.providers[0]?.id).toBe('good-p')
  })
})

describe('validateProvidersConfig — malformed JSON', () => {
  it('returns malformedJson:true for invalid JSON', () => {
    writeProv('{ not valid json !!!')
    const result = validateProvidersConfig(CONFIG_DIR)
    expect(result.malformedJson).toBe(true)
    expect(result.providers).toHaveLength(0)
    expect(result.fileNotFound).toBe(false)
  })

  it('returns malformedJson:true for truncated JSON', () => {
    writeProv('[{"id":"p1","name":"Test"')
    const result = validateProvidersConfig(CONFIG_DIR)
    expect(result.malformedJson).toBe(true)
  })
})
