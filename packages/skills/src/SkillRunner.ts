import type { Skill, SkillEvent, SkillPermission } from './types.js';

// ─── SkillRunner ──────────────────────────────────────────────────────────────
//
// Executes a skill against a model engine.
// The runner is intentionally model-engine agnostic — it accepts a thin
// InferFn callback so the skills package does not import @krythor/models.
// The gateway wires in `models.infer` at startup.
//
// A skill's systemPrompt is prepended as the system message.
// The caller's input is sent as the first user message.
//
// Permission enforcement:
//   Skills declare required permissions in their `permissions` array.
//   Before execution, an optional `checkPermission` callback is called for
//   each declared permission. If any check fails, the run is rejected.
//   This is scaffolding for future capability gating (e.g. skill-to-memory
//   access) — currently skills are pure model calls and no permissions are
//   automatically required at runtime.
//
// Concurrency:
//   MAX_CONCURRENT_PER_SKILL — max simultaneous runs of the same skill.
//   MAX_TOTAL_SKILL_RUNS     — max simultaneous runs across all skills.
//

/** Maximum user input length passed to the model. Longer inputs are truncated. */
const MAX_INPUT_LENGTH = 10_000;

/** Per-execution wall-clock timeout. Prevents a hung model call from blocking forever. */
const EXECUTION_TIMEOUT_MS = 120_000; // 2 minutes

/** Max simultaneous executions of the same skill. */
const MAX_CONCURRENT_PER_SKILL = 3;

/** Max simultaneous skill executions across all skills. */
const MAX_TOTAL_SKILL_RUNS = 20;

export class SkillConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillConcurrencyError';
  }
}

export class SkillPermissionError extends Error {
  constructor(readonly skillId: string, readonly permission: SkillPermission) {
    super(`Skill "${skillId}" requires permission "${permission}" which was denied`);
    this.name = 'SkillPermissionError';
  }
}

export class SkillTimeoutError extends Error {
  constructor(readonly skillId: string, readonly timeoutMs: number) {
    super(`Skill "${skillId}" exceeded execution timeout of ${timeoutMs}ms`);
    this.name = 'SkillTimeoutError';
  }
}

export interface SkillRunInput {
  skillId: string;
  input: string;
  abortSignal?: AbortSignal;
}

export interface SkillRunResult {
  skillId: string;
  skillName: string;
  output: string;
  durationMs: number;
  modelId?: string;
  providerId?: string;
}

// The infer function shape — matches ModelEngine.infer's signature
export type InferFn = (request: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  providerId?: string;
  temperature?: number;
  maxTokens?: number;
}, context?: { skillModelId?: string }, signal?: AbortSignal) => Promise<{
  content: string;
  model: string;
  providerId: string;
  durationMs: number;
}>;

export type SkillEventEmitter = (event: SkillEvent) => void;

/**
 * Called before a skill executes to verify it holds the required permission.
 * Return true to allow, false to deny.
 * The gateway wires in guard.check() here.
 */
export type PermissionChecker = (skill: Skill, permission: SkillPermission) => boolean;

export class SkillRunner {
  private readonly infer: InferFn;
  private readonly getSkill: (id: string) => Skill | null;
  private readonly emit: SkillEventEmitter;
  private readonly checkPermission: PermissionChecker;

  // Concurrency tracking
  private readonly perSkillCount = new Map<string, number>(); // skillId → active runs
  private totalActiveRuns = 0;

  constructor(
    infer: InferFn,
    getSkill: (id: string) => Skill | null,
    emit?: SkillEventEmitter,
    checkPermission?: PermissionChecker,
  ) {
    this.infer = infer;
    this.getSkill = getSkill;
    this.emit = emit ?? (() => { /* no-op */ });
    // Default: all permissions allowed (permissive until guard is wired)
    this.checkPermission = checkPermission ?? (() => true);
  }

  activeRunCount(): number { return this.totalActiveRuns; }

