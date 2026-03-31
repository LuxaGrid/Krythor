import { randomUUID } from 'crypto';

export type StepType = 'plan' | 'inference' | 'tool_call' | 'skill_call' | 'handoff' | 'verify' | 'adapt';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ExecutionStep {
  id: string;
  runId: string;
  turn: number;
  type: StepType;
  status: StepStatus;
  input?: string;
  output?: string;
  toolName?: string;
  skillId?: string;
  durationMs?: number;
  tokensUsed?: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface ExecutionTrace {
  runId: string;
  steps: ExecutionStep[];
  totalDurationMs: number;
  totalTokens: number;
  stepCount: number;
}

const INPUT_OUTPUT_MAX = 500;

export class ExecutionTracer {
  private steps: ExecutionStep[] = [];
  private readonly runId: string;
  private readonly startedAt: number;

  constructor(runId: string) {
    this.runId    = runId;
    this.startedAt = Date.now();
  }

  startStep(type: StepType, turn: number, input?: string): ExecutionStep {
    const step: ExecutionStep = {
      id:        randomUUID(),
      runId:     this.runId,
      turn,
      type,
      status:    'running',
      startedAt: Date.now(),
      input:     input !== undefined ? input.slice(0, INPUT_OUTPUT_MAX) : undefined,
    };
    this.steps.push(step);
    return step;
  }

  completeStep(stepId: string, output?: string, tokensUsed?: number): void {
    const step = this.steps.find(s => s.id === stepId);
    if (!step) return;
    const now = Date.now();
    step.status      = 'completed';
    step.completedAt = now;
    step.durationMs  = now - step.startedAt;
    if (output !== undefined) step.output = output.slice(0, INPUT_OUTPUT_MAX);
    if (typeof tokensUsed === 'number') step.tokensUsed = tokensUsed;
  }

  failStep(stepId: string, error: string): void {
    const step = this.steps.find(s => s.id === stepId);
    if (!step) return;
    const now = Date.now();
    step.status      = 'failed';
    step.error       = error;
    step.completedAt = now;
    step.durationMs  = now - step.startedAt;
  }

  getTrace(): ExecutionTrace {
    const totalDurationMs = Date.now() - this.startedAt;
    const totalTokens = this.steps.reduce((sum, s) => sum + (s.tokensUsed ?? 0), 0);
    return {
      runId:          this.runId,
      steps:          [...this.steps],
      totalDurationMs,
      totalTokens,
      stepCount:      this.steps.length,
    };
  }

  getSteps(): ExecutionStep[] {
    return [...this.steps];
  }
}
