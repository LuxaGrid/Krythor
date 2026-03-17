// ─── Guard Types ──────────────────────────────────────────────────────────────

export type GuardAction = 'allow' | 'deny' | 'warn' | 'require-approval';

export type OperationType =
  | 'memory:write'
  | 'memory:delete'
  | 'memory:read'
  | 'model:infer'
  | 'agent:run'
  | 'agent:create'
  | 'agent:delete'
  | 'command:execute'
  | 'provider:add'
  | 'provider:delete'
  | 'skill:execute'
  | 'skill:create'
  | 'skill:delete';

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
};

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};
