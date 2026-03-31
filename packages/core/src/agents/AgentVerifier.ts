import type { ModelEngine } from '@krythor/models';
import type { AgentPlan } from './AgentPlanner.js';

export interface VerificationResult {
  valid: boolean;
  confidence: 'high' | 'medium' | 'low';
  issues: string[];
  suggestion?: string;
}

const VERIFICATION_SYSTEM_PROMPT = `You are a task completion verifier. Given a user task, execution plan, and agent output, determine if the task was completed adequately.

Return ONLY valid JSON:
{
  "valid": true/false,
  "confidence": "high" | "medium" | "low",
  "issues": ["issue1", "issue2"],
  "suggestion": "what to do differently" (only if valid=false)
}

Be lenient — mark valid=true unless there's a clear gap between task and output.
Only mark valid=false if the output completely misses the task or is empty.`;

const PASS_THROUGH: VerificationResult = { valid: true, confidence: 'low', issues: [] };

export class AgentVerifier {
  constructor(private readonly models: ModelEngine) {}

  async verify(
    originalTask: string,
    plan: AgentPlan,
    output: string,
    options?: { modelId?: string; providerId?: string; signal?: AbortSignal },
  ): Promise<VerificationResult> {
    // Simple tasks don't need verification — too expensive
    if (plan.complexity === 'simple') {
      return PASS_THROUGH;
    }

    const userMessage = [
      `User task: ${originalTask}`,
      '',
      `Execution plan summary: ${plan.taskSummary}`,
      `Plan steps: ${plan.steps.map(s => s.objective).join('; ')}`,
      '',
      `Agent output:\n${output.slice(0, 2000)}`,
    ].join('\n');

    try {
      const response = await this.models.infer(
        {
          messages: [
            { role: 'system', content: VERIFICATION_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          model:       options?.modelId,
          providerId:  options?.providerId,
          temperature: 0.1,
          maxTokens:   512,
        },
        {},
        options?.signal,
      );

      const content = response.content.trim();

      let jsonStr = content;
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch && fenceMatch[1]) {
        jsonStr = fenceMatch[1].trim();
      }

      type RawVerification = {
        valid?: unknown;
        confidence?: unknown;
        issues?: unknown[];
        suggestion?: unknown;
      };
      const parsed = JSON.parse(jsonStr) as RawVerification;

      const valid      = parsed.valid !== false; // default to true if missing/malformed
      const confidence = (parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low')
        ? (parsed.confidence as 'high' | 'medium' | 'low')
        : 'low';
      const issues = Array.isArray(parsed.issues)
        ? (parsed.issues as unknown[]).filter(i => typeof i === 'string').map(String)
        : [];
      const suggestion = typeof parsed.suggestion === 'string' && parsed.suggestion.length > 0
        ? parsed.suggestion
        : undefined;

      return { valid, confidence, issues, suggestion };
    } catch {
      // Verification is best-effort — never fail the run
      return PASS_THROUGH;
    }
  }
}