  async run(input: SkillRunInput): Promise<SkillRunResult> {
    const skill = this.getSkill(input.skillId);
    if (!skill) throw new Error(`Skill "${input.skillId}" not found`);
    if (skill.enabled === false) throw new Error(`Skill "${input.skillId}" is disabled`);

    // ── Permission check ──────────────────────────────────────────────────────
    // Verify each declared permission before execution. This is a pre-flight
    // check — it fires before any model call is made.
    for (const permission of skill.permissions) {
      if (!this.checkPermission(skill, permission)) {
        throw new SkillPermissionError(skill.id, permission);
      }
    }

    // ── Concurrency check ─────────────────────────────────────────────────────
    const skillCount = this.perSkillCount.get(skill.id) ?? 0;
    if (skillCount >= MAX_CONCURRENT_PER_SKILL) {
      throw new SkillConcurrencyError(
        `Skill "${skill.name}" already has ${MAX_CONCURRENT_PER_SKILL} concurrent runs. Wait for one to finish.`
      );
    }
    if (this.totalActiveRuns >= MAX_TOTAL_SKILL_RUNS) {
      throw new SkillConcurrencyError(
        `Too many concurrent skill runs (max ${MAX_TOTAL_SKILL_RUNS}). Wait for a run to finish.`
      );
    }

    // Acquire slot
    this.perSkillCount.set(skill.id, skillCount + 1);
    this.totalActiveRuns++;

    const start = Date.now();
    const truncatedInput = input.input.slice(0, MAX_INPUT_LENGTH);

    this.emit({ type: 'skill:run:started', skillId: skill.id, skillName: skill.name, timestamp: start });

    // Compose caller's AbortSignal with a per-execution timeout.
    // Per-skill timeoutMs overrides the runner default.
    const effectiveTimeout = skill.timeoutMs ?? EXECUTION_TIMEOUT_MS;
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new SkillTimeoutError(skill.id, effectiveTimeout));
    }, effectiveTimeout);

    // Propagate caller's abort into our controller
    const onCallerAbort = () => timeoutController.abort(input.abortSignal?.reason);
    if (input.abortSignal) {
      if (input.abortSignal.aborted) {
        clearTimeout(timeoutTimer);
        this.releaseSlot(skill.id);
        throw new Error('Skill run aborted before start');
      }
      input.abortSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (input.abortSignal) input.abortSignal.removeEventListener('abort', onCallerAbort);
    };

    try {
      const response = await this.infer(
        {
          messages: [
            { role: 'system', content: skill.systemPrompt },
            { role: 'user',   content: truncatedInput },
          ],
          model:      skill.modelId,
          providerId: skill.providerId,
        },
        skill.modelId ? { skillModelId: skill.modelId } : undefined,
        timeoutController.signal,
      );

      cleanup();
      const durationMs = Date.now() - start;

      this.emit({
        type: 'skill:run:completed',
        skillId: skill.id,
        skillName: skill.name,
        durationMs,
        modelId: response.model,
        timestamp: Date.now(),
      });

      return {
        skillId:    skill.id,
        skillName:  skill.name,
        output:     response.content,
        durationMs,
        modelId:    response.model,
        providerId: response.providerId,
      };
    } catch (err) {
      cleanup();
      // If our timer fired, surface a typed SkillTimeoutError regardless of what the
      // model client threw (it may throw a generic AbortError or DOMException).
      const thrownErr = timedOut ? new SkillTimeoutError(skill.id, effectiveTimeout) : err;
      const message = thrownErr instanceof Error ? thrownErr.message : 'Unknown error';
      this.emit({
        type: 'skill:run:failed',
        skillId: skill.id,
        skillName: skill.name,
        error: message,
        timestamp: Date.now(),
      });
      throw thrownErr;
    } finally {
      this.releaseSlot(skill.id);
    }
  }

  private releaseSlot(skillId: string): void {
    const count = this.perSkillCount.get(skillId) ?? 1;
    if (count <= 1) {
      this.perSkillCount.delete(skillId);
    } else {
      this.perSkillCount.set(skillId, count - 1);
    }
    this.totalActiveRuns = Math.max(0, this.totalActiveRuns - 1);
  }
}
