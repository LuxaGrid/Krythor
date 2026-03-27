// ─── Skill types ──────────────────────────────────────────────────────────────

/**
 * Permission tokens that scope what a skill is allowed to do.
 * Currently informational — used by the guard layer to restrict operations.
 * Future: enforced by SkillRunner via a capability sandbox.
 */
export type SkillPermission =
  | 'memory:read'
  | 'memory:write'
  | 'skill:invoke'    // allowed to invoke other skills (chaining)
  | 'internet:read';  // future: allowed to make outbound HTTP requests

/**
 * Task metadata for the model recommendation engine.
 * Optional — skills that omit these fields get general-purpose routing.
 */
export interface SkillTaskProfile {
  /** Task types this skill handles. Matches TaskClassifier output. */
  taskCategories?:      string[];
  /** Cost preference: 'local_preferred' | 'cost_aware' | 'quality_first' */
  costTier?:            'local_preferred' | 'cost_aware' | 'quality_first';
  /** Speed priority: 'fast' | 'normal' | 'thorough' */
  speedTier?:           'fast' | 'normal' | 'thorough';
  /** True if vision capability is required */
  requiresVision?:      boolean;
  /** True if local model execution is acceptable */
  localOk?:             boolean;
  /** Minimum reasoning depth: 'shallow' | 'medium' | 'deep' */
  reasoningDepth?:      'shallow' | 'medium' | 'deep';
  /** True if this skill handles sensitive content requiring extra care */
  privacySensitive?:    boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tags: string[];
  permissions: SkillPermission[];  // declared capabilities; empty = no special access
  modelId?: string;       // override model for this skill
  providerId?: string;    // override provider for this skill
  timeoutMs?: number;     // per-skill execution timeout; overrides runner default (120 s)
  taskProfile?: SkillTaskProfile;  // metadata for recommendation engine
  /**
   * When false the skill is disabled: it cannot be run and is excluded from listings
   * (unless ?includeDisabled=true). Defaults to true (enabled).
   */
  enabled: boolean;
  /**
   * When false the skill is excluded from the model's system prompt context.
   * It can still be invoked directly via the API. Defaults to true.
   */
  userInvocable: boolean;
  version: number;        // increments on every update (starts at 1)
  runCount: number;       // total number of times this skill has been executed
  lastRunAt?: number;     // Unix ms of last execution
  createdAt: number;      // Unix ms
  updatedAt: number;      // Unix ms
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  systemPrompt: string;
  tags?: string[];
  permissions?: SkillPermission[];
  modelId?: string;
  providerId?: string;
  timeoutMs?: number;
  taskProfile?: SkillTaskProfile;
  enabled?: boolean;
  userInvocable?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  tags?: string[];
  permissions?: SkillPermission[];
  modelId?: string;
  providerId?: string;
  timeoutMs?: number;
  taskProfile?: SkillTaskProfile;
  enabled?: boolean;
  userInvocable?: boolean;
}

// ─── Skill lifecycle events ───────────────────────────────────────────────────

export type SkillEvent =
  | { type: 'skill:run:started';   skillId: string; skillName: string; timestamp: number }
  | { type: 'skill:run:completed'; skillId: string; skillName: string; durationMs: number; modelId?: string; timestamp: number }
  | { type: 'skill:run:failed';    skillId: string; skillName: string; error: string; timestamp: number };
