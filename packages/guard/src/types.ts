// ─── Guard Types ──────────────────────────────────────────────────────────────

export type GuardAction = 'allow' | 'deny' | 'warn' | 'require-approval';

export type OperationType =
  | 'memory:write'
  | 'memory:delete'
  | 'memory:read'
  | 'memory:export'
  | 'model:infer'
  | 'agent:run'
  | 'agent:create'
  | 'agent:delete'
  | 'command:execute'
  | 'provider:add'
  | 'provider:delete'
  | 'skill:execute'
  | 'skill:create'
  | 'skill:delete'
  | 'network:fetch'
  | 'network:search'
  | 'webhook:call'
  | 'config:write'
  | 'config:read'
  | 'conversation:read'
  | 'conversation:write'
  | 'file:read'
  | 'file:write'
  | 'file:delete'
  | 'file:move'
  | 'file:copy'
  | 'file:list'
  | 'shell:exec'
  | 'shell:list_processes'
  | 'shell:kill'
  | 'skill:permission:memory:write'
  | 'skill:permission:memory:read'
  | 'skill:permission:skill:invoke'
  | 'skill:permission:internet:read';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ─── Guard Context ────────────────────────────────────────────────────────────
// Describes an operation being evaluated.

export interface GuardContext {
  operation: OperationType;
  source: string;            // 'user' | 'agent' | 'skill' | 'system'
  sourceId?: string;         // agent id, skill id, etc.
  scope?: string;            // memory scope if applicable
  content?: string;          // payload / prompt / content being processed
  metadata?: Record<string, unknown>;
}

// ─── Policy Rule ──────────────────────────────────────────────────────────────

export interface PolicyCondition {
  operations?: OperationType[];   // match these operation types (omit = all)
  sources?: string[];             // match these sources
  scopes?: string[];              // match these scopes
  minRisk?: RiskLevel;            // match >= this risk level
  contentPattern?: string;        // regex pattern matched against content
  /**
   * UTC hour range (inclusive) to match. Both values are 0–23.
   * Example: { from: 9, to: 17 } matches 09:00–17:59 UTC.
   * Wraps midnight when from > to (e.g. { from: 22, to: 6 } matches 22:00–06:59 UTC).
   */
  allowedHours?: { from: number; to: number };
  /**
   * Days of week to match (0 = Sunday, 6 = Saturday, UTC).
   * Example: [1, 2, 3, 4, 5] for weekdays only.
   */
  allowedDays?: number[];
}

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;               // lower = evaluated first
  condition: PolicyCondition;
  action: GuardAction;
  reason: string;                 // message returned with the verdict
}

// ─── Guard Verdict ────────────────────────────────────────────────────────────

export interface GuardVerdict {
  allowed: boolean;
  action: GuardAction;
  ruleId?: string;
  ruleName?: string;
  reason: string;
  warnings: string[];             // non-blocking warnings from warn rules
}

// ─── Policy Config ────────────────────────────────────────────────────────────

export interface PolicyConfig {
  version: string;
  defaultAction: 'allow' | 'deny';
  rules: PolicyRule[];
}

// ─── Risk mapping (mirrors SCOPE_RISK from memory) ────────────────────────────

export const SCOPE_TO_RISK: Record<string, RiskLevel> = {
  session:   'low',
  agent:     'medium',
  workspace: 'medium',
  skill:     'medium',
  user:      'high',
};

export const OPERATION_RISK: Record<OperationType, RiskLevel> = {
  'memory:read':      'low',
  'memory:write':     'medium',
  'memory:delete':    'high',
  'memory:export':    'high',
  'model:infer':      'low',
  'agent:run':        'medium',
  'agent:create':     'medium',
  'agent:delete':     'high',
  'command:execute':  'medium',
  'provider:add':     'high',
  'provider:delete':  'critical',
  'skill:execute':    'medium',
  'skill:create':     'medium',
  'skill:delete':     'high',
  'network:fetch':    'low',
  'network:search':   'low',
  'webhook:call':     'medium',
  'config:write':     'high',
  'config:read':      'low',
  'conversation:read':  'low',
  'conversation:write': 'medium',
  'file:read':        'low',
  'file:write':       'medium',
  'file:delete':      'high',
  'file:move':        'medium',
  'file:copy':        'low',
  'file:list':        'low',
  'shell:exec':       'critical',
  'shell:list_processes': 'low',
  'shell:kill':       'high',
  'skill:permission:memory:write':   'medium',
  'skill:permission:memory:read':    'low',
  'skill:permission:skill:invoke':   'medium',
  'skill:permission:internet:read':  'low',
};

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};
