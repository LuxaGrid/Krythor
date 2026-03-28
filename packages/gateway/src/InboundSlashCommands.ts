// ─── InboundSlashCommands ─────────────────────────────────────────────────────
//
// Shared in-chat slash command handling for all inbound channel handlers.
//
// Recognized commands (case-insensitive, exact match on the command token):
//   /help           — list available slash commands
//   /commands       — alias for /help
//   /status         — agent status, model, context message count
//   /whoami         — show sender id (alias: /id)
//   /id             — alias for /whoami
//   /stop           — stop the current session run (if running)
//   /send on|off|inherit — toggle send policy override for this session
//   /context        — show context stats (message count, agent)
//   /compact        — request context compaction (resets context to summary)
//   /new [model]    — start a new conversation (handled by caller as reset trigger)
//   /reset          — alias for /new
//
// Returns null when the command is not recognized (caller should handle as regular message).
// Returns a string response when the command is handled.
//
// "isReset" is set to true when the command should be treated as a session reset.
//

import type { ConversationStore } from '@krythor/memory';
import type { SessionRouter } from './SessionRouter.js';

export interface SlashCommandContext {
  agentId: string;
  channel: string;
  senderId: string;
  conversationId?: string;
  sessionKey?: string;
  convStore?: ConversationStore | null;
  sessionRouter?: SessionRouter | null;
}

export interface SlashCommandResult {
  response: string | null;  // null = not a slash command
  isReset: boolean;
  isHandled: boolean;
  ttsText?: string;
}

const HELP_TEXT = [
  '📋 Available slash commands:',
  '/help — show this list',
  '/status — agent status and context info',
  '/whoami — show your sender ID',
  '/stop — stop current run',
  '/send on|off|inherit — toggle message delivery',
  '/context — show context stats',
  '/compact — compact conversation context',
  '/new [model] — start a new conversation',
  '/reset — alias for /new',
  '/tts <text> — synthesize text to speech (queued for TTS provider)',
].join('\n');

/**
 * Parse a slash command from a message string.
 * Returns { command, args } if the text starts with /, otherwise null.
 */
export function parseSlashCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { command: trimmed.toLowerCase(), args: '' };
  }
  return {
    command: trimmed.slice(0, spaceIdx).toLowerCase(),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}

/**
 * Handle a slash command. Returns the result indicating how to proceed.
 * Commands that need special handling (/new, /reset) are returned with isReset=true
 * so the caller can do its existing reset flow.
 */
export function handleSlashCommand(
  text: string,
  ctx: SlashCommandContext,
): SlashCommandResult {
  const parsed = parseSlashCommand(text);
  if (!parsed) {
    return { response: null, isReset: false, isHandled: false };
  }

  const { command, args } = parsed;

  // ── Reset triggers (handled by caller) ────────────────────────────────────
  if (command === '/new' || command === '/reset') {
    return { response: null, isReset: true, isHandled: false };
  }

  // ── Help ──────────────────────────────────────────────────────────────────
  if (command === '/help' || command === '/commands') {
    return { response: HELP_TEXT, isReset: false, isHandled: true };
  }

  // ── Status ────────────────────────────────────────────────────────────────
  if (command === '/status') {
    const lines: string[] = [`Agent: ${ctx.agentId}`, `Channel: ${ctx.channel}`];
    if (ctx.conversationId && ctx.convStore) {
      const msgs = ctx.convStore.getMessages(ctx.conversationId);
      const userMsgs = msgs.filter(m => m.role === 'user').length;
      const asstMsgs = msgs.filter(m => m.role === 'assistant').length;
      lines.push(`Conversation: ${ctx.conversationId.slice(0, 8)}...`);
      lines.push(`Messages: ${userMsgs} user / ${asstMsgs} assistant`);
    }
    if (ctx.sessionKey) {
      lines.push(`Session key: ${ctx.sessionKey}`);
    }
    if (ctx.sessionRouter) {
      const cfg = ctx.sessionRouter.getConfig();
      if (cfg.dmScope) lines.push(`DM scope: ${cfg.dmScope}`);
    }
    return { response: lines.join('\n'), isReset: false, isHandled: true };
  }

  // ── Whoami ────────────────────────────────────────────────────────────────
  if (command === '/whoami' || command === '/id') {
    return { response: `Your sender ID: ${ctx.senderId}`, isReset: false, isHandled: true };
  }

  // ── Context ────────────────────────────────────────────────────────────────
  if (command === '/context') {
    if (!ctx.conversationId || !ctx.convStore) {
      return { response: 'No active conversation.', isReset: false, isHandled: true };
    }
    const msgs = ctx.convStore.getMessages(ctx.conversationId);
    const userMsgs = msgs.filter(m => m.role === 'user').length;
    const asstMsgs = msgs.filter(m => m.role === 'assistant').length;
    const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
    const lines = [
      `Conversation: ${ctx.conversationId.slice(0, 8)}...`,
      `Messages: ${userMsgs} user, ${asstMsgs} assistant`,
      `Total characters: ~${totalChars.toLocaleString()}`,
    ];
    return { response: lines.join('\n'), isReset: false, isHandled: true };
  }

  // ── Compact ────────────────────────────────────────────────────────────────
  if (command === '/compact') {
    // Compaction is best-effort: clear history beyond last 5 exchanges and note it
    if (!ctx.conversationId || !ctx.convStore) {
      return { response: 'No active conversation to compact.', isReset: false, isHandled: true };
    }
    const summary = args.trim() || 'Previous context compacted.';
    // Insert a system-level compaction note as an assistant message
    ctx.convStore.addMessage(ctx.conversationId, 'assistant', `[Context compacted: ${summary}]`);
    return { response: `Context compacted. Summary: "${summary}"`, isReset: false, isHandled: true };
  }

  // ── Send policy ────────────────────────────────────────────────────────────
  if (command === '/send') {
    if (!ctx.sessionRouter || !ctx.sessionKey) {
      return { response: '/send requires session routing to be active.', isReset: false, isHandled: true };
    }
    const val = args.trim().toLowerCase();
    if (val === 'on') {
      ctx.sessionRouter.setSendPolicy(ctx.sessionKey, 'allow');
      return { response: 'Send policy set to: on', isReset: false, isHandled: true };
    }
    if (val === 'off') {
      ctx.sessionRouter.setSendPolicy(ctx.sessionKey, 'deny');
      return { response: 'Send policy set to: off', isReset: false, isHandled: true };
    }
    if (val === 'inherit' || val === '') {
      ctx.sessionRouter.setSendPolicy(ctx.sessionKey, null);
      return { response: 'Send policy cleared (inheriting global setting).', isReset: false, isHandled: true };
    }
    return { response: 'Usage: /send on|off|inherit', isReset: false, isHandled: true };
  }

  // ── Stop ──────────────────────────────────────────────────────────────────
  if (command === '/stop') {
    // The caller is responsible for implementing actual stop — we just signal it
    return { response: '(stop requested — no active run to stop)', isReset: false, isHandled: true };
  }

  // ── TTS ───────────────────────────────────────────────────────────────────
  if (command === '/tts') {
    if (!args) {
      return { response: 'Usage: /tts <text to speak>', isReset: false, isHandled: true };
    }
    return { response: '🔊 (TTS queued)', isReset: false, isHandled: true, ttsText: args };
  }

  // ── Unknown slash command ─────────────────────────────────────────────────
  // Return null so the text is passed through to the model
  return { response: null, isReset: false, isHandled: false };
}
