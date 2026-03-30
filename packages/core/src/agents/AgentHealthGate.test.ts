import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentHealthGate, AgentPausedError } from './AgentHealthGate.js';

const AGENT = 'agent-1';

describe('AgentHealthGate', () => {
  let gate: AgentHealthGate;

  beforeEach(() => {
    gate = new AgentHealthGate({
      windowSize: 5,
      degradedStabilityThreshold:  0.70,
      pausedStabilityThreshold:    0.50,
      degradedEfficiencyThreshold: 0.60,
      pausedEfficiencyThreshold:   0.40,
      consecutiveFailureLimit:     3,
      recoveryWindowMs:            5_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── snapshot defaults ──────────────────────────────────────────────────────

  describe('snapshot() with no runs', () => {
    it('returns healthy phase with perfect scores', () => {
      const snap = gate.snapshot(AGENT);
      expect(snap.phase).toBe('healthy');
      expect(snap.stability).toBe(1);
      expect(snap.efficiency).toBe(1);
      expect(snap.windowSize).toBe(0);
      expect(snap.totalRuns).toBe(0);
      expect(snap.consecutiveFailures).toBe(0);
      expect(snap.pausedUntil).toBeNull();
    });
  });

  // ── check() when healthy ──────────────────────────────────────────────────

  describe('check()', () => {
    it('does not throw when agent is healthy', () => {
      expect(() => gate.check(AGENT)).not.toThrow();
    });

    it('does not throw for an unknown agent', () => {
      expect(() => gate.check('unknown')).not.toThrow();
    });
  });

  // ── phase transitions ─────────────────────────────────────────────────────

  describe('phase: degraded', () => {
    it('enters degraded when stability falls below threshold', () => {
      // 2 successes then 2 failures in window of 4 = 50% stability
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      const snap = gate.snapshot(AGENT);
      // stability = 2/4 = 0.50, below 0.70 degraded threshold
      expect(snap.phase).toBe('degraded');
      expect(snap.stability).toBeCloseTo(0.5);
    });

    it('enters degraded when efficiency is below degraded threshold but above paused threshold', () => {
      // 2 clean runs then 2 fallback runs = 50% efficiency — below 0.60 degraded, above 0.40 paused
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success', { fallbackOccurred: true });
      gate.record(AGENT, 'success', { fallbackOccurred: true });
      const snap = gate.snapshot(AGENT);
      // stability = 1.0, efficiency = 2/4 = 0.50 — degraded but not paused
      expect(snap.phase).toBe('degraded');
      expect(snap.stability).toBe(1);
      expect(snap.efficiency).toBeCloseTo(0.5);
    });
  });

  describe('phase: paused', () => {
    it('pauses after consecutiveFailureLimit consecutive failures', () => {
      // Seed with 3 clean successes to keep stability well above paused threshold
      // even when 2 failures arrive (window of 5: 3 success + 2 fail = 60% stability > 50%)
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      expect(gate.snapshot(AGENT).phase).not.toBe('paused');
      gate.record(AGENT, 'failure'); // 3rd consecutive failure — triggers pause via counter
      const snap = gate.snapshot(AGENT);
      expect(snap.phase).toBe('paused');
      expect(snap.pausedUntil).toBeGreaterThan(Date.now());
    });

    it('check() throws AgentPausedError when paused', () => {
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      expect(() => gate.check(AGENT)).toThrow(AgentPausedError);
    });

    it('AgentPausedError contains snapshot and pausedUntil', () => {
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      let err: AgentPausedError | null = null;
      try { gate.check(AGENT); } catch (e) { err = e as AgentPausedError; }
      expect(err).not.toBeNull();
      expect(err!.agentId).toBe(AGENT);
      expect(err!.pausedUntil).toBeGreaterThan(Date.now());
      expect(err!.snapshot.phase).toBe('paused');
    });

    it('pauses when stability drops below pausedStabilityThreshold', () => {
      // 1 success, 4 failures in window of 5 = 20% stability < 0.50
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      expect(gate.snapshot(AGENT).phase).toBe('paused');
    });

    it('pauses when efficiency drops below pausedEfficiencyThreshold', () => {
      // All succeed but all with retries — efficiency = 0 < 0.40
      gate.record(AGENT, 'success', { retryCount: 2 });
      gate.record(AGENT, 'success', { retryCount: 1 });
      gate.record(AGENT, 'success', { retryCount: 3 });
      gate.record(AGENT, 'success', { retryCount: 1 });
      gate.record(AGENT, 'success', { retryCount: 2 });
      expect(gate.snapshot(AGENT).phase).toBe('paused');
    });
  });

  // ── auto-recovery ─────────────────────────────────────────────────────────

  describe('auto-recovery', () => {
    it('auto-recovers after recoveryWindowMs elapses', () => {
      vi.useFakeTimers();
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      expect(gate.snapshot(AGENT).phase).toBe('paused');

      vi.advanceTimersByTime(5_001);
      // check() should clear the pause on the next call
      expect(() => gate.check(AGENT)).not.toThrow();
      expect(gate.snapshot(AGENT).phase).not.toBe('paused');
    });

    it('resets consecutiveFailures on auto-recovery', () => {
      vi.useFakeTimers();
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      vi.advanceTimersByTime(5_001);
      gate.check(AGENT);
      expect(gate.snapshot(AGENT).consecutiveFailures).toBe(0);
    });
  });

  // ── unpause() ─────────────────────────────────────────────────────────────

  describe('unpause()', () => {
    it('manually clears a pause', () => {
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      expect(gate.snapshot(AGENT).phase).toBe('paused');
      gate.unpause(AGENT);
      expect(() => gate.check(AGENT)).not.toThrow();
    });

    it('resets consecutiveFailures on unpause', () => {
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.unpause(AGENT);
      expect(gate.snapshot(AGENT).consecutiveFailures).toBe(0);
    });
  });

  // ── reset() ───────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('clears all state for an agent', () => {
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.record(AGENT, 'failure');
      gate.reset(AGENT);
      const snap = gate.snapshot(AGENT);
      expect(snap.phase).toBe('healthy');
      expect(snap.stability).toBe(1);
      expect(snap.totalRuns).toBe(0);
      expect(snap.windowSize).toBe(0);
    });
  });

  // ── rolling window ────────────────────────────────────────────────────────

  describe('rolling window', () => {
    it('only keeps the last windowSize runs', () => {
      // 5 failures then 5 successes — window of 5 should be all successes
      for (let i = 0; i < 5; i++) gate.record(AGENT, 'failure');
      // Force unpause so we can keep recording
      gate.unpause(AGENT);
      for (let i = 0; i < 5; i++) gate.record(AGENT, 'success');
      const snap = gate.snapshot(AGENT);
      expect(snap.stability).toBe(1); // only the 5 successes are in the window
      expect(snap.windowSize).toBe(5);
    });

    it('stability is 1 after recovery runs fill the window', () => {
      gate.record(AGENT, 'failure');
      gate.unpause(AGENT);
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success');
      gate.record(AGENT, 'success');
      expect(gate.snapshot(AGENT).stability).toBe(1);
      expect(gate.snapshot(AGENT).phase).toBe('healthy');
    });
  });

  // ── allSnapshots() ────────────────────────────────────────────────────────

  describe('allSnapshots()', () => {
    it('returns empty array when no agents recorded', () => {
      expect(gate.allSnapshots()).toHaveLength(0);
    });

    it('returns one snapshot per tracked agent', () => {
      gate.record('a1', 'success');
      gate.record('a2', 'failure');
      gate.record('a2', 'failure');
      gate.record('a2', 'failure');
      const snaps = gate.allSnapshots();
      expect(snaps.length).toBe(2);
      expect(snaps.find(s => s.agentId === 'a1')?.phase).toBe('healthy');
      expect(snaps.find(s => s.agentId === 'a2')?.phase).toBe('paused');
    });
  });

  // ── clean run detection ───────────────────────────────────────────────────

  describe('efficiency / clean run detection', () => {
    it('a success with no fallback and retryCount 0 is clean', () => {
      gate.record(AGENT, 'success', { fallbackOccurred: false, retryCount: 0 });
      expect(gate.snapshot(AGENT).efficiency).toBe(1);
    });

    it('a success with fallback is not clean', () => {
      gate.record(AGENT, 'success', { fallbackOccurred: true });
      expect(gate.snapshot(AGENT).efficiency).toBe(0);
    });

    it('a success with retries is not clean', () => {
      gate.record(AGENT, 'success', { retryCount: 1 });
      expect(gate.snapshot(AGENT).efficiency).toBe(0);
    });

    it('a failure is never clean', () => {
      gate.record(AGENT, 'failure');
      expect(gate.snapshot(AGENT).efficiency).toBe(0);
    });

    it('stopped counts as failure for success rate but not as clean', () => {
      gate.record(AGENT, 'stopped');
      const snap = gate.snapshot(AGENT);
      expect(snap.stability).toBe(0);
      expect(snap.efficiency).toBe(0);
    });
  });

  // ── thresholds() ──────────────────────────────────────────────────────────

  describe('thresholds()', () => {
    it('exposes configured thresholds', () => {
      const t = gate.thresholds();
      expect(t.degradedStability).toBe(0.70);
      expect(t.pausedStability).toBe(0.50);
      expect(t.consecutiveFailureLimit).toBe(3);
      expect(t.recoveryWindowMs).toBe(5_000);
      expect(t.windowSize).toBe(5);
    });
  });
});
