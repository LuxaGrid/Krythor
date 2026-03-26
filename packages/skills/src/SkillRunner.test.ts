/**
 * Tests for SkillRunner — timeout, abort, concurrency, and happy path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SkillRunner, SkillTimeoutError, SkillConcurrencyError, SkillPermissionError } from './SkillRunner.js';
import type { Skill } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'Test Skill',
    description: '',
    systemPrompt: 'You are helpful.',
    tags: [],
    permissions: [],
    version: 1,
    runCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

type InferResult = { content: string; model: string; providerId: string; durationMs: number };

function makeInfer(result: Partial<InferResult> = {}, delayMs = 0): (...args: unknown[]) => Promise<InferResult> {
  return async (_req, _ctx, rawSignal?: unknown) => {
    const signal = rawSignal as AbortSignal | undefined;
    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error('aborted'));
        }, { once: true });
      });
    }
    return {
      content: 'output',
      model: 'gpt-4',
      providerId: 'openai',
      durationMs: 10,
      ...result,
    };
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe('SkillRunner — happy path', () => {
  it('returns result with skillId, skillName, and output', async () => {
    const skill = makeSkill();
    const runner = new SkillRunner(makeInfer(), id => (id === 'skill-1' ? skill : null));
    const result = await runner.run({ skillId: 'skill-1', input: 'hello' });
    expect(result.skillId).toBe('skill-1');
    expect(result.skillName).toBe('Test Skill');
    expect(result.output).toBe('output');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws if skill is not found', async () => {
    const runner = new SkillRunner(makeInfer(), () => null);
    await expect(runner.run({ skillId: 'missing', input: 'x' })).rejects.toThrow('not found');
  });

  it('activeRunCount is 0 before any run', () => {
    const runner = new SkillRunner(makeInfer(), () => null);
    expect(runner.activeRunCount()).toBe(0);
  });

  it('activeRunCount returns to 0 after run completes', async () => {
    const skill = makeSkill();
    const runner = new SkillRunner(makeInfer(), () => skill);
    await runner.run({ skillId: 'skill-1', input: 'x' });
    expect(runner.activeRunCount()).toBe(0);
  });
});

// ── Timeout ───────────────────────────────────────────────────────────────────

describe('SkillRunner — timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws SkillTimeoutError when skill.timeoutMs is exceeded', async () => {
    vi.useFakeTimers();

    const skill = makeSkill({ timeoutMs: 100 });
    // Infer never resolves unless aborted
    const infer = makeInfer({}, 99_999);
    const runner = new SkillRunner(infer as never, () => skill);

    const runPromise = runner.run({ skillId: 'skill-1', input: 'x' });
    vi.advanceTimersByTime(200);

    await expect(runPromise).rejects.toBeInstanceOf(SkillTimeoutError);
  });

  it('SkillTimeoutError message includes skillId and timeout', async () => {
    vi.useFakeTimers();

    const skill = makeSkill({ id: 'slow-skill', timeoutMs: 500 });
    const infer = makeInfer({}, 99_999);
    const runner = new SkillRunner(infer as never, () => skill);

    const runPromise = runner.run({ skillId: 'slow-skill', input: 'x' });
    vi.advanceTimersByTime(600);

    const err = await runPromise.catch(e => e);
    expect(err).toBeInstanceOf(SkillTimeoutError);
    expect(err.message).toContain('slow-skill');
    expect(err.message).toContain('500ms');
  });
});

// ── Abort ─────────────────────────────────────────────────────────────────────

describe('SkillRunner — abort', () => {
  it('throws when AbortSignal is already aborted before run starts', async () => {
    const skill = makeSkill();
    const runner = new SkillRunner(makeInfer(), () => skill);
    const signal = AbortSignal.abort();
    await expect(runner.run({ skillId: 'skill-1', input: 'x', abortSignal: signal }))
      .rejects.toThrow('aborted before start');
  });

  it('activeRunCount returns to 0 after abort before start', async () => {
    const skill = makeSkill();
    const runner = new SkillRunner(makeInfer(), () => skill);
    const signal = AbortSignal.abort();
    await runner.run({ skillId: 'skill-1', input: 'x', abortSignal: signal }).catch(() => {});
    expect(runner.activeRunCount()).toBe(0);
  });
});

// ── Concurrency ───────────────────────────────────────────────────────────────

describe('SkillRunner — concurrency', () => {
  it('throws SkillConcurrencyError when per-skill limit is reached', async () => {
    vi.useFakeTimers();
    const skill = makeSkill();
    const infer = makeInfer({}, 99_999);
    const runner = new SkillRunner(infer as never, () => skill);

    // Start MAX_CONCURRENT_PER_SKILL (3) runs in flight
    void runner.run({ skillId: 'skill-1', input: 'a' });
    void runner.run({ skillId: 'skill-1', input: 'b' });
    void runner.run({ skillId: 'skill-1', input: 'c' });

    await expect(runner.run({ skillId: 'skill-1', input: 'd' }))
      .rejects.toBeInstanceOf(SkillConcurrencyError);

    vi.useRealTimers();
  });
});

// ── Permission ────────────────────────────────────────────────────────────────

describe('SkillRunner — permissions', () => {
  it('throws SkillPermissionError when permission is denied', async () => {
    const skill = makeSkill({ permissions: ['memory:write'] });
    const runner = new SkillRunner(
      makeInfer(),
      () => skill,
      undefined,
      () => false, // deny all
    );
    await expect(runner.run({ skillId: 'skill-1', input: 'x' }))
      .rejects.toBeInstanceOf(SkillPermissionError);
  });
});
