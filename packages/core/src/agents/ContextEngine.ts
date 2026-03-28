// ─── ContextEngine ────────────────────────────────────────────────────────────
//
// Pluggable interface for controlling what enters and leaves an agent's context
// window across conversation turns.
//
// Lifecycle per turn:
//   1. ingest(messages, newMessage)  — filter or transform incoming messages
//   2. assemble(messages)            — select which messages go to the model
//   3. [model call happens]
//   4. compact(messages)             — trim if messages exceed token budget
//   5. afterTurn(messages, response) — post-turn hook (memory, logging, etc.)
//

import type { AgentMessage } from './types.js';

// ── Interface ─────────────────────────────────────────────────────────────────

export interface ContextEngine {
  /**
   * Called before a new message is appended to the conversation.
   * Return the (possibly modified) message, or null to drop it.
   */
  ingest(messages: AgentMessage[], incoming: AgentMessage): AgentMessage | null;

  /**
   * Called just before inference. Returns the messages array to send to the
   * model. May reorder, trim, summarise, or inject synthetic messages.
   */
  assemble(messages: AgentMessage[]): AgentMessage[];

  /**
   * Called just before `compact()` runs. Implementors can use this hook to
   * flush important facts to memory before old messages are dropped.
   * Optional — callers check for existence before invoking.
   */
  beforeCompact?(messages: AgentMessage[]): void;

  /**
   * Called when the assembled messages exceed `maxTokenBudget`. Should return
   * a shorter list that fits within the budget. The default implementation
   * keeps the system prompt + last N messages.
   */
  compact(messages: AgentMessage[], maxTokenBudget: number): AgentMessage[];

  /**
   * Called after every model response is appended to `messages`.
   * Use for memory writes, audit logging, or state updates.
   * Should not throw — errors are the implementer's responsibility.
   */
  afterTurn(messages: AgentMessage[], response: string): void;
}

// ── Default implementation ────────────────────────────────────────────────────

/** Rough token estimate: 1 token ≈ 4 chars */
function estimateTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

export class DefaultContextEngine implements ContextEngine {
  /** Token budget before compaction kicks in (default: 100k tokens ≈ 400k chars). */
  constructor(private readonly maxTokenBudget = 100_000) {}

  ingest(_messages: AgentMessage[], incoming: AgentMessage): AgentMessage | null {
    // Pass through by default
    return incoming;
  }

  assemble(messages: AgentMessage[]): AgentMessage[] {
    // Return all messages — compaction is handled separately
    return messages;
  }

  beforeCompact(_messages: AgentMessage[]): void {
    // No-op in the default implementation — override to flush facts to memory.
  }

  compact(messages: AgentMessage[], maxTokenBudget: number): AgentMessage[] {
    // Keep system prompt (index 0) and trim from the oldest non-system messages
    // until we're under budget.
    if (messages.length <= 2) return messages;

    const system = messages[0]!;
    let body = messages.slice(1);

    while (estimateTokens([system, ...body]) > maxTokenBudget && body.length > 1) {
      body = body.slice(1); // drop oldest non-system message
    }

    return [system, ...body];
  }

  afterTurn(_messages: AgentMessage[], _response: string): void {
    // No-op in the default implementation — override to add memory writes, etc.
  }

  /** Convenience: check if current messages exceed budget and compact if needed. */
  maybeCompact(messages: AgentMessage[]): AgentMessage[] {
    if (estimateTokens(messages) > this.maxTokenBudget) {
      return this.compact(messages, this.maxTokenBudget);
    }
    return messages;
  }
}
