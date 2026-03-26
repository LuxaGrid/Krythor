import type { GuardContext, OperationType } from './types.js';

// ─── ActionNormalizer ─────────────────────────────────────────────────────────
//
// Maps raw call-site information (type, actor, target, metadata) to a
// structured NormalizedAction and the GuardContext shape expected by
// GuardEngine.check().
//
// Design goals:
// - Zero inference: all fields are mapped explicitly, nothing is guessed
// - Additive: this does not change GuardContext; it produces one from raw inputs
// - Safe: unknown operation types produce a 'command:execute' fallback (most
//   restrictive applicable default) rather than silently allowing
//

// ── Types ─────────────────────────────────────────────────────────────────────

/** Structured representation of an action before policy evaluation. */
export interface NormalizedAction {
  /** Resolved OperationType for the guard system */
  operation: OperationType;
  /** Caller identity: 'user' | 'agent' | 'skill' | 'system' */
  source: string;
  /** Caller's ID (agent id, skill id, etc.) — optional */
  sourceId?: string;
  /** Memory scope if applicable */
  scope?: string;
  /** Target resource: file path, URL, agent name, etc. */
  target?: string;
  /** Content or payload being processed — used for contentPattern matching */
  content?: string;
  /** Arbitrary extra metadata passed through to GuardContext.metadata */
  metadata?: Record<string, unknown>;
  /** Human-readable summary for audit / approval UI */
  summary: string;
}

/** Inputs accepted by normalizeAction() */
export interface ActionInput {
  /** Raw operation identifier — should be an OperationType but may be unknown */
  type: string;
  /** Who is performing the action: 'user' | 'agent' | 'skill' | 'system' */
  actor: string;
  /** Optional identifier for the actor (e.g. agent ID) */
  actorId?: string;
  /** Target resource (file path, URL, model name, scope name…) */
  target?: string;
  /** Content being processed */
  content?: string;
  /** Extra metadata */
  metadata?: Record<string, unknown>;
}

// ── Supported OperationTypes (mirrors types.ts; duplicated to avoid coupling) ──

const KNOWN_OPERATIONS = new Set<string>([
  'memory:write', 'memory:delete', 'memory:read', 'memory:export',
  'model:infer',
  'agent:run', 'agent:create', 'agent:delete',
  'command:execute',
  'provider:add', 'provider:delete',
  'skill:execute', 'skill:create', 'skill:delete',
  'network:fetch', 'network:search',
  'webhook:call',
]);

// ── Scope extraction ──────────────────────────────────────────────────────────
// Memory operations may encode the scope in the target or metadata.

const MEMORY_SCOPES = new Set(['session', 'agent', 'workspace', 'skill', 'user']);

function extractScope(input: ActionInput): string | undefined {
  if (input.metadata?.['scope'] && typeof input.metadata['scope'] === 'string') {
    return input.metadata['scope'];
  }
  // If target looks like a scope name itself (e.g. 'user', 'session')
  if (input.target && MEMORY_SCOPES.has(input.target)) {
    return input.target;
  }
  return undefined;
}

// ── Summary builder ───────────────────────────────────────────────────────────

function buildSummary(input: ActionInput, resolvedOp: OperationType): string {
  const actor = input.actorId ? `${input.actor}(${input.actorId})` : input.actor;
  const parts = [actor, resolvedOp];
  if (input.target) parts.push(`→ ${input.target}`);
  return parts.join(' ');
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Normalizes raw action inputs into a NormalizedAction.
 *
 * @param type     The operation type string (e.g. 'memory:write', 'network:fetch')
 * @param actor    Source identity ('user' | 'agent' | 'skill' | 'system')
 * @param target   Target resource (file path, URL, scope, model name…)
 * @param metadata Extra metadata; may include 'scope', 'content', 'actorId'
 */
export function normalizeAction(
  type: string,
  actor: string,
  target?: string,
  metadata?: Record<string, unknown>,
): NormalizedAction {
  // Resolve operation — unknown types fall back to 'command:execute' (most restrictive)
  const resolvedOp: OperationType = KNOWN_OPERATIONS.has(type)
    ? (type as OperationType)
    : 'command:execute';

  if (!KNOWN_OPERATIONS.has(type)) {
    process.stderr.write(
      `[guard/ActionNormalizer] Unknown operation type "${type}" — defaulting to command:execute\n`,
    );
  }

  const input: ActionInput = {
    type,
    actor,
    actorId: metadata?.['actorId'] !== undefined ? String(metadata['actorId']) : undefined,
    target,
    content: metadata?.['content'] !== undefined ? String(metadata['content']) : undefined,
    metadata,
  };

  const scope = resolvedOp.startsWith('memory:') ? extractScope(input) : undefined;

  return {
    operation: resolvedOp,
    source: actor,
    sourceId: input.actorId,
    scope,
    target,
    content: input.content,
    metadata,
    summary: buildSummary(input, resolvedOp),
  };
}

/**
 * Converts a NormalizedAction to a GuardContext ready for GuardEngine.check().
 */
export function toGuardContext(action: NormalizedAction): GuardContext {
  return {
    operation: action.operation,
    source: action.source,
    ...(action.sourceId !== undefined ? { sourceId: action.sourceId } : {}),
    ...(action.scope !== undefined ? { scope: action.scope } : {}),
    ...(action.content !== undefined ? { content: action.content } : {}),
    ...(action.metadata !== undefined ? { metadata: action.metadata } : {}),
  };
}
