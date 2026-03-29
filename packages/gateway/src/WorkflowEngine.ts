/**
 * WorkflowEngine — named, persistent multi-agent pipelines.
 *
 * A Workflow is a sequence of Steps. Each step specifies:
 *   - agentId: which agent to run
 *   - inputMode: how to build this step's input
 *       'initial'     — use the original workflow input
 *       'previous'    — use the previous step's output
 *       'concat'      — previous output + "\n\n" + static template (if provided)
 *       'template'    — static string (optionally with {{input}} and {{previous}} tokens)
 *   - condition: optional regex; step is skipped if previous output does NOT match
 *   - stopOnFailure: if true, abort the whole workflow on step failure (default true)
 *   - parallel: optional group label; steps sharing the same label run concurrently.
 *       All parallel steps receive the same input (the preceding serial output).
 *       Their outputs are joined with "\n\n---\n\n" and become the next step's input.
 *
 * Workflows are persisted to JSON under configDir/workflows.json.
 *
 * Usage:
 *   const wf = new WorkflowEngine(configDir, orchestrator);
 *   const run = await wf.run('my-workflow-id', 'initial input');
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { AgentOrchestrator } from '@krythor/core';
import type { AgentRun } from '@krythor/core';

export type StepInputMode = 'initial' | 'previous' | 'concat' | 'template';

export interface WorkflowStep {
  /** Agent to invoke for this step. */
  agentId: string;
  /** How to derive this step's input. Default: 'previous' (first step: 'initial'). */
  inputMode?: StepInputMode;
  /** Static string used when inputMode === 'template'. May contain {{input}} and {{previous}}. */
  template?: string;
  /** Regex pattern: skip step if previous output does NOT match (undefined = always run). */
  condition?: string;
  /** Abort workflow if this step fails. Default: true. */
  stopOnFailure?: boolean;
  /**
   * Parallel group label. Steps sharing the same label run concurrently using
   * Promise.allSettled(). All receive the same input (the preceding step's output).
   * Their outputs are joined with "\n\n---\n\n" to form the next step's input.
   * Steps without a group label run sequentially (the default).
   */
  parallel?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepResult {
  stepIndex: number;
  agentId: string;
  skipped: boolean;
  run?: AgentRun;
  output?: string;
  error?: string;
  /** True when this step was part of a parallel group. */
  parallel?: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  workflowName: string;
  status: 'completed' | 'failed' | 'partial';
  steps: WorkflowStepResult[];
  finalOutput?: string;
  durationMs: number;
}

export class WorkflowEngine {
  private readonly filePath: string;
  private workflows: WorkflowDefinition[] = [];

