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

export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tags: string[];
  permissions: SkillPermission[];  // declared capabilities; empty = no special access
  modelId?: string;       // override model for this skill
  providerId?: string;    // override provider for this skill
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
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  tags?: string[];
  permissions?: SkillPermission[];
  modelId?: string;
  providerId?: string;
}

// ─── Skill lifecycle events ───────────────────────────────────────────────────

export type SkillEvent =
  | { type: 'skill:run:started';   skillId: string; skillName: string; timestamp: number }
  | { type: 'skill:run:completed'; skillId: string; skillName: string; durationMs: number; modelId?: string; timestamp: number }
  | { type: 'skill:run:failed';    skillId: string; skillName: string; error: string; timestamp: number };
