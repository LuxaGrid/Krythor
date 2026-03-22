/**
 * Live provider tests — ITEM 4
 *
 * These tests are SKIPPED by default and only run when the corresponding
 * environment variable is set. They make real HTTP requests to external
 * AI providers and consume real API quota.
 *
 * To run live tests:
 *   KRYTHOR_TEST_ANTHROPIC_KEY=<key>  pnpm test
 *   KRYTHOR_TEST_OPENAI_KEY=<key>     pnpm test
 *   KRYTHOR_TEST_OLLAMA_URL=<url>     pnpm test  (e.g. http://127.0.0.1:11434)
 *
 * See docs/help/testing.md for full instructions.
 */
import { describe, it, expect } from 'vitest'

const ANTHROPIC_KEY  = process.env['KRYTHOR_TEST_ANTHROPIC_KEY']
const OPENAI_KEY     = process.env['KRYTHOR_TEST_OPENAI_KEY']
const OLLAMA_URL     = process.env['KRYTHOR_TEST_OLLAMA_URL']

const TEST_PROMPT = 'Say: ok'
const TIMEOUT_MS  = 30_000

describe('Live provider tests', () => {
  it.skipIf(!ANTHROPIC_KEY)('Anthropic — completes a minimal inference call', async () => {
    const key = ANTHROPIC_KEY!
    const start = Date.now()
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-20240307',
        max_tokens: 16,
        messages:   [{ role: 'user', content: TEST_PROMPT }],
      }),
    })
    const latencyMs = Date.now() - start
    expect(res.ok).toBe(true)
    const data = await res.json() as Record<string, unknown>
    expect(data.type).toBe('message')
    // Response content array must exist and have at least one block
    const content = data.content as Array<{ type: string; text?: string }>
    expect(Array.isArray(content)).toBe(true)
    expect(content.length).toBeGreaterThan(0)
    console.log(`[live] Anthropic OK — ${latencyMs}ms, reply: "${content[0]?.text?.slice(0, 50)}"`)
  }, TIMEOUT_MS + 5_000)

  it.skipIf(!OPENAI_KEY)('OpenAI — completes a minimal inference call', async () => {
    const key = OPENAI_KEY!
    const start = Date.now()
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:      'gpt-3.5-turbo',
        max_tokens: 16,
        messages:   [{ role: 'user', content: TEST_PROMPT }],
      }),
    })
    const latencyMs = Date.now() - start
    expect(res.ok).toBe(true)
    const data = await res.json() as Record<string, unknown>
    expect(data.object).toBe('chat.completion')
    const choices = data.choices as Array<{ message: { content: string } }>
    expect(Array.isArray(choices)).toBe(true)
    expect(choices.length).toBeGreaterThan(0)
    console.log(`[live] OpenAI OK — ${latencyMs}ms, reply: "${choices[0]?.message?.content?.slice(0, 50)}"`)
  }, TIMEOUT_MS + 5_000)

  it.skipIf(!OLLAMA_URL)('Ollama — lists installed models and verifies API is reachable', async () => {
    const baseUrl = OLLAMA_URL!.replace(/\/$/, '')
    const start = Date.now()
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const latencyMs = Date.now() - start
    expect(res.ok).toBe(true)
    const data = await res.json() as { models?: Array<{ name: string }> }
    expect(Array.isArray(data.models)).toBe(true)
    console.log(`[live] Ollama OK — ${latencyMs}ms, ${data.models?.length ?? 0} model(s) installed`)

    // If at least one model is installed, run a quick inference
    if (data.models && data.models.length > 0) {
      const modelName = data.models[0]!.name
      const inferRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:  modelName,
          stream: false,
          messages: [{ role: 'user', content: TEST_PROMPT }],
        }),
      })
      expect(inferRes.ok).toBe(true)
      const inferData = await inferRes.json() as { message?: { content?: string } }
      expect(typeof inferData.message?.content).toBe('string')
      console.log(`[live] Ollama inference OK — model=${modelName}, reply: "${inferData.message?.content?.slice(0, 50)}"`)
    }
  }, TIMEOUT_MS * 2)
})
