// ─── TrustIndicator ───────────────────────────────────────────────────────────
//
// Reusable trust-level component used across approvals, SafeCore, audit rows,
// and any surface where action risk needs to be communicated clearly.
//
// Usage:
//   <TrustIndicator level="high-risk" />
//   <TrustIndicator level={inferTrustLevel('file:delete')} label="File Delete" compact />
//

import type { ReactNode } from 'react';

// ── Trust level type ──────────────────────────────────────────────────────────

export type TrustLevel = 'safe' | 'approval' | 'high-risk';

// ── Trust level inference ─────────────────────────────────────────────────────

const HIGH_RISK_TERMS = [
  'delete', 'remove', 'shell', 'execute', 'exec', 'command', 'terminal',
  'powershell', 'cmd', 'bash', 'registry', 'system32', 'windows',
  'elevated', 'safecore:elevate', 'safecore:promote',
];

const APPROVAL_TERMS = [
  'write', 'modify', 'move', 'rename', 'network', 'upload', 'download',
  'webhook', 'send', 'post', 'patch', 'put', 'create', 'update',
  'deploy', 'publish', 'safecore:execute',
];

/**
 * Infer a TrustLevel from an action type string and optional target.
 * Matches are case-insensitive prefix/substring checks.
 */
export function inferTrustLevel(actionType: string, target?: string): TrustLevel {
  const haystack = `${actionType} ${target ?? ''}`.toLowerCase();

  for (const term of HIGH_RISK_TERMS) {
    if (haystack.includes(term)) return 'high-risk';
  }
  for (const term of APPROVAL_TERMS) {
    if (haystack.includes(term)) return 'approval';
  }
  return 'safe';
}

// ── Visual config ─────────────────────────────────────────────────────────────

interface LevelConfig {
  dot: string;        // Tailwind dot color
  label: string;      // Default text label
  badge: string;      // Badge background + border + text classes
  pulse: boolean;     // Pulse animation for non-safe states
}

const LEVEL_CONFIG: Record<TrustLevel, LevelConfig> = {
  'safe': {
    dot:   'bg-emerald-500',
    label: 'Safe',
    badge: 'bg-emerald-950/60 border-emerald-800/50 text-emerald-300',
    pulse: false,
  },
  'approval': {
    dot:   'bg-amber-400',
    label: 'Needs Approval',
    badge: 'bg-amber-950/60 border-amber-800/50 text-amber-300',
    pulse: true,
  },
  'high-risk': {
    dot:   'bg-red-500',
    label: 'High Risk',
    badge: 'bg-red-950/60 border-red-800/50 text-red-300',
    pulse: true,
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface TrustIndicatorProps {
  level: TrustLevel;
  /** Override the default label text. */
  label?: string;
  /** Tooltip / title text shown on hover. */
  explanation?: string;
  /** Compact single-dot mode for dense rows — no text, dot only. */
  compact?: boolean;
  /** Suppress pulse animation even for non-safe states. */
  noPulse?: boolean;
  className?: string;
}

export function TrustIndicator({
  level,
  label,
  explanation,
  compact = false,
  noPulse = false,
  className = '',
}: TrustIndicatorProps): ReactNode {
  const cfg = LEVEL_CONFIG[level];
  const displayLabel = label ?? cfg.label;
  const shouldPulse = cfg.pulse && !noPulse;

  if (compact) {
    return (
      <span
        title={explanation ?? displayLabel}
        className={`inline-flex items-center justify-center ${className}`}
      >
        <span
          className={`inline-block w-2 h-2 rounded-full ${cfg.dot} ${shouldPulse ? 'animate-pulse' : ''}`}
        />
      </span>
    );
  }

  return (
    <span
      title={explanation}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${cfg.badge} ${className}`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot} ${shouldPulse ? 'animate-pulse' : ''}`}
      />
      {displayLabel}
    </span>
  );
}
