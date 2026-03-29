import { describe, it, expect, beforeEach } from 'vitest';
import { TokenTracker, estimateCostUSD } from './TokenTracker.js';

describe('TokenTracker', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  it('starts with empty stats', () => {
    const snap = tracker.snapshot();
    expect(snap.session.providers).toHaveLength(0);
    expect(snap.totals.inputTokens).toBe(0);
    expect(snap.totals.outputTokens).toBe(0);
    expect(snap.totals.requests).toBe(0);
    expect(typeof snap.session.startTime).toBe('string');
  });

  it('records a single inference call', () => {
    tracker.record({ providerId: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    const snap = tracker.snapshot();
    expect(snap.session.providers).toHaveLength(1);
    expect(snap.totals.inputTokens).toBe(100);
    expect(snap.totals.outputTokens).toBe(50);
    expect(snap.totals.requests).toBe(1);
  });

  it('accumulates multiple calls for the same provider+model', () => {
    tracker.record({ providerId: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    tracker.record({ providerId: 'openai', model: 'gpt-4o', inputTokens: 200, outputTokens: 75 });
    const snap = tracker.snapshot();
    expect(snap.session.providers).toHaveLength(1);
    expect(snap.totals.inputTokens).toBe(300);
    expect(snap.totals.outputTokens).toBe(125);
    expect(snap.totals.requests).toBe(2);
  });

  it('tracks multiple providers separately', () => {
    tracker.record({ providerId: 'openai',    model: 'gpt-4o',           inputTokens: 100, outputTokens: 50 });
    tracker.record({ providerId: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 200, outputTokens: 75 });
    const snap = tracker.snapshot();
    expect(snap.session.providers).toHaveLength(2);
    expect(snap.totals.inputTokens).toBe(300);
    expect(snap.totals.requests).toBe(2);
  });

  it('handles undefined token counts as zero', () => {
    tracker.record({ providerId: 'ollama', model: 'llama3' });
    const snap = tracker.snapshot();
    expect(snap.totals.inputTokens).toBe(0);
    expect(snap.totals.outputTokens).toBe(0);
    expect(snap.totals.requests).toBe(1);
  });

  it('recordError increments error count', () => {
    tracker.record({ providerId: 'openai', model: 'gpt-4o', inputTokens: 10, outputTokens: 5 });
    tracker.recordError('openai', 'gpt-4o');
    const snap = tracker.snapshot();
    const p = snap.session.providers.find(x => x.name === 'openai')!;
    expect(p.errors).toBe(1);
    expect(p.requests).toBe(2); // both calls count
  });

  it('totalTokens sums input + output across all providers', () => {
    tracker.record({ providerId: 'a', model: 'm1', inputTokens: 100, outputTokens: 50 });
    tracker.record({ providerId: 'b', model: 'm2', inputTokens: 200, outputTokens: 75 });
    expect(tracker.totalTokens()).toBe(425);
  });

  it('reset clears all stats', () => {
    tracker.record({ providerId: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    tracker.reset();
    const snap = tracker.snapshot();
    expect(snap.session.providers).toHaveLength(0);
    expect(snap.totals.requests).toBe(0);
  });

  it('startTime is a valid ISO timestamp', () => {
    const snap = tracker.snapshot();
    const parsed = new Date(snap.session.startTime);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('includes estimatedCostUSD in totals', () => {
    tracker.record({ providerId: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 500_000 });
    const snap = tracker.snapshot();
    // 1M input * $3/M + 500K output * $15/M = $3 + $7.50 = $10.50
    expect(snap.totals.estimatedCostUSD).toBeCloseTo(10.5, 2);
  });

  it('includes estimatedCostUSD on provider stats', () => {
    tracker.record({ providerId: 'openai', model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 0 });
    const snap = tracker.snapshot();
    const p = snap.session.providers.find(x => x.model === 'gpt-4o')!;
    // 1M input * $5/M = $5
    expect(p.estimatedCostUSD).toBeCloseTo(5, 2);
  });

  it('returns undefined cost for local/unknown models', () => {
    expect(estimateCostUSD('llama3', 100, 50)).toBeUndefined();
    expect(estimateCostUSD('mistral:latest', 100, 50)).toBeUndefined();
  });

  it('estimateCostUSD works for known models', () => {
    // gpt-4o: $5/M input, $15/M output
    const cost = estimateCostUSD('gpt-4o', 100_000, 50_000);
    expect(cost).toBeCloseTo(0.5 + 0.75, 4); // $0.50 + $0.75 = $1.25
  });

  it('estimateCostUSD is case-insensitive', () => {
    const cost1 = estimateCostUSD('GPT-4O', 1000, 1000);
    const cost2 = estimateCostUSD('gpt-4o', 1000, 1000);
    expect(cost1).toBe(cost2);
  });
});
