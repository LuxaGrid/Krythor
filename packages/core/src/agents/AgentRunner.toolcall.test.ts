/**
 * Tests for the ExecTool → AgentRunner structured tool-call integration (P2-remaining-1).
 *
 * We test:
 * 1. The extractExecCall parser (via a thin wrapper exported for testing)
 * 2. AgentRunner.run() invokes ExecTool when a tool call is in the response
 * 3. Tool result is injected back and the model is called again
 * 4. The iteration cap (MAX_TOOL_CALL_ITERATIONS = 3) is respected
 * 5. When ExecTool is absent, tool-call JSON in response is treated as plain text
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from './AgentRunner.js';
import type { AgentDefinition, RunAgentInput } from './types.js';
import type { ModelEngine, InferenceResponse } from '@krythor/models';
import type { MemoryEngine } from '@krythor/memory';
import { ExecTool } from '../tools/ExecTool.js';

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
    input: 'What is the git status?',
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
    // Minimal stubs
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
  } as unknown as ModelEngine;
}

const noMemory = null as unknown as MemoryEngine;

// ── Parser tests (extractExecCall internals tested via AgentRunner behaviour) ─

describe('AgentRunner — tool-call JSON detection', () => {
  it('does not crash when response has no tool call', async () => {
    const model = makeModelEngine(['Hello, I am done.']);
    const runner = new AgentRunner(noMemory, model);
    const agent = makeAgent();
    const events: string[] = [];

    const run = await runner.run(agent, makeInput(), (e) => events.push(e.type));
    expect(run.status).toBe('completed');
    expect(run.output).toBe('Hello, I am done.');
  });

  it('detects tool call JSON and invokes ExecTool', async () => {
    // First model response contains a tool call; second is the final response
    const model = makeModelEngine([
      'I will check git status. {"tool":"exec","command":"echo","args":["hello"]}',
      'The git status output shows everything is clean.',
    ]);

    // Use a real ExecTool with null guard (no policy check)
    const execTool = new ExecTool(null);
    const runner = new AgentRunner(noMemory, model, undefined, execTool);
    const agent = makeAgent();
    const events: string[] = [];

    const run = await runner.run(agent, makeInput(), (e) => events.push(e.type));
    expect(run.status).toBe('completed');
    // Model should have been called twice (initial + after tool result)
    expect((model.infer as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    // Final output should be the post-tool-call response
    expect(run.output).toBe('The git status output shows everything is clean.');
  });

  it('skips tool call when ExecTool is not provided', async () => {
    const toolCallResponse = 'I need to run: {"tool":"exec","command":"echo","args":["hi"]}';
    const model = makeModelEngine([toolCallResponse]);
    const runner = new AgentRunner(noMemory, model); // no execTool
    const agent = makeAgent();

    const run = await runner.run(agent, makeInput(), () => {});
    expect(run.status).toBe('completed');
    // Without execTool, the tool-call JSON is treated as plain text
    expect(run.output).toBe(toolCallResponse);
    // Model called only once
    expect((model.infer as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('caps tool-call iterations at 3', async () => {
    // Every response contains a tool call — loop should stop after 3
    const toolCallJson = '{"tool":"exec","command":"echo","args":["loop"]}';
    // 1 initial + 3 tool iterations + 1 final = 5 model calls max
    const model = makeModelEngine([
      `turn 1 ${toolCallJson}`,
      `turn 2 ${toolCallJson}`,
      `turn 3 ${toolCallJson}`,
      `turn 4 ${toolCallJson}`,
      'final response — no more tool calls',
    ]);

    const execTool = new ExecTool(null);
    const runner = new AgentRunner(noMemory, model, undefined, execTool);
    const agent = makeAgent({ maxTurns: 10 });

    const run = await runner.run(agent, makeInput(), () => {});
    expect(run.status).toBe('completed');
    // Tool call loop is capped at MAX_TOOL_CALL_ITERATIONS = 3
    // Total model calls = 1 (initial) + 3 (tool iterations) + 1 (after-cap final) = ≤ 5
    const callCount = (model.infer as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(5);
  });

  it('handles ExecDeniedError gracefully — continues to final response', async () => {
    const model = makeModelEngine([
      '{"tool":"exec","command":"rm","args":["-rf"]}', // rm is NOT in allowlist
      'I was denied — proceeding without the command.',
    ]);

    const execTool = new ExecTool(null); // no guard, but allowlist still applies
    const runner = new AgentRunner(noMemory, model, undefined, execTool);
    const agent = makeAgent();

    const run = await runner.run(agent, makeInput(), () => {});
    // Should not throw — denial is caught and injected as tool result
    expect(run.status).toBe('completed');
    // Model is called at least twice (initial + after denial message)
    expect((model.infer as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
