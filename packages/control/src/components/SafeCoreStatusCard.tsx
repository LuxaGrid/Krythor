// ─── SafeCoreStatusCard ───────────────────────────────────────────────────────
//
// Reusable status card for Krythor SafeCore — shows trust level, evaluation
// state, scope summary, and runtime context.
//
// Usage (standalone, no required props):
//   <SafeCoreStatusCard />
//
// Usage (with live data):
//   <SafeCoreStatusCard
//     evaluationState="complete"
//     trustLevel="safe"
//     scopeSummary="Workspace only · No network"
//     isLocalOnly
//   />
//

import type { ReactNode } from 'react';
import { TrustIndicator } from './TrustIndicator.tsx';
import type { TrustLevel } from './TrustIndicator.tsx';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EvaluationState = 'complete' | 'pending' | 'error';

interface SafeCoreStatusCardProps {
  /** Trust level to display. Defaults to 'safe'. */
  trustLevel?: TrustLevel;
  /** Evaluation state of the current or most recent run. Defaults to 'complete'. */
  evaluationState?: EvaluationState;
  /** Short human-readable scope summary, e.g. "Workspace only · No network". */
  scopeSummary?: string;
  /** True when all inference runs locally with no external services. */
  isLocalOnly?: boolean;
  /** Optional "Why this model?" explanation text. */
  modelReason?: string;
  /** Optional short description line below the brand. */
  description?: string;
  className?: string;
}

// ── Evaluation state config ───────────────────────────────────────────────────

const EVAL_CONFIG: Record<EvaluationState, { label: string; cls: string; dot: string }> = {
  complete: {
    label: 'Evaluation complete',
    cls:   'text-emerald-300',
    dot:   'bg-emerald-500',
  },
  pending: {
    label: 'Evaluating…',
    cls:   'text-amber-300',
    dot:   'bg-amber-400 animate-pulse',
  },
  error: {
    label: 'Evaluation error',
    cls:   'text-red-300',
    dot:   'bg-red-500',
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function SafeCoreStatusCard({
  trustLevel = 'safe',
  evaluationState = 'complete',
  scopeSummary,
  isLocalOnly = true,
  modelReason,
  description,
  className = '',
}: SafeCoreStatusCardProps): ReactNode {
  const evalCfg = EVAL_CONFIG[evaluationState];

  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden ${className}`}
    >
      {/* Header band */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-widest text-zinc-400 uppercase">
              Krythor SafeCore™
            </span>
            <TrustIndicator level={trustLevel} compact />
          </div>
          <p className="text-[11px] text-zinc-600 mt-0.5 truncate">
            {description ?? 'Every action is evaluated before it runs.'}
          </p>
        </div>
        <TrustIndicator level={trustLevel} noPulse={evaluationState === 'complete'} />
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">

        {/* Evaluation state */}
        <div className="flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${evalCfg.dot}`} />
          <span className={`text-xs ${evalCfg.cls}`}>{evalCfg.label}</span>
        </div>

        {/* Scope summary */}
        {scopeSummary && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] text-zinc-600 w-20 shrink-0 mt-0.5">Scope</span>
            <span className="text-xs text-zinc-400">{scopeSummary}</span>
          </div>
        )}

        {/* Runtime summary */}
        <div className="flex items-start gap-2">
          <span className="text-[10px] text-zinc-600 w-20 shrink-0 mt-0.5">Runtime</span>
          <span className="text-xs text-zinc-400">
            {isLocalOnly
              ? 'Running locally — no external services involved'
              : 'External services in use — check scope above'}
          </span>
        </div>

        {/* Why this model */}
        {modelReason && (
          <div className="mt-1 px-3 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-lg">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Why this model?</p>
            <p className="text-xs text-zinc-400">{modelReason}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-zinc-800/60 bg-zinc-950/40">
        <p className="text-[10px] text-zinc-600 tracking-wide">
          Your Machine. Your Data. Your Rules.
        </p>
      </div>
    </div>
  );
}
