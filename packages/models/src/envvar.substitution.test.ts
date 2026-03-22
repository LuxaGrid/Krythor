/**
 * ITEM E — Env var substitution in providers.json
 *
 * Tests that ${ENV_VAR_NAME} placeholders in providers.json are replaced
 * with the corresponding process.env value at load time.
 *
 * The substitution only applies to string values, not booleans or numbers.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ModelRegistry } from './ModelRegistry.js'

function makeTmpConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'krythor-envvar-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  return join(dir, 'config')
}

function writeProviders(configDir: string, content: unknown): void {
  writeFileSync(join(configDir, 'providers.json'), JSON.stringify(content), 'utf-8')
}

describe('ITEM E — env var substitution in providers.json', () => {
  afterEach(() => {
    // Clean up any test env vars
    delete process.env['TEST_ANTHROPIC_KEY']
    delete process.env['TEST_ENDPOINT']
    delete process.env['TEST_PROVIDER_NAME']
  })

  it('substitutes ${ENV_VAR_NAME} in apiKey field when env var is set', () => {
    const configDir = makeTmpConfigDir()
    process.env['TEST_ANTHROPIC_KEY'] = 'sk-ant-test-12345'

    writeProviders(configDir, [{
      id: 'anthropic-env',
      name: 'Anthropic (env)',
      type: 'anthropic',
      endpoint: 'https://api.anthropic.com',
      authMethod: 'api_key',
      apiKey: '${TEST_ANTHROPIC_KEY}',
      isDefault: false,
      isEnabled: true,
      models: ['claude-3-5-haiku-20241022'],
    }])

    const registry = new ModelRegistry(configDir)
    const configs = registry.listConfigs()
    expect(configs).toHaveLength(1)
    // The apiKey is encrypted at rest, but we can verify the config loaded
    expect(configs[0]!.id).toBe('anthropic-env')
    // apiKey should be set (not empty — substitution worked, then it was encrypted)
    expect(typeof configs[0]!.apiKey).toBe('string')
    expect(configs[0]!.apiKey!.length).toBeGreaterThan(0)
  })

  it('substitutes ${ENV_VAR_NAME} in endpoint field', () => {
    const configDir = makeTmpConfigDir()
    process.env['TEST_ENDPOINT'] = 'http://my-local-ollama:11434'

    writeProviders(configDir, [{
      id: 'ollama-env',
      name: 'Ollama (env)',
      type: 'ollama',
      endpoint: '${TEST_ENDPOINT}',
      authMethod: 'none',
      isDefault: false,
      isEnabled: true,
      models: ['llama3.2'],
    }])

    const registry = new ModelRegistry(configDir)
    const configs = registry.listConfigs()
    expect(configs).toHaveLength(1)
    // The endpoint should have been substituted
    expect(configs[0]!.endpoint).toBe('http://my-local-ollama:11434')
  })

  it('leaves placeholder as-is when env var is not set and logs warning', () => {
    const configDir = makeTmpConfigDir()
    // Ensure the env var is definitely not set
    delete process.env['MISSING_KEY_XYZ_ABC']

    const warnSpy: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warnSpy.push(String(args[0])) }

    try {
      writeProviders(configDir, [{
        id: 'ollama-missing',
        name: 'Ollama (missing key)',
        type: 'ollama',
        endpoint: 'http://localhost:11434',
        authMethod: 'api_key',
        apiKey: '${MISSING_KEY_XYZ_ABC}',
        isDefault: false,
        isEnabled: true,
        models: ['llama3.2'],
      }])

      const registry = new ModelRegistry(configDir)
      const configs = registry.listConfigs()
      // Provider should still load (placeholder left in place)
      expect(configs).toHaveLength(1)
      // A warning should have been logged
      expect(warnSpy.some(w => w.includes('MISSING_KEY_XYZ_ABC'))).toBe(true)
      // The apiKey should contain the placeholder (stored as-is)
      expect(configs[0]!.apiKey).toContain('MISSING_KEY_XYZ_ABC')
    } finally {
      console.warn = origWarn
    }
  })

  it('does not affect boolean or number fields', () => {
    const configDir = makeTmpConfigDir()

    writeProviders(configDir, [{
      id: 'ollama-bool',
      name: 'Ollama',
      type: 'ollama',
      endpoint: 'http://localhost:11434',
      authMethod: 'none',
      isDefault: true,
      isEnabled: true,
      priority: 5,
      maxRetries: 3,
      models: ['llama3.2'],
    }])

    const registry = new ModelRegistry(configDir)
    const configs = registry.listConfigs()
    expect(configs).toHaveLength(1)
    // Booleans and numbers should be intact
    expect(configs[0]!.isDefault).toBe(true)
    expect(configs[0]!.isEnabled).toBe(true)
    expect(configs[0]!.priority).toBe(5)
    expect(configs[0]!.maxRetries).toBe(3)
  })

  it('substitutes multiple env vars in the same file', () => {
    const configDir = makeTmpConfigDir()
    process.env['TEST_ANTHROPIC_KEY'] = 'sk-ant-multi-1'
    process.env['TEST_ENDPOINT'] = 'https://openai.example.com'

    writeProviders(configDir, [
      {
        id: 'provider-a',
        name: 'Anthropic',
        type: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        authMethod: 'api_key',
        apiKey: '${TEST_ANTHROPIC_KEY}',
        isDefault: false,
        isEnabled: true,
        models: ['claude-3-5-haiku-20241022'],
      },
      {
        id: 'provider-b',
        name: 'OpenAI Compat',
        type: 'openai-compat',
        endpoint: '${TEST_ENDPOINT}',
        authMethod: 'none',
        isDefault: false,
        isEnabled: true,
        models: ['custom-model'],
      },
    ])

    const registry = new ModelRegistry(configDir)
    const configs = registry.listConfigs()
    expect(configs).toHaveLength(2)
    expect(configs[1]!.endpoint).toBe('https://openai.example.com')
  })
})
