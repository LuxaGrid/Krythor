// ─── SessionStore ─────────────────────────────────────────────────────────────
//
// Maps structured session keys → conversation IDs.
//
// Session key format (mirrors the reference platform's convention):
//   main sessions:              agent:<agentId>:main
//   per-peer DM:                agent:<agentId>:direct:<peerId>
//   per-channel-peer DM:        agent:<agentId>:<channel>:direct:<peerId>
//   per-account-channel-peer:   agent:<agentId>:<channel>:<accountId>:direct:<peerId>
//   group chat:                 agent:<agentId>:<channel>:group:<groupId>
//   channel/room:               agent:<agentId>:<channel>:channel:<channelId>
//   cron job:                   cron:<jobId>
//   webhook:                    hook:<uuid>
//   node run:                   node-<nodeId>
//
// dmScope config drives which key is used for DM routing.
// identityLinks maps provider-prefixed peer IDs to a canonical identity key.
//

import type Database from 'better-sqlite3';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DmScope =
  | 'main'
  | 'per-peer'
  | 'per-channel-peer'
  | 'per-account-channel-peer';

export type ChatType = 'direct' | 'group' | 'channel' | 'cron' | 'hook' | 'node' | 'main';

export type SendPolicy = 'allow' | 'deny';

export interface SendPolicyRule {
  action: 'allow' | 'deny';
  match: {
    channel?: string;
    chatType?: ChatType;
    keyPrefix?: string;
    rawKeyPrefix?: string;
  };
}

export interface SendPolicyConfig {
  rules: SendPolicyRule[];
  default: 'allow' | 'deny';
}

