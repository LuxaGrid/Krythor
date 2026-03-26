/**
 * Tests for ITEM G: per-agent DB memory scope enforcement.
 *
 * Tests:
 * 1. agent-scope agent only searches agent scope (not user scope)
 * 2. session-scope agent searches both session scope AND user scope
 * 3. workspace-scope agent searches both workspace scope AND user scope
 * 4. agent-scope agent is NOT contaminated by user-scope memories (isolation)
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from './AgentRunner.js';
import type { AgentDefinition, RunAgentInput } from './types.js';
import type { ModelEngine, InferenceResponse } from '@krythor/models';
import type { MemoryEngine, MemorySearchResult } from '@krythor/memory';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-42',
    name: 'Scope Test Agent',
    description: 'Testing scope isolation',
    systemPrompt: 'You are helpful.',
    memoryScope: 'agent',
    maxTurns: 2,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeInput(): RunAgentInput {
  return { input: 'test input' };
}

function makeInferResponse(content: string): InferenceResponse {
  return { content, model: 'test', providerId: 'test', promptTokens: 1, completionTokens: 1, durationMs: 10 };
}

function makeModelEngine(response = 'Done.'): ModelEngine {
  return {
    stats: () => ({ providerCount: 1, modelCount: 1, hasDefault: true }),
    infer: vi.fn().mockResolvedValue(makeInferResponse(response)),
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

function emptySearchResult(): MemorySearchResult[] {
  return [];
}

function makeMemoryEngine(searchMock: ReturnType<typeof vi.fn>): MemoryEngine {
  return {
    search: searchMock,
    create: vi.fn().mockReturnValue({ entry: { id: 'mem-1' }, warning: null }),
    recordUse: vi.fn(),
    stats: vi.fn().mockReturnValue({ totalEntries: 0, entryCount: 0, embeddingProvider: 'stub', embeddingDegraded: true }),
  } as unknown as MemoryEngine;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentRunner — per-agent memory scope enforcement (ITEM G)', () => {

  it('agent-scope agent calls search with scope=agent only — never calls user-scope search', async () => {
    const searchMock = vi.fn().mockResolvedValue(emptySearchResult());
    const memory = makeMemoryEngine(searchMock);
    const model = makeModelEngine();

    const runner = new AgentRunner(memory, model);
    const agent = makeAgent({ memoryScope: 'agent' });
    await runner.run(agent, makeInput(), () => {});

    // Every search call should have scope='agent' — user scope must NOT appear
    const calls = searchMock.mock.calls as Array<[Record<string, unknown>, string?]>;
    // Filter calls that are memory context building (not writeAgentMemory which doesn't search)
    const scopesUsed = calls.map(c => c[0]['scope']);
    expect(scopesUsed).not.toContain('user');
    // Must have searched agent scope
    expect(scopesUsed).toContain('agent');
  });

  it('session-scope agent searches both session scope and user scope', async () => {
    const searchMock = vi.fn().mockResolvedValue(emptySearchResult());
    const memory = makeMemoryEngine(searchMock);
    const model = makeModelEngine();

    const runner = new AgentRunner(memory, model);
    const agent = makeAgent({ memoryScope: 'session' });
    await runner.run(agent, makeInput(), () => {});

    const calls = searchMock.mock.calls as Array<[Record<string, unknown>, string?]>;
    const scopesUsed = calls.map(c => c[0]['scope']);
    expect(scopesUsed).toContain('session');
    expect(scopesUsed).toContain('user');
  });

  it('workspace-scope agent searches both workspace scope and user scope', async () => {
    const searchMock = vi.fn().mockResolvedValue(emptySearchResult());
    const memory = makeMemoryEngine(searchMock);
    const model = makeModelEngine();

    const runner = new AgentRunner(memory, model);
    const agent = makeAgent({ memoryScope: 'workspace' });
    await runner.run(agent, makeInput(), () => {});

    const calls = searchMock.mock.calls as Array<[Record<string, unknown>, string?]>;
    const scopesUsed = calls.map(c => c[0]['scope']);
    expect(scopesUsed).toContain('workspace');
    expect(scopesUsed).toContain('user');
  });

  it('agent-scope search uses scope_id = agent.id for isolation', async () => {
    const searchMock = vi.fn().mockResolvedValue(emptySearchResult());
    const memory = makeMemoryEngine(searchMock);
    const model = makeModelEngine();

    const runner = new AgentRunner(memory, model);
    const agent = makeAgent({ id: 'unique-agent-99', memoryScope: 'agent' });
    await runner.run(agent, makeInput(), () => {});

    const calls = searchMock.mock.calls as Array<[Record<string, unknown>, string?]>;
    const agentScopeCalls = calls.filter(c => c[0]['scope'] === 'agent');
    expect(agentScopeCalls.length).toBeGreaterThan(0);
    for (const call of agentScopeCalls) {
      expect(call[0]['scope_id']).toBe('unique-agent-99');
    }
  });
});
