/**
 * AgentHealthGate — adaptive per-agent health tracking and auto-pause.
 *
 * Inspired by acclaw's Adaptive Cyclical Control Engine pattern.
 * Tracks a rolling window of run outcomes per agent and transitions
 * the agent through three health phases:
 *
 *   healthy  → all metrics within thresholds
 *   degraded → stability or efficiency falling; warning issued
 *   paused   → thresholds breached; runs blocked until recovery window elapses
 *
 * Metrics tracked per run:
 *   stability  = success rate over the rolling window (0–1)
 *   efficiency = fraction of runs that completed without fallback or retries (0–1)
 *
 * Recovery: a paused agent automatically returns to healthy after
 * RECOVERY_WINDOW_MS of wall-clock time, giving the underlying provider time
 * to recover before runs resume.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentPhase = 'healthy' | 'degraded' | 'paused';

export interface AgentHealthSnapshot {
  agentId:      string;
  phase:        AgentPhase;
  stability:    number;   // 0–1 rolling success rate
  efficiency:   number;   // 0–1 fraction of clean runs (no fallback, no retries)
  windowSize:   number;   // number of runs in the rolling window
  pausedUntil:  number | null;  // epoch ms when auto-recovery fires, or null
  totalRuns:    number;
  consecutiveFailures: number;
}

export interface AgentHealthConfig {
  /** Rolling window size. Default: 10 */
  windowSize?: number;
  /** Stability below this → degraded. Default: 0.70 */
  degradedStabilityThreshold?: number;
  /** Stability below this → paused. Default: 0.50 */
  pausedStabilityThreshold?: number;
  /** Efficiency below this → degraded. Default: 0.60 */
  degradedEfficiencyThreshold?: number;
  /** Efficiency below this → paused. Default: 0.40 */
  pausedEfficiencyThreshold?: number;
  /** Consecutive failures before pausing immediately. Default: 5 */
  consecutiveFailureLimit?: number;
  /** How long a paused agent waits before auto-recovery (ms). Default: 2 minutes */
  recoveryWindowMs?: number;
}

interface RunRecord {
  success:    boolean;  // completed
  clean:      boolean;  // no fallback, retryCount === 0
  ts:         number;   // epoch ms
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class AgentPausedError extends Error {
  readonly agentId:     string;
  readonly pausedUntil: number;
  readonly snapshot:    AgentHealthSnapshot;

  constructor(agentId: string, pausedUntil: number, snapshot: AgentHealthSnapshot) {
    const resumeIn = Math.ceil((pausedUntil - Date.now()) / 1000);
    super(
      `Agent "${agentId}" is paused due to repeated failures. ` +
      `Auto-recovery in ${resumeIn}s. ` +
      `Stability: ${(snapshot.stability * 100).toFixed(0)}%, ` +
      `Efficiency: ${(snapshot.efficiency * 100).toFixed(0)}%.`
    );
    this.agentId     = agentId;
    this.pausedUntil = pausedUntil;
    this.snapshot    = snapshot;
    this.name        = 'AgentPausedError';
  }
}

// ─── AgentHealthGate ──────────────────────────────────────────────────────────

export class AgentHealthGate {
  private readonly windowSize:                  number;
  private readonly degradedStabilityThreshold:  number;
  private readonly pausedStabilityThreshold:    number;
  private readonly degradedEfficiencyThreshold: number;
  private readonly pausedEfficiencyThreshold:   number;
  private readonly consecutiveFailureLimit:     number;
  private readonly recoveryWindowMs:            number;

  // Per-agent state
  private readonly history:             Map<string, RunRecord[]>  = new Map();
  private readonly consecutiveFailures: Map<string, number>       = new Map();
  private readonly totalRuns:           Map<string, number>       = new Map();
  private readonly pausedUntil:         Map<string, number>       = new Map();