export interface SessionEntry {
  sessionKey: string;
  conversationId: string;
  agentId: string | null;
  channel: string | null;
  chatType: ChatType | null;
  peerId: string | null;
  accountId: string | null;
  displayName: string | null;
  lastChannel: string | null;
  lastTo: string | null;
  sendPolicy: SendPolicy | null;
  modelOverride: string | null;
  originLabel: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResolveSessionKeyParams {
  agentId: string;
  channel: string;
  chatType: ChatType;
  peerId?: string;
  groupId?: string;
  accountId?: string;
  dmScope?: DmScope;
  /** Maps provider-prefixed peer IDs (e.g. "telegram:123") to canonical keys. */
  identityLinks?: Record<string, string[]>;
}

interface SessionRow {
  session_key: string;
  conversation_id: string;
  agent_id: string | null;
  channel: string | null;
  chat_type: string | null;
  peer_id: string | null;
  account_id: string | null;
  display_name: string | null;
  last_channel: string | null;
  last_to: string | null;
  send_policy: string | null;
  model_override: string | null;
  origin_label: string | null;
  created_at: number;
  updated_at: number;
}

function rowToEntry(row: SessionRow): SessionEntry {
  return {
    sessionKey:    row.session_key,
    conversationId: row.conversation_id,
    agentId:       row.agent_id,
    channel:       row.channel,
    chatType:      (row.chat_type as ChatType) ?? null,
    peerId:        row.peer_id,
    accountId:     row.account_id,
    displayName:   row.display_name,
    lastChannel:   row.last_channel,
    lastTo:        row.last_to,
    sendPolicy:    (row.send_policy as SendPolicy) ?? null,
    modelOverride: row.model_override,
    originLabel:   row.origin_label,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

// ── Key builder ───────────────────────────────────────────────────────────────

/**
 * Resolve the canonical session key for an inbound message.
 * Applies identityLinks canonicalization for direct messages.
 */
export function resolveSessionKey(p: ResolveSessionKeyParams): string {
  const { agentId, channel, chatType, peerId, groupId, accountId, dmScope = 'main', identityLinks = {} } = p;

  if (chatType === 'group') {
    return `agent:${agentId}:${channel}:group:${groupId ?? 'unknown'}`;
  }
  if (chatType === 'channel') {
    return `agent:${agentId}:${channel}:channel:${groupId ?? 'unknown'}`;
  }

  // Direct message — apply dmScope
  if (chatType === 'direct') {
    // Apply identity links: if peerId matches any link entry, use canonical key
    const providerPeerId = `${channel}:${peerId}`;
    let canonicalPeer = peerId ?? 'unknown';
    for (const [canonical, aliases] of Object.entries(identityLinks)) {
      if (aliases.includes(providerPeerId)) {
        canonicalPeer = canonical;
        break;
      }
    }

    switch (dmScope) {
      case 'main':
        return `agent:${agentId}:main`;
      case 'per-peer':
        return `agent:${agentId}:direct:${canonicalPeer}`;
      case 'per-channel-peer':
        return `agent:${agentId}:${channel}:direct:${canonicalPeer}`;
      case 'per-account-channel-peer':
        return `agent:${agentId}:${channel}:${accountId ?? 'default'}:direct:${canonicalPeer}`;
    }
  }

  return `agent:${agentId}:main`;
}

// ── SessionStore ──────────────────────────────────────────────────────────────

export class SessionStore {
  constructor(private readonly db: Database.Database) {}

  // ── Lookup ────────────────────────────────────────────────────────────────

  getByKey(sessionKey: string): SessionEntry | null {
    const row = this.db.prepare(
      'SELECT * FROM sessions WHERE session_key = @sessionKey'
    ).get({ sessionKey }) as SessionRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  getByConversationId(conversationId: string): SessionEntry | null {
    const row = this.db.prepare(
      'SELECT * FROM sessions WHERE conversation_id = @conversationId LIMIT 1'
    ).get({ conversationId }) as SessionRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  // ── Upsert ────────────────────────────────────────────────────────────────

  upsert(entry: Omit<SessionEntry, 'createdAt' | 'updatedAt'>): SessionEntry {
    const now = Date.now();
    const existing = this.getByKey(entry.sessionKey);
    if (existing) {
      this.db.prepare(`
        UPDATE sessions SET
          conversation_id = @conversationId,
          agent_id        = @agentId,
          channel         = @channel,
          chat_type       = @chatType,
          peer_id         = @peerId,
          account_id      = @accountId,
          display_name    = @displayName,
          last_channel    = @lastChannel,
          last_to         = @lastTo,
          send_policy     = @sendPolicy,
          model_override  = @modelOverride,
          origin_label    = @originLabel,
          updated_at      = @now
        WHERE session_key = @sessionKey
      `).run({ ...entry, now });
      return { ...entry, createdAt: existing.createdAt, updatedAt: now };
    }
    this.db.prepare(`
      INSERT INTO sessions (
        session_key, conversation_id, agent_id, channel, chat_type,
        peer_id, account_id, display_name, last_channel, last_to,
        send_policy, model_override, origin_label, created_at, updated_at
      ) VALUES (
        @sessionKey, @conversationId, @agentId, @channel, @chatType,
        @peerId, @accountId, @displayName, @lastChannel, @lastTo,
        @sendPolicy, @modelOverride, @originLabel, @now, @now
      )
    `).run({ ...entry, now });
    return { ...entry, createdAt: now, updatedAt: now };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  list(opts: {
    agentId?: string;
    kinds?: ChatType[];
    limit?: number;
    activeMinutes?: number;
  } = {}): SessionEntry[] {
    const { agentId, kinds, limit = 200, activeMinutes } = opts;
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (agentId) {
      conditions.push('agent_id = @agentId');
      params['agentId'] = agentId;
    }
    if (kinds && kinds.length > 0) {
      const placeholders = kinds.map((_, i) => `@kind${i}`).join(', ');
      kinds.forEach((k, i) => { params[`kind${i}`] = k; });
      conditions.push(`chat_type IN (${placeholders})`);
    }
    if (activeMinutes !== undefined) {
      const cutoff = Date.now() - activeMinutes * 60_000;
      conditions.push('updated_at >= @cutoff');
      params['cutoff'] = cutoff;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params['limit'] = limit;
    const rows = this.db.prepare(
      `SELECT * FROM sessions ${where} ORDER BY updated_at DESC LIMIT @limit`
    ).all(params) as SessionRow[];
    return rows.map(rowToEntry);
  }

  // ── Patch ─────────────────────────────────────────────────────────────────

  setSendPolicy(sessionKey: string, policy: SendPolicy | null): void {
    const now = Date.now();
    this.db.prepare(
      'UPDATE sessions SET send_policy = @policy, updated_at = @now WHERE session_key = @sessionKey'
    ).run({ sessionKey, policy, now });
  }

  setModelOverride(sessionKey: string, modelId: string | null): void {
    const now = Date.now();
    this.db.prepare(
      'UPDATE sessions SET model_override = @modelId, updated_at = @now WHERE session_key = @sessionKey'
    ).run({ sessionKey, modelId, now });
  }

  touch(sessionKey: string): void {
    const now = Date.now();
    this.db.prepare(
      'UPDATE sessions SET updated_at = @now WHERE session_key = @sessionKey'
    ).run({ sessionKey, now });
  }

  delete(sessionKey: string): void {
    this.db.prepare('DELETE FROM sessions WHERE session_key = @sessionKey').run({ sessionKey });
  }

  // ── Send policy evaluation ─────────────────────────────────────────────────

  /**
   * Evaluate whether delivery is allowed for a session.
   * Per-session override takes precedence over config rules.
   */
  static evaluateSendPolicy(
    entry: Pick<SessionEntry, 'sendPolicy' | 'channel' | 'chatType' | 'sessionKey'>,
    config?: SendPolicyConfig,
  ): 'allow' | 'deny' {
    // Session-level override wins
    if (entry.sendPolicy === 'allow') return 'allow';
    if (entry.sendPolicy === 'deny') return 'deny';

    if (!config) return 'allow';

    for (const rule of config.rules) {
      const m = rule.match;
      if (m.channel && m.channel !== entry.channel) continue;
      if (m.chatType && m.chatType !== entry.chatType) continue;
      if (m.keyPrefix && !entry.sessionKey.startsWith(m.keyPrefix)) continue;
      if (m.rawKeyPrefix && !entry.sessionKey.startsWith(m.rawKeyPrefix)) continue;
      return rule.action;
    }

    return config.default;
  }
}
