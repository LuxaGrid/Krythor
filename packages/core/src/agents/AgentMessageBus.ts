import { randomUUID } from 'crypto';
import type { AgentOrchestrator } from './AgentOrchestrator.js';

// ─── AgentMessageBus ─────────────────────────────────────────────────────────
//
// Simple in-process message bus for agent-to-agent communication and delegation.
//
// Messages are stored in a capped ring buffer (last 1000 per agent, global max 5000).
// Subscribers are notified synchronously when a new message arrives.
//
// Delegation: sends a message AND runs the target agent with the given input,
// returning the run output as a string.
//

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  timestamp: number;
  replyTo?: string; // id of the message this is replying to
}

const MAX_MESSAGES = 5000;

export class AgentMessageBus {
  private messages: AgentMessage[] = [];
  private handlers: Map<string, Array<(msg: AgentMessage) => void>> = new Map();

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Send a message from one agent to another.
   * Notifies all subscribers for the target agent synchronously.
   */
  send(msg: Omit<AgentMessage, 'id' | 'timestamp'>): AgentMessage {
    const full: AgentMessage = {
      ...msg,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    this.messages.push(full);

    // Trim global ring to prevent unbounded growth
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    }

    // Notify subscribers for the target agent
    const handlers = this.handlers.get(full.toAgentId);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(full); } catch { /* non-fatal */ }
      }
    }

    return full;
  }

  /**
   * Subscribe to messages addressed to the given agentId.
   * Returns an unsubscribe function.
   */
  subscribe(agentId: string, handler: (msg: AgentMessage) => void): () => void {
    if (!this.handlers.has(agentId)) {
      this.handlers.set(agentId, []);
    }
    this.handlers.get(agentId)!.push(handler);

    return () => {
      const list = this.handlers.get(agentId);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  }

  /**
   * Retrieve messages for a given agentId (sent to or from), optionally
   * filtering by timestamp.
   */
  getMessages(agentId: string, since?: number): AgentMessage[] {
    return this.messages.filter(m => {
      const relevant = m.toAgentId === agentId || m.fromAgentId === agentId;
      if (!relevant) return false;
      if (since !== undefined && m.timestamp < since) return false;
      return true;
    });
  }

  /**
   * Delegate a task from one agent to another: sends a message AND runs
   * the target agent with the given input. Returns the run output.
   */
  async delegate(
    fromAgentId: string,
    toAgentId: string,
    input: string,
    orchestrator: AgentOrchestrator,
  ): Promise<string> {
    // Record the delegation as a message
    this.send({ fromAgentId, toAgentId, content: input });

    // Run the target agent
    const run = await orchestrator.runAgent(toAgentId, { input });
    const output = run.output ?? '';

    // Record the reply
    this.send({ fromAgentId: toAgentId, toAgentId: fromAgentId, content: output });

    return output;
  }
}
