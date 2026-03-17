import type { Skill, SkillEvent } from './types.js';

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

/** Maximum user input length passed to the model. Longer inputs are truncated. */
const MAX_INPUT_LENGTH = 10_000;

/** Per-execution wall-clock timeout. Prevents a hung model call from blocking forever. */
const EXECUTION_TIMEOUT_MS = 120_000; // 2 minutes

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

export class SkillRunner {
  private readonly infer: InferFn;
  private readonly getSkill: (id: string) => Skill | null;
  private readonly emit: SkillEventEmitter;

  constructor(infer: InferFn, getSkill: (id: string) => Skill | null, emit?: SkillEventEmitter) {
    this.infer = infer;
    this.getSkill = getSkill;
    this.emit = emit ?? (() => { /* no-op */ });
  }

  async run(input: SkillRunInput): Promise<SkillRunResult> {
    const skill = this.getSkill(input.skillId);
    if (!skill) throw new Error(`Skill "${input.skillId}" not found`);

    const start = Date.now();
    const truncatedInput = input.input.slice(0, MAX_INPUT_LENGTH);

    this.emit({ type: 'skill:run:started', skillId: skill.id, skillName: skill.name, timestamp: start });

    // Compose caller's AbortSignal with a per-execution timeout.
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => {
      timeoutController.abort(new Error(`Skill execution timeout after ${EXECUTION_TIMEOUT_MS}ms`));
    }, EXECUTION_TIMEOUT_MS);

    // Propagate caller's abort into our controller
    const onCallerAbort = () => timeoutController.abort(input.abortSignal?.reason);
    if (input.abortSignal) {
      if (input.abortSignal.aborted) {
        clearTimeout(timeoutTimer);
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
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.emit({
        type: 'skill:run:failed',
        skillId: skill.id,
        skillName: skill.name,
        error: message,
        timestamp: Date.now(),
      });
      throw err;
    }
  }
}
