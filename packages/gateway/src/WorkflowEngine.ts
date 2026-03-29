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

  async run(workflowId: string, initialInput: string): Promise<WorkflowRunResult> {
    const wf = this.get(workflowId);
    if (!wf) throw new Error(`Workflow "${workflowId}" not found`);

    const start = Date.now();
    const stepResults: WorkflowStepResult[] = [];
    let previousOutput = initialInput;
    let status: WorkflowRunResult['status'] = 'completed';

    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i]!;
      const stopOnFailure = step.stopOnFailure !== false;

      // Evaluate condition
      if (step.condition) {
        const regex = new RegExp(step.condition, 'i');
        if (!regex.test(previousOutput)) {
          stepResults.push({ stepIndex: i, agentId: step.agentId, skipped: true });
          continue;
        }
      }

      // Build input
      const mode = step.inputMode ?? (i === 0 ? 'initial' : 'previous');
      let stepInput: string;
      switch (mode) {
        case 'initial':
          stepInput = initialInput;
          break;
        case 'previous':
          stepInput = previousOutput;
          break;
        case 'concat':
          stepInput = step.template
            ? `${previousOutput}\n\n${step.template}`
            : previousOutput;
          break;
        case 'template':
          stepInput = (step.template ?? '{{previous}}')
            .replace('{{input}}', initialInput)
            .replace('{{previous}}', previousOutput);
          break;
        default:
          stepInput = previousOutput;
      }

      // Execute step
      try {
        const run = await this.orchestrator.runAgent(step.agentId, { input: stepInput });
        const output = run.output ?? '';
        stepResults.push({ stepIndex: i, agentId: step.agentId, skipped: false, run, output });
        previousOutput = output;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Step failed';
        stepResults.push({ stepIndex: i, agentId: step.agentId, skipped: false, error });
        status = 'failed';
        if (stopOnFailure) break;
        status = 'partial';
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
