// ─── AgentBindingRouter ────────────────────────────────────────────────────────
//
// Routes inbound messages to an agentId using a priority-ordered list of
// binding rules. Rules are evaluated in order and the first match wins.
//
// Each binding specifies a target agentId and a match object. All match
// fields present in the rule must match the inbound context. Omitted fields
// are wildcards (match anything).
//
// Match field priority (most → least specific):
//   peerId         — exact DM/group peer identifier
//   guildId        — Discord guild / Telegram group chat id
//   accountId      — channel account identifier (multi-account channels)
//   channel        — channel type (telegram, discord, whatsapp, ...)
//   (no fields)    — catch-all / default
//
// Usage:
//   const router = new AgentBindingRouter(bindings);
//   const agentId = router.resolve('telegram', 'user123') ?? defaultAgentId;
//

export interface AgentBinding {
  /** Target agent for this binding. */
  agentId: string;
  /** Match criteria — all present fields must match. Omitted = wildcard. */
  match: {
    channel?: string;
    accountId?: string;
    peerId?: string;
    guildId?: string;
  };
}

export interface AgentBindingRouterOptions {
  /** Default agent to return when no binding matches. */
  defaultAgentId?: string;
}

export class AgentBindingRouter {
  private readonly bindings: AgentBinding[];
  private readonly defaultAgentId: string | undefined;

  constructor(bindings: AgentBinding[], options: AgentBindingRouterOptions = {}) {
    this.bindings = bindings;
    this.defaultAgentId = options.defaultAgentId;
  }

  /**
   * Resolve the agentId for an inbound message context.
   * Returns the matched agentId, the defaultAgentId, or undefined.
   */
  resolve(
    channel: string,
    peerId?: string,
    accountId?: string,
    guildId?: string,
  ): string | undefined {
    for (const binding of this.bindings) {
      const m = binding.match;
      if (m.channel   !== undefined && m.channel   !== channel)   continue;
      if (m.accountId !== undefined && m.accountId !== accountId) continue;
      if (m.guildId   !== undefined && m.guildId   !== guildId)   continue;
      if (m.peerId    !== undefined && m.peerId    !== peerId)     continue;
      return binding.agentId;
    }
    return this.defaultAgentId;
  }

  /** Number of configured bindings. */
  get size(): number {
    return this.bindings.length;
  }
}
