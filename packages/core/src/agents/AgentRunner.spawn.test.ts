/**
 * Tests for ITEM B: spawn_agent tool in AgentRunner.
 *
 * Tests:
 * 1. spawn_agent resolves to target agent's response
 * 2. spawn_agent with unknown agent returns error message (not a crash)
 * 3. spawn_agent cap enforced (max 2 spawns per run)
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from './AgentRunner.js';
import type { AgentDefinition, RunAgentInput } from './types.js';
import type { ModelEngine, InferenceResponse } from '@krythor/models';
import type { MemoryEngine } from '@krythor/memory';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent',
    systemPrompt: 'You are a helpful assistant.',
    memoryScope: 'session',
    maxTurns: 5,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    input: 'Please spawn a sub-agent.',
    ...overrides,
  };
}

function makeInferResponse(content: string): InferenceResponse {
  return {
    content,
    model: 'test-model',
    providerId: 'test-provider',
    promptTokens: 10,
    completionTokens: 5,
    durationMs: 10,
  };
}

function makeModelEngine(responses: string[]): ModelEngine {
  let callIndex = 0;
  return {
    stats: () => ({ providerCount: 1, modelCount: 1, hasDefault: true }),
    infer: vi.fn().mockImplementation(async () => {
      const content = responses[callIndex] ?? 'done';
      callIndex++;
      return makeInferResponse(content);
    }),
    inferStream: vi.fn(),
    addProvider: vi.fn(),
    updateProvider: vi.fn(),
    removeProvider: vi.fn(),
    connectOAuth: vi.fn(),
    disconnectOAuth: vi.fn(),
    refreshOAuthTokens: vi.fn(),
    listProviders: vi.fn().mockReturnValue([]),
    listModels: vi.fn().mockReturnValue([]),
    checkAvailability: vi.fn(),
    refreshModels: vi.fn(),
    reloadProviders: vi.fn(),
    circuitStats: vi.fn().mockReturnValue({}),
    tokenTracker: { record: vi.fn(), recordError: vi.fn(), snapshot: vi.fn(), totalTokens: vi.fn().mockReturnValue(0) },
    getFirstOllamaEndpoint: vi.fn().mockReturnValue(null),
  } as unknown as ModelEngine;
}

const noMemory = null as unknown as MemoryEngine;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentRunner — spawn_agent tool', () => {

  it('spawn_agent resolves to target agent response', async () => {
    const spawnResolver = vi.fn().mockResolvedValue('Sub-agent result: done.');

    const model = makeModelEngine([
      '{"tool":"spawn_agent","agentId":"child-1","message":"hello"}',
      'Final response after spawn.',
    ]);

    const runner = new AgentRunner(
      noMemory, model,
      undefined, null, null, null,
      spawnResolver,
    );
    const agent = makeAgent();

    const run = await runner.run(agent, makeInput(), () => {});

    expect(run.status).toBe('completed');
    expect(spawnResolver).toHaveBeenCalledWith('child-1', 'hello');
    // Model should have been called twice (initial + after tool result)
    expect((model.infer as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(run.output).toBe('Final response after spawn.');
  });

  it('spawn_agent with unknown agent returns error message — no crash', async () => {
    // spawnResolver returns null = agent not found
    const spawnResolver = vi.fn().mockResolvedValue(null);

    const model = makeModelEngine([
      '{"tool":"spawn_agent","agentId":"ghost","message":"hello"}',
      'I see the agent was not found.',
    ]);

    const runner = new AgentRunner(
      noMemory, model,
      undefined, null, null, null,
      spawnResolver,
    );
    const agent = makeAgent();

    const run = await runner.run(agent, makeInput(), () => {});

    expect(run.status).toBe('completed');
    expect(spawnResolver).toHaveBeenCalledWith('ghost', 'hello');
    // Message injected should mention agent not found
    const allCalls = (model.infer as ReturnType<typeof vi.fn>).mock.calls;
    const secondCallMessages = allCalls[1]?.[0]?.messages ?? [];
    const toolResultMsg = secondCallMessages.find(
      (m: { role: string; content: string }) => m.role === 'user' && m.content.includes('not found'),
    );
    expect(toolResultMsg).toBeDefined();
  });

  it('spawn_agent cap is enforced at 2 spawns per run', async () => {
    const spawnResolver = vi.fn().mockResolvedValue('sub-result');

    // Every response tries to spawn another agent
    const spawnCall = '{"tool":"spawn_agent","agentId":"loop-agent","message":"go"}';
    const model = makeModelEngine([
      spawnCall,         // spawn 1
      spawnCall,         // spawn 2
      spawnCall,         // spawn 3 — should be blocked by cap
      'Final response.', // after cap
    ]);

    const runner = new AgentRunner(
      noMemory, model,
      undefined, null, null, null,
      spawnResolver,
    );
    const agent = makeAgent({ maxTurns: 10 });

    const run = await runner.run(agent, makeInput(), () => {});

    expect(run.status).toBe('completed');
    // Resolver should have been called at most MAX_SPAWN_AGENT (2) times
    expect(spawnResolver.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('spawn_agent without resolver returns informative error', async () => {
    const model = makeModelEngine([
      '{"tool":"spawn_agent","agentId":"child","message":"hi"}',
      'Fallback response.',
    ]);

    // No spawnAgentResolver provided
    const runner = new AgentRunner(noMemory, model);
    const agent = makeAgent();

    const run = await runner.run(agent, makeInput(), () => {});
    expect(run.status).toBe('completed');
    // Should not crash; tool result injected as informative message
    const allCalls = (model.infer as ReturnType<typeof vi.fn>).mock.calls;
    expect(allCalls.length).toBeGreaterThanOrEqual(2);
  });
});