  constructor(
    configDir: string,
    private readonly orchestrator: AgentOrchestrator,
  ) {
    this.filePath = join(configDir, 'workflows.json');
    this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      this.workflows = JSON.parse(readFileSync(this.filePath, 'utf8')) as WorkflowDefinition[];
    } catch {
      this.workflows = [];
    }
  }

  private save(): void {
    mkdirSync(join(this.filePath, '..'), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.workflows, null, 2), 'utf8');
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  get(id: string): WorkflowDefinition | null {
    return this.workflows.find(w => w.id === id) ?? null;
  }

  list(): WorkflowDefinition[] {
    return [...this.workflows];
  }

  upsert(data: Omit<WorkflowDefinition, 'createdAt' | 'updatedAt'>): WorkflowDefinition {
    const now = Date.now();
    const existing = this.workflows.find(w => w.id === data.id);
    if (existing) {
      Object.assign(existing, { ...data, updatedAt: now });
      this.save();
      return existing;
    }
    const wf: WorkflowDefinition = { ...data, createdAt: now, updatedAt: now };
    this.workflows.push(wf);
    this.save();
    return wf;
  }

  remove(id: string): void {
    this.workflows = this.workflows.filter(w => w.id !== id);
    this.save();
  }

  // ── Execution ─────────────────────────────────────────────────────────────────

  /** Build the input string for a single step given the current pipeline state. */
  private buildStepInput(
    step: WorkflowStep,
    stepIndex: number,
    initialInput: string,
    previousOutput: string,
  ): string {
    const mode = step.inputMode ?? (stepIndex === 0 ? 'initial' : 'previous');
    switch (mode) {
      case 'initial':
        return initialInput;
      case 'previous':
        return previousOutput;
      case 'concat':
        return step.template ? `${previousOutput}\n\n${step.template}` : previousOutput;
      case 'template':
        return (step.template ?? '{{previous}}')
          .replace('{{input}}', initialInput)
          .replace('{{previous}}', previousOutput);
      default:
        return previousOutput;
    }
  }

  async run(
    workflowId: string,
    initialInput: string,
    opts: {
      timeoutMs?: number;
      onStepStarted?:   (stepIndex: number, agentId: string, parallel?: string) => void;
      onStepCompleted?: (stepIndex: number, agentId: string, output: string, parallel?: string) => void;
      onStepFailed?:    (stepIndex: number, agentId: string, error: string, parallel?: string) => void;
      onStepSkipped?:   (stepIndex: number, agentId: string) => void;
    } = {},
  ): Promise<WorkflowRunResult> {
    const wf = this.get(workflowId);
    if (!wf) throw new Error(`Workflow "${workflowId}" not found`);

    const { timeoutMs, onStepStarted, onStepCompleted, onStepFailed, onStepSkipped } = opts;
    const start = Date.now();
    const deadline = timeoutMs ? start + timeoutMs : null;

    const stepResults: WorkflowStepResult[] = [];
    let previousOutput = initialInput;
    let status: WorkflowRunResult['status'] = 'completed';
    let aborted = false;

    // Walk steps, grouping consecutive parallel-labelled steps together.
    let i = 0;
    while (i < wf.steps.length && !aborted) {
      // Enforce per-workflow timeout
      if (deadline && Date.now() >= deadline) {
        status = 'failed';
        break;
      }

      const step = wf.steps[i]!;

      if (!step.parallel) {
        // ── Serial step ────────────────────────────────────────────────────────
        if (step.condition) {
          const regex = new RegExp(step.condition, 'i');
          if (!regex.test(previousOutput)) {
            stepResults.push({ stepIndex: i, agentId: step.agentId, skipped: true });
            onStepSkipped?.(i, step.agentId);
            i++;
            continue;
          }
        }

        const stepInput = this.buildStepInput(step, i, initialInput, previousOutput);
        onStepStarted?.(i, step.agentId);
        try {
          const run = await this.orchestrator.runAgent(step.agentId, { input: stepInput, ...(timeoutMs && { timeoutMs }) });
          const output = run.output ?? '';
          stepResults.push({ stepIndex: i, agentId: step.agentId, skipped: false, run, output });
          onStepCompleted?.(i, step.agentId, output);
          previousOutput = output;
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Step failed';
          stepResults.push({ stepIndex: i, agentId: step.agentId, skipped: false, error });
          onStepFailed?.(i, step.agentId, error);
          if (step.stopOnFailure !== false) {
            status = 'failed';
            aborted = true;
          } else {
            status = 'partial';
          }
        }
        i++;

      } else {
        // ── Parallel group ────────────────────────────────────────────────────
        // Collect all consecutive steps that share this parallel label.
        const groupLabel = step.parallel;
        const groupStart = i;
        const groupSteps: Array<{ step: WorkflowStep; idx: number }> = [];
        while (i < wf.steps.length && wf.steps[i]?.parallel === groupLabel) {
          groupSteps.push({ step: wf.steps[i]!, idx: i });
          i++;
        }

        // Run all group steps concurrently; each sees the same previousOutput.
        const parallelInput = previousOutput;
        groupSteps.forEach(({ step: gs, idx }) => onStepStarted?.(idx, gs.agentId, groupLabel));

        const settled = await Promise.allSettled(
          groupSteps.map(({ step: gs, idx }) => {
            const stepInput = this.buildStepInput(gs, groupStart, initialInput, parallelInput);
            return this.orchestrator.runAgent(gs.agentId, { input: stepInput, ...(timeoutMs && { timeoutMs }) }).then(run => ({
              idx,
              agentId: gs.agentId,
              run,
              output: run.output ?? '',
              stopOnFailure: gs.stopOnFailure !== false,
            }));
          }),
        );

        const groupOutputs: string[] = [];
        let groupFailed = false;
        let groupStopOnFailure = false;

        for (const result of settled) {
          if (result.status === 'fulfilled') {
            const { idx, agentId, run, output } = result.value;
            stepResults.push({ stepIndex: idx, agentId, skipped: false, run, output, parallel: groupLabel });
            groupOutputs.push(output);
            onStepCompleted?.(idx, agentId, output, groupLabel);
          } else {
            // Find which step this corresponds to (settled preserves order)
            const settledIdx = settled.indexOf(result);
            const gs = groupSteps[settledIdx]!;
            const error = result.reason instanceof Error ? result.reason.message : 'Step failed';
            stepResults.push({ stepIndex: gs.idx, agentId: gs.step.agentId, skipped: false, error, parallel: groupLabel });
            groupFailed = true;
            if (gs.step.stopOnFailure !== false) groupStopOnFailure = true;
            onStepFailed?.(gs.idx, gs.step.agentId, error, groupLabel);
          }
        }

        if (groupOutputs.length > 0) {
          previousOutput = groupOutputs.join('\n\n---\n\n');
        }

        if (groupFailed) {
          if (groupStopOnFailure) {
            status = 'failed';
            aborted = true;
          } else {
            status = 'partial';
          }
        }
      }
    }

    return {
      workflowId,
      workflowName: wf.name,
      status,
      steps: stepResults,
      finalOutput: previousOutput !== initialInput ? previousOutput : undefined,
      durationMs: Date.now() - start,
    };
  }
}
