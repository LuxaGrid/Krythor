// ─── TrustPill ────────────────────────────────────────────────────────────────
//
// Compact inline trust badge for table rows, activity feeds, and log entries
// where an action type and optional target are already available.
//
// Usage:
//   <TrustPill actionType="file:delete" />
//   <TrustPill actionType={event.actionType} target={event.target} />
//

import { TrustIndicator, inferTrustLevel } from './TrustIndicator.tsx';
import type { ReactNode } from 'react';

interface TrustPillProps {
  actionType: string;
  target?: string;
  /** Show full badge instead of compact dot. Default: compact. */
  full?: boolean;
  className?: string;
}

export function TrustPill({ actionType, target, full = false, className }: TrustPillProps): ReactNode {
  const level = inferTrustLevel(actionType, target);
  return (
    <TrustIndicator
      level={level}
      compact={!full}
      explanation={`${level === 'high-risk' ? 'High-risk' : level === 'approval' ? 'Requires approval' : 'Safe'}: ${actionType}${target ? ` → ${target}` : ''}`}
      className={className}
    />
  );
}
