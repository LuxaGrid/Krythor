import { randomUUID } from 'crypto';
import type { ModelEngine } from '@krythor/models';

export interface PlanStep {
  id: string;
  objective: string;
  approach: string;
  skillId?: string;
  dependsOn?: string[];
  expectedOutput?: string;
}

export interface AgentPlan {
  id: string;
  runId: string;
  taskSummary: string;
  steps: PlanStep[];
  complexity: 'simple' | 'moderate' | 'complex';
  estimatedTurns: number;
  createdAt: number;
  model?: string;
  providerId?: string;
  /**
   * Suggested model routing hint derived from plan complexity (Phase 6A).
   * The AgentRunner reads this after planning to adjust effectiveModel selection.
   */
  suggestedModelHint?: { preferCostTier?: 'low' | 'medium' | 'high'; preferSpeedTier?: 'fast' | 'balanced' | 'thorough' };
}

const PLANNING_SYSTEM_PROMPT = `You are a task planning assistant. Given a user request and agent context, produce a structured execution plan in JSON.

Return ONLY valid JSON in this exact format:
{
  "taskSummary": "one-line summary",
  "complexity": "simple" | "moderate" | "complex",
  "estimatedTurns": number (1-10),
  "steps": [
    {
      "id": "step-1",
      "objective": "what to accomplish",
      "approach": "how to accomplish it",
      "expectedOutput": "what success looks like"
    }
  ]
}

Rules:
- simple tasks (1 question, 1 answer): 1 step
- moderate tasks (research + synthesize): 2-3 steps
- complex tasks (multi-tool, multi-phase): 3-5 steps
- Never more than 5 steps
- Be concise — steps are guidance, not scripts`;

export class AgentPlanner {
  constructor(private readonly models: ModelEngine) {}

  async plan(
    input: string,
    agentContext: { systemPrompt: string; name: string; tools?: string[] },
    runId: string,
    options?: { modelId?: string; providerId?: string; signal?: AbortSignal; memoryContext?: string },
  ): Promise<AgentPlan> {
    // Phase 5A: prepend memory context when available so planning uses relevant past context
    const taskSection = options?.memoryContext
      ? `Relevant context from memory:\n${options.memoryContext}\n---\nUser task:\n${input}`
      : `User request: ${input}`;

    const userMessage = [
      `Agent name: ${agentContext.name}`,
      `Agent purpose: ${agentContext.systemPrompt.slice(0, 300)}`,
      agentContext.tools && agentContext.tools.length > 0
        ? `Available tools: ${agentContext.tools.join(', ')}`
        : '',
      '',
      taskSection,
    ].filter(Boolean).join('\n');

    try {
      const response = await this.models.infer(
        {
          messages: [
            { role: 'system', content: PLANNING_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          model:       options?.modelId,
          providerId:  options?.providerId,
          temperature: 0.2,
          maxTokens:   1024,
        },
        {},
        options?.signal,
      );

      const content = response.content.trim();

      // Extract JSON — model may wrap it in ```json ... ``` fences
      let jsonStr = content;
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch && fenceMatch[1]) {
        jsonStr = fenceMatch[1].trim();
      }

      type RawPlan = {
        taskSummary?: unknown;
        complexity?: unknown;
        estimatedTurns?: unknown;
        steps?: unknown[];
      };
      const parsed = JSON.parse(jsonStr) as RawPlan;

      const steps: PlanStep[] = (Array.isArray(parsed.steps) ? parsed.steps : []).map(
        (s: unknown, i: number) => {
          const step = s as Record<string, unknown>;
          return {
            id:             typeof step['id'] === 'string' ? step['id'] : `step-${i + 1}`,
            objective:      typeof step['objective'] === 'string' ? step['objective'] : String(step['objective'] ?? ''),
            approach:       typeof step['approach'] === 'string' ? step['approach'] : String(step['approach'] ?? ''),
            expectedOutput: typeof step['expectedOutput'] === 'string' ? step['expectedOutput'] : undefined,
            skillId:        typeof step['skillId'] === 'string' ? step['skillId'] : undefined,
            dependsOn:      Array.isArray(step['dependsOn'])
              ? (step['dependsOn'] as unknown[]).filter(d => typeof d === 'string').map(String)
              : undefined,
          };
        },
      );

      const complexity = (parsed.complexity === 'simple' || parsed.complexity === 'moderate' || parsed.complexity === 'complex')
        ? (parsed.complexity as 'simple' | 'moderate' | 'complex')
        : 'simple';

      const estimatedTurns =
        typeof parsed.estimatedTurns === 'number' && parsed.estimatedTurns >= 1
          ? Math.min(Math.round(parsed.estimatedTurns), 10)
          : 1;

      // Phase 6A: attach model hint based on complexity
      const suggestedModelHint: AgentPlan['suggestedModelHint'] =
        complexity === 'simple'
          ? { preferCostTier: 'low',  preferSpeedTier: 'fast'      }
          : complexity === 'complex'
            ? { preferCostTier: 'high', preferSpeedTier: 'thorough'  }
            : { preferCostTier: 'medium', preferSpeedTier: 'balanced' };

      return {
        id:             randomUUID(),
        runId,
        taskSummary:    typeof parsed.taskSummary === 'string' ? parsed.taskSummary : input.slice(0, 80),
        steps:          steps.length > 0 ? steps : [fallbackStep(input)],
        complexity,
        estimatedTurns,
        createdAt:      Date.now(),
        model:          response.model,
        providerId:     response.providerId,
        suggestedModelHint,
      };
    } catch {
      // Graceful fallback — return a single-step plan so the run is never blocked
      return fallbackPlan(input, runId);
    }
  }
}

function fallbackStep(input: string): PlanStep {
  return {
    id:             'step-1',
    objective:      input.slice(0, 100),
    approach:       'Respond directly based on agent capabilities',
    expectedOutput: 'Adequate response to the user request',
  };
}

function fallbackPlan(input: string, runId: string): AgentPlan {
  return {
    id:             randomUUID(),
    runId,
    taskSummary:    input.slice(0, 80),
    steps:          [fallbackStep(input)],
    complexity:     'simple',
    estimatedTurns: 1,
    createdAt:      Date.now(),
  };
}
