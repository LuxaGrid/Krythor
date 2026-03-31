// ─── SkillComposer ────────────────────────────────────────────────────────────
//
// Chains skills sequentially.
//
// Each step receives the output of the previous step as its input.
// Steps are guarded individually; any step failure stops the chain.
//

import type { SkillRegistry } from './SkillRegistry.js';
import type { SkillRunner } from './SkillRunner.js';

export interface SkillChainStep {
  skillId: string;
  /** If set, use this as the input for this step instead of the previous step's output. */
  inputOverride?: string;
  /**
   * Optional informational hint for callers describing how to extract a sub-field
   * from the previous step's output (e.g. ".result"). Not evaluated by the engine.
   */
  inputTransform?: string;
}

export interface SkillChainResult {
  steps: Array<{
    skillId: string;
    skillName: string;
    input: string;
    output: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }>;
  finalOutput: string;
  totalDurationMs: number;
  success: boolean;
  failedAtStep?: number;
}

export class SkillComposer {
  constructor(
    private readonly runner: SkillRunner,
    private readonly registry: SkillRegistry,
  ) {}

  async compose(
    steps: SkillChainStep[],
    initialInput: string,
    options?: { timeoutMs?: number },
  ): Promise<SkillChainResult> {
    const chainStart = Date.now();
    const stepResults: SkillChainResult['steps'] = [];

    // Set up optional overall timeout
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const abortController = new AbortController();
    if (options?.timeoutMs) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, options.timeoutMs);
    }

    let currentInput = initialInput;

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) break;

        // Validate the skill exists and is chainable (if chainable is set)
        const skill = this.registry.getById(step.skillId);
        const skillName = skill?.name ?? step.skillId;

        // Use inputOverride if provided, otherwise carry forward previous output
        const stepInput = step.inputOverride ?? currentInput;

        const stepStart = Date.now();
        try {
          if (timedOut) {
            throw new Error('Chain timed out');
          }

          const result = await this.runner.run({
            skillId: step.skillId,
            input: stepInput,
            abortSignal: abortController.signal,
          });

          const stepDuration = Date.now() - stepStart;
          stepResults.push({
            skillId:    step.skillId,
            skillName:  result.skillName,
            input:      stepInput,
            output:     result.output,
            durationMs: stepDuration,
            success:    true,
          });

          currentInput = result.output;
        } catch (err) {
          const stepDuration = Date.now() - stepStart;
          const message = err instanceof Error ? err.message : String(err);
          stepResults.push({
            skillId:    step.skillId,
            skillName,
            input:      stepInput,
            output:     '',
            durationMs: stepDuration,
            success:    false,
            error:      message,
          });

          return {
            steps:            stepResults,
            finalOutput:      '',
            totalDurationMs:  Date.now() - chainStart,
            success:          false,
            failedAtStep:     i,
          };
        }
      }
    } finally {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    }

    return {
      steps:           stepResults,
      finalOutput:     currentInput,
      totalDurationMs: Date.now() - chainStart,
      success:         true,
    };
  }
}