  constructor(config: AgentHealthConfig = {}) {
    this.windowSize                  = config.windowSize                  ?? 10;
    this.degradedStabilityThreshold  = config.degradedStabilityThreshold  ?? 0.70;
    this.pausedStabilityThreshold    = config.pausedStabilityThreshold    ?? 0.50;
    this.degradedEfficiencyThreshold = config.degradedEfficiencyThreshold ?? 0.60;
    this.pausedEfficiencyThreshold   = config.pausedEfficiencyThreshold   ?? 0.40;
    this.consecutiveFailureLimit     = config.consecutiveFailureLimit     ?? 5;
    this.recoveryWindowMs            = config.recoveryWindowMs            ?? 2 * 60 * 1000;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Check if an agent is allowed to run.
   * Throws AgentPausedError if the agent is in the paused phase.
   * Call this before starting a run (alongside rate-limit checks).
   */
  check(agentId: string): void {
    const paused = this.pausedUntil.get(agentId);
    if (paused !== undefined) {
      if (Date.now() < paused) {
        const snap = this.snapshot(agentId);
        throw new AgentPausedError(agentId, paused, snap);
      }
      // Auto-recovery: window has elapsed — clear the pause
      this.pausedUntil.delete(agentId);
      this.consecutiveFailures.set(agentId, 0);
    }
  }

  /**
   * Record the outcome of a completed run.
   * Call this after every run (success, failure, or stopped).
   */
  record(agentId: string, outcome: 'success' | 'failure' | 'stopped', opts: {
    fallbackOccurred?: boolean;
    retryCount?: number;
  } = {}): void {
    const success = outcome === 'success';
    const clean   = success && !opts.fallbackOccurred && (opts.retryCount ?? 0) === 0;

    // Update rolling window
    let window = this.history.get(agentId);
    if (!window) { window = []; this.history.set(agentId, window); }
    window.push({ success, clean, ts: Date.now() });
    if (window.length > this.windowSize) window.shift();

    // Update total run count
    this.totalRuns.set(agentId, (this.totalRuns.get(agentId) ?? 0) + 1);

    // Update consecutive failure counter
    const prev = this.consecutiveFailures.get(agentId) ?? 0;
    const consec = success ? 0 : prev + 1;
    this.consecutiveFailures.set(agentId, consec);

    // Evaluate whether to pause
    const snap = this.snapshot(agentId);
    if (
      snap.phase !== 'paused' &&
      (consec >= this.consecutiveFailureLimit ||
       snap.stability  < this.pausedStabilityThreshold ||
       snap.efficiency < this.pausedEfficiencyThreshold)
    ) {
      this.pausedUntil.set(agentId, Date.now() + this.recoveryWindowMs);
    }
  }

  /**
   * Return a health snapshot for an agent (used by API and UI).
   * Safe to call for agents with no recorded runs.
   */
  snapshot(agentId: string): AgentHealthSnapshot {
    const window   = this.history.get(agentId) ?? [];
    const consec   = this.consecutiveFailures.get(agentId) ?? 0;
    const total    = this.totalRuns.get(agentId) ?? 0;
    const paused   = this.pausedUntil.get(agentId) ?? null;

    const stability  = window.length === 0 ? 1 : window.filter(r => r.success).length / window.length;
    const efficiency = window.length === 0 ? 1 : window.filter(r => r.clean).length   / window.length;

    let phase: AgentPhase = 'healthy';
    if (paused !== null && Date.now() < paused) {
      phase = 'paused';
    } else if (
      stability  < this.degradedStabilityThreshold ||
      efficiency < this.degradedEfficiencyThreshold
    ) {
      phase = 'degraded';
    }

    return {
      agentId,
      phase,
      stability,
      efficiency,
      windowSize:          window.length,
      pausedUntil:         phase === 'paused' ? paused : null,
      totalRuns:           total,
      consecutiveFailures: consec,
    };
  }

  /**
   * Return snapshots for all agents that have at least one recorded run.
   */
  allSnapshots(): AgentHealthSnapshot[] {
    const ids = new Set([
      ...this.history.keys(),
      ...this.pausedUntil.keys(),
    ]);
    return [...ids].map(id => this.snapshot(id));
  }

  /**
   * Manually unpause an agent (operator override).
   */
  unpause(agentId: string): void {
    this.pausedUntil.delete(agentId);
    this.consecutiveFailures.set(agentId, 0);
  }

  /**
   * Reset all state for an agent (e.g. after agent config change).
   */
  reset(agentId: string): void {
    this.history.delete(agentId);
    this.consecutiveFailures.delete(agentId);
    this.totalRuns.delete(agentId);
    this.pausedUntil.delete(agentId);
  }

  /** Thresholds exposed for UI display */
  thresholds() {
    return {
      degradedStability:  this.degradedStabilityThreshold,
      pausedStability:    this.pausedStabilityThreshold,
      degradedEfficiency: this.degradedEfficiencyThreshold,
      pausedEfficiency:   this.pausedEfficiencyThreshold,
      consecutiveFailureLimit: this.consecutiveFailureLimit,
      recoveryWindowMs:   this.recoveryWindowMs,
      windowSize:         this.windowSize,
    };
  }
}
