import type { FastifyInstance } from 'fastify';
import type { KrythorCore, AgentOrchestrator } from '@krythor/core';
import type { AgentEvent } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';
import type { ConversationStore } from '@krythor/memory';
import type { DevicePairingStore } from '../ws/DevicePairingStore.js';
import type { ApprovalManager } from '../ApprovalManager.js';
import type { PrivacyRouter } from '@krythor/models';
import type { SessionDirectiveStore } from '../SessionDirectiveStore.js';
import { classifyError } from '../errors.js';

/** Register a requestId→runId mapping on the app instance (set in server.ts). */
function registerRunRequestId(app: FastifyInstance, runId: string, requestId: string): void {
  const reg = (app as unknown as Record<string, unknown>)['registerRunRequestId'];
  if (typeof reg === 'function') reg(runId, requestId);
}

export function registerCommandRoute(
  app: FastifyInstance,
  core: KrythorCore,
  orchestrator: AgentOrchestrator,
  broadcast: (msg: unknown) => void,
  guard?: GuardEngine,
  convStore?: ConversationStore,
  deviceStore?: DevicePairingStore,
  approvalManager?: ApprovalManager,
  privacyRouter?: PrivacyRouter,
  sessionDirectives?: SessionDirectiveStore,
): void {
  app.post('/api/command', {
    config: {
      // Tighter rate limit for inference — prevents runaway loops from agents or UI bugs.
      rateLimit: { max: 60, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['input'],
        properties: {
          input:          { type: 'string', minLength: 1 },
          agentId:        { type: 'string' },
          modelId:        { type: 'string' },
          stream:         { type: 'boolean' },
          conversationId: { type: 'string' },
          responseFormat: {
            type: 'object',
            properties: {
              type:   { type: 'string', enum: ['json_object', 'json_schema'] },
              schema: { type: 'object' },
              name:   { type: 'string' },
            },
            required: ['type'],
          },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { input, agentId, modelId, stream, conversationId, responseFormat } = req.body as {
      input: string;
      agentId?: string;
      modelId?: string;
      stream?: boolean;
      conversationId?: string;
      responseFormat?: import('@krythor/models').ResponseFormat;
    };

    // Resolve model engine early so it's available for slash-command responses.
    const models = core.getModels();

    // In-chat /command handling — intercept slash commands before inference.
    // /new            — start a new conversation (creates a DB record, signals the client)
    // /compact        — trim old messages from the stored conversation context
    // /model <id>     — switch model for this and subsequent messages
    // /agent <id>     — switch agent for this and subsequent messages
    // /clear          — return a synthetic 'cleared' signal (client clears history display)
    // These return a synthetic response; no inference is triggered.
    // When stream=true, responses are wrapped in SSE so the client reader can handle them.
    if (input.startsWith('/')) {
      const [cmd, ...args] = input.trim().split(/\s+/);
      const arg = args.join(' ').trim();

      /** Emit a synthetic slash-command response in the correct format. */
      const slashReply = (payload: Record<string, unknown>) => {
        if (stream) {
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          reply.raw.write(`data: ${JSON.stringify({ type: 'done', output: payload.output, duration: 0, ...payload })}\n\n`);
          reply.raw.end();
          return reply;
        }
        return reply.send({ input, timestamp: new Date().toISOString(), processingTimeMs: 0, ...payload });
      };

      if (cmd === '/new') {
        // Start a new conversation — create a fresh conversation record and signal the client
        let newConvId: string | undefined;
        if (convStore) {
          const conv = convStore.createConversation(agentId);
          newConvId = conv.id;
          if (stream) {
            // Emit the conversation event before done so the client can open it
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
            reply.raw.write(`data: ${JSON.stringify({ type: 'conversation', conversationId: newConvId, title: 'New Chat' })}\n\n`);
            reply.raw.write(`data: ${JSON.stringify({ type: 'done', output: '(new conversation started)', duration: 0, conversationId: newConvId, command: 'new' })}\n\n`);
            reply.raw.end();
            return reply;
          }
        }
        return slashReply({ output: '(new conversation started)', command: 'new', newConversationId: newConvId, agentId });
      }

      if (cmd === '/compact') {
        // Compact context: keep only the most recent N message pairs in the stored conversation
        const COMPACT_KEEP = 10; // keep last 10 messages
        if (conversationId && convStore) {
          const msgs = convStore.getMessages(conversationId);
          if (msgs.length > COMPACT_KEEP) {
            const toDelete = msgs.slice(0, msgs.length - COMPACT_KEEP);
            for (const m of toDelete) {
              convStore.deleteMessage?.(m.id);
            }
          }
          const kept = Math.min(msgs.length, COMPACT_KEEP);
          return slashReply({ output: `(context compacted — kept last ${kept} messages)`, command: 'compact', conversationId });
        }
        return slashReply({ output: '(context compacted)', command: 'compact' });
      }

      if (cmd === '/clear') {
        return slashReply({ output: '(chat history cleared)', command: 'clear' });
      }

      if (cmd === '/model') {
        if (!arg) {
          const modelList = models?.listModels().map(m => `${m.id} (${m.providerId})`).join(', ') ?? '(no models)';
          return slashReply({ output: `Available models: ${modelList}. Use /model <id> to switch.`, command: 'model:list' });
        }
        return slashReply({ output: `Model switched to: ${arg}. This will be used for your next message.`, command: 'model:switch', modelId: arg });
      }

      if (cmd === '/agent') {
        if (!arg) {
          return slashReply({
            output: agentId ? `Active agent: ${agentId}. Use /agent <id> to switch.` : 'No agent active. Use /agent <id> to switch.',
            command: 'agent:status',
          });
        }
        return slashReply({ output: `Agent switched to: ${arg}. This will be used for your next message.`, command: 'agent:switch', agentId: arg });
      }

      if (cmd === '/subagents') {
        const [sub, ...subArgs] = args;
        const subArg = subArgs.join(' ').trim();

        if (!sub || sub === 'list') {
          // List active + recent runs
          const runs = orchestrator.listRuns().slice(0, 20);
          if (runs.length === 0) {
            return slashReply({ output: 'No agent runs found.', command: 'subagents:list', runs: [] });
          }
          const lines = runs.map(r => {
            const age = r.completedAt ? `${Math.round((Date.now() - r.completedAt) / 1000)}s ago` : 'running';
            const tokens = r.promptTokens !== undefined || r.completionTokens !== undefined
              ? ` | tokens: ${r.promptTokens ?? 0}↑ ${r.completionTokens ?? 0}↓`
              : '';
            const parent = r.parentRunId ? ` | parent: ${r.parentRunId.slice(-8)}` : '';
            return `[${r.status}] ${r.id.slice(-8)} — agent: ${r.agentId}${tokens}${parent} (${age})`;
          });
          return slashReply({ output: lines.join('\n'), command: 'subagents:list', runs });
        }

        if (sub === 'kill') {
          if (!subArg) return slashReply({ output: 'Usage: /subagents kill <runId>', command: 'subagents:kill' });
          const stopped = orchestrator.stopRun(subArg);
          return slashReply({
            output: stopped ? `Run "${subArg}" stopped.` : `Run "${subArg}" not found or already finished.`,
            command: 'subagents:kill',
            runId: subArg,
            stopped,
          });
        }

        if (sub === 'log') {
          if (!subArg) return slashReply({ output: 'Usage: /subagents log <runId>', command: 'subagents:log' });
          const run = orchestrator.getRun(subArg);
          if (!run) return slashReply({ output: `Run "${subArg}" not found.`, command: 'subagents:log', runId: subArg });
          const tokenLine = run.promptTokens !== undefined || run.completionTokens !== undefined
            ? `Tokens: ${run.promptTokens ?? 0} in / ${run.completionTokens ?? 0} out\n` : '';
          const parentLine = run.parentRunId ? `Parent run: ${run.parentRunId}\n` : '';
          const output = [
            `Run: ${run.id}`,
            `Agent: ${run.agentId}`,
            `Status: ${run.status}`,
            `Model: ${run.modelUsed ?? '(unknown)'}`,
            tokenLine.trimEnd(),
            parentLine.trimEnd(),
            `\n--- Output ---\n${run.output ?? '(no output)'}`,
          ].filter(Boolean).join('\n');
          return slashReply({ output, command: 'subagents:log', runId: subArg, run });
        }

        return slashReply({
          output: 'Usage: /subagents [list | kill <runId> | log <runId>]',
          command: 'subagents:help',
        });
      }

      if (cmd === '/devices') {
        if (!deviceStore) {
          return slashReply({ output: 'Device store unavailable.', command: 'devices:error' });
        }
        const [sub, ...subArgs] = args;
        const subArg = subArgs.join(' ').trim();

        if (!sub || sub === 'list') {
          const all = deviceStore.listAll();
          if (all.length === 0) {
            return slashReply({ output: 'No devices registered.', command: 'devices:list', devices: [] });
          }
          const lines = all.map(d => {
            const label = d.label ? ` (${d.label})` : '';
            const caps = d.caps && d.caps.length > 0 ? ` caps=[${d.caps.join(', ')}]` : '';
            return `• ${d.deviceId}${label} — ${d.status} | role:${d.role} | ${d.platform}/${d.deviceFamily}${caps}`;
          });
          return slashReply({ output: lines.join('\n'), command: 'devices:list', devices: all.map(d => { const { deviceToken: _, ...safe } = d; return safe; }) });
        }

        if (sub === 'pending') {
          const pending = deviceStore.listPending();
          if (pending.length === 0) {
            return slashReply({ output: 'No pending devices.', command: 'devices:pending', devices: [] });
          }
          const lines = pending.map(d => `• ${d.deviceId} — requested ${new Date(d.requestedAt).toISOString()} | ${d.platform}/${d.deviceFamily}`);
          return slashReply({ output: lines.join('\n'), command: 'devices:pending', devices: pending.map(d => { const { deviceToken: _, ...safe } = d; return safe; }) });
        }

        if (sub === 'approve') {
          if (!subArg) return slashReply({ output: 'Usage: /devices approve <deviceId>', command: 'devices:approve' });
          try {
            const updated = deviceStore.approve(subArg);
            return slashReply({ output: `Device "${subArg}" approved.`, command: 'devices:approve', deviceId: updated.deviceId, status: updated.status });
          } catch (err) {
            return slashReply({ output: `Failed to approve device: ${err instanceof Error ? err.message : String(err)}`, command: 'devices:approve' });
          }
        }

        if (sub === 'deny') {
          if (!subArg) return slashReply({ output: 'Usage: /devices deny <deviceId>', command: 'devices:deny' });
          try {
            deviceStore.deny(subArg);
            return slashReply({ output: `Device "${subArg}" denied.`, command: 'devices:deny', deviceId: subArg });
          } catch (err) {
            return slashReply({ output: `Failed to deny device: ${err instanceof Error ? err.message : String(err)}`, command: 'devices:deny' });
          }
        }

        return slashReply({
          output: 'Usage: /devices [list | pending | approve <deviceId> | deny <deviceId>]',
          command: 'devices:help',
        });
      }

      if (cmd === '/think' || cmd === '/thinking' || cmd === '/t') {
        // /think <level>  — set thinking level for the session
        // Levels: off | minimal | low | medium | high | xhigh | adaptive
        const VALID_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'];
        if (!arg) {
          const current = conversationId ? sessionDirectives?.get(conversationId)?.thinkingLevel : undefined;
          return slashReply({
            output: `Thinking level: ${current ?? 'not set (default off)'}\nUsage: /think <level>\nLevels: ${VALID_LEVELS.join(' | ')}`,
            command: 'think:help',
            validLevels: VALID_LEVELS,
            current: current ?? null,
          });
        }
        const level = arg.toLowerCase();
        if (!VALID_LEVELS.includes(level)) {
          return slashReply({
            output: `Unknown thinking level "${arg}". Valid levels: ${VALID_LEVELS.join(', ')}`,
            command: 'think:invalid',
          });
        }
        const budgetMap: Record<string, number | undefined> = {
          off: undefined, minimal: 1024, low: 2000, medium: 5000,
          high: 10000, xhigh: 20000, adaptive: 8000,
        };
        const budget = budgetMap[level];
        // Persist to session
        if (conversationId && sessionDirectives) {
          sessionDirectives.set(conversationId, { thinkingLevel: level === 'off' ? undefined : level as import('@krythor/models').ThinkingLevel });
        }
        return slashReply({
          output: level === 'off'
            ? 'Extended thinking disabled for this session.'
            : `Thinking level set to "${level}" (${budget?.toLocaleString()} token budget). Active for this session.`,
          command: 'think:set',
          thinkingLevel: level,
          thinkingBudget: budget,
          persisted: !!conversationId,
        });
      }

      if (cmd === '/fast') {
        // /fast [on|off]  — toggle fast model routing preference
        const state = arg?.toLowerCase();
        const fastOn = !state || state === 'on';
        const fastOff = state === 'off';
        if (!fastOff && !fastOn) {
          return slashReply({ output: 'Usage: /fast [on|off]', command: 'fast:help' });
        }
        if (conversationId && sessionDirectives) {
          sessionDirectives.set(conversationId, { fastMode: fastOn });
        }
        return slashReply({
          output: fastOn
            ? 'Fast mode on: model routing will prefer lower-latency options for this session.'
            : 'Fast mode off: standard model routing restored.',
          command: fastOn ? 'fast:on' : 'fast:off',
          fastMode: fastOn,
          persisted: !!conversationId,
        });
      }

      if (cmd === '/verbose' || cmd === '/v') {
        // /verbose [on|full|off]  — control tool-call forwarding verbosity
        const VALID = ['on', 'full', 'off'];
        const state = arg?.toLowerCase();
        if (!state) {
          const current = conversationId ? sessionDirectives?.get(conversationId)?.verbose : undefined;
          return slashReply({
            output: `Verbose level: ${current ?? 'off (default)'}\nUsage: /verbose [on|full|off]\n  on   — tool calls forwarded as messages\n  full — tool calls + outputs forwarded\n  off  — silent (default)`,
            command: 'verbose:status',
            current: current ?? 'off',
          });
        }
        if (!VALID.includes(state)) {
          return slashReply({ output: `Valid levels: ${VALID.join(', ')}`, command: 'verbose:invalid' });
        }
        if (conversationId && sessionDirectives) {
          sessionDirectives.set(conversationId, { verbose: state as import('../SessionDirectiveStore.js').VerboseLevel });
        }
        return slashReply({
          output: `Verbose mode set to "${state}".`,
          command: `verbose:${state}`,
          verboseLevel: state,
          persisted: !!conversationId,
        });
      }

      if (cmd === '/reasoning') {
        // /reasoning [on|off|stream]  — control reasoning/thinking block visibility in chat
        const VALID = ['on', 'off', 'stream'];
        const state = arg?.toLowerCase();
        if (!state) {
          const current = conversationId ? sessionDirectives?.get(conversationId)?.reasoning : undefined;
          return slashReply({
            output: `Reasoning visibility: ${current ?? 'off (default)'}\nUsage: /reasoning [on|off|stream]\n  on     — thinking blocks forwarded as separate messages\n  stream — stream thinking into a draft before reply (where supported)\n  off    — hide thinking blocks (default)`,
            command: 'reasoning:status',
            current: current ?? 'off',
          });
        }
        if (!VALID.includes(state)) {
          return slashReply({ output: `Valid modes: ${VALID.join(', ')}`, command: 'reasoning:invalid' });
        }
        if (conversationId && sessionDirectives) {
          sessionDirectives.set(conversationId, { reasoning: state as import('../SessionDirectiveStore.js').ReasoningVisibility });
        }
        return slashReply({
          output: `Reasoning visibility set to "${state}".`,
          command: `reasoning:${state}`,
          reasoning: state,
          persisted: !!conversationId,
        });
      }

      if (cmd === '/help' || cmd === '/commands') {
        const helpText = [
          'Available commands:',
          '  /new                      — start a new conversation',
          '  /compact                  — trim old messages from context',
          '  /clear                    — clear displayed chat history',
          '  /model [id]               — list models or switch active model',
          '  /agent [id]               — show active agent or switch agent',
          '  /think <level>            — set thinking depth (off|minimal|low|medium|high|xhigh|adaptive)',
          '  /fast [on|off]            — toggle fast model routing',
          '  /verbose [on|full|off]    — control tool-call forwarding in chat',
          '  /reasoning [on|off|stream] — control reasoning block visibility',
          '  /subagents [list|kill|log] — manage agent runs',
          '  /devices [list|pending|approve|deny] — manage paired devices',
          '  /help                     — show this list',
        ].join('\n');
        return slashReply({ output: helpText, command: 'help' });
      }

      // Unknown slash command — fall through to inference so plugins/agents can handle it
    }

    // Guard check — evaluate before executing anything
    if (guard) {
      const verdict = guard.check({
        operation: 'command:execute',
        source: 'user',
        content: input,
        ...(agentId && { sourceId: agentId }),
      });

      // Route require-approval verdicts through the approval manager.
      // For streaming requests, open the SSE stream first so we can emit an
      // 'approval_required' event that the UI can render as an inline prompt.
      let guardAllowed = verdict.allowed;
      if (!verdict.allowed && verdict.action === 'require-approval' && approvalManager) {
        if (stream) {
          // Open the SSE channel immediately so the UI can react
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          // Build the approval request (get the id before awaiting)
          const approvalPayload = {
            agentId,
            actionType: 'command:execute',
            target: input,
            reason: verdict.reason ?? 'Policy requires approval for this action.',
            riskSummary: `command:execute on: ${input.slice(0, 120)}`,
            context: { verdict: verdict as unknown as Record<string, unknown> },
          };

          // Kick off the approval (this creates the PendingApproval synchronously inside,
          // but resolves asynchronously when the user responds).
          const approvalPromise = approvalManager.requestApproval(approvalPayload, 30_000).catch(() => 'deny' as const);

          // Retrieve the id of the just-created pending approval so the UI can respond to it
          const pendingList = approvalManager.getPending();
          const pendingEntry = pendingList[pendingList.length - 1];

          // Emit the approval_required SSE event so the chat UI can render inline Allow/Deny
          reply.raw.write(`data: ${JSON.stringify({
            type: 'approval_required',
            requestId: pendingEntry?.id ?? '',
            operation: 'command:execute',
            riskSummary: approvalPayload.riskSummary,
            reason: approvalPayload.reason,
            timeoutMs: 30_000,
          })}\n\n`);

          const response = await approvalPromise;
          guardAllowed = response !== 'deny';

          if (!guardAllowed) {
            const denyReason = verdict.reason ?? 'Guard denied operation';
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Command denied by security policy: ${denyReason}` })}\n\n`);
            reply.raw.end();
            return reply;
          }
          // Approved — signal continuation to the client then fall through to execute
          reply.raw.write(`data: ${JSON.stringify({ type: 'approval_granted' })}\n\n`);
          // Stream is already open; skip the second writeHead below by marking it open
          (req as unknown as Record<string, unknown>)['_sseAlreadyOpen'] = true;
        } else {
          // Non-streaming approval path (original behavior)
          const response = await approvalManager.requestApproval({
            agentId,
            actionType: 'command:execute',
            target: input,
            reason: verdict.reason ?? 'Policy requires approval for this action.',
            riskSummary: `command:execute on: ${input.slice(0, 120)}`,
            context: { verdict: verdict as unknown as Record<string, unknown> },
          }, 30_000).catch(() => 'deny' as const);
          guardAllowed = response !== 'deny';
        }
      }

      if (!guardAllowed) {
        const denyReason = verdict.reason ?? 'Guard denied operation';
        if (stream) {
          if (!(req as unknown as Record<string, unknown>)['_sseAlreadyOpen']) {
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
          }
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Command denied by security policy: ${denyReason}` })}\n\n`);
          reply.raw.end();
          return reply;
        }
        return reply.code(403).send({
          input,
          output: `Command denied by security policy: ${denyReason}`,
          timestamp: new Date().toISOString(),
          processingTimeMs: 0,
          error: { code: verdict.action === 'require-approval' ? 'APPROVAL_DENIED' : 'GUARD_DENIED', message: denyReason, hint: 'Adjust your Guard policy in the Guard tab if this is unexpected.' },
          guardVerdict: verdict,
        });
      }
    }

    // Resolve model routing aliases (claude, gpt4, local, fast, best)
    // before passing modelId downstream.  Unknown names pass through unchanged.
    let resolvedModelId = modelId;
    let resolvedProviderId: string | undefined;
    if (models && modelId) {
      const aliasResult = models.resolveModelAlias(modelId);
      if (aliasResult) {
        resolvedModelId = aliasResult.modelId;
        resolvedProviderId = aliasResult.providerId;
      }
    }

    if (!models || models.stats().providerCount === 0) {
      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'No AI provider is configured. Open the Models tab to add one, then try again.' })}\n\n`);
        reply.raw.end();
        return reply;
      }
      return reply.send({
        input,
        output: 'No AI provider is configured. Open the Models tab to add one, then try again.',
        timestamp: new Date().toISOString(),
        processingTimeMs: 0,
        noProvider: true,
      });
    }

    // Load conversation history for context
    let contextMessages: Array<{ role: string; content: string }> = [];
    if (conversationId && convStore) {
      const existing = convStore.getConversation(conversationId);
      if (existing) {
        const msgs = convStore.getMessages(conversationId);
        contextMessages = msgs.map(m => ({ role: m.role, content: m.content }));
      }
    }

    // Helper: auto-generate title from first message
    const autoTitle = input.slice(0, 40) + (input.length > 40 ? '…' : '');

    try {
      if (agentId) {
        const agent = orchestrator.getAgent(agentId);
        if (!agent) {
          if (stream) {
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'The selected agent could not be found. Go to the Agents tab to select or create one.' })}\n\n`);
            reply.raw.end();
            return reply;
          }
          return reply.send({
            input,
            output: 'The selected agent could not be found. Go to the Agents tab to select or create one.',
            timestamp: new Date().toISOString(),
            processingTimeMs: 0,
          });
        }

        if (stream) {
          // Real SSE streaming — subscribe to orchestrator events for this run
          // (Headers may already be written if we went through the approval_required flow)
          if (!(req as unknown as Record<string, unknown>)['_sseAlreadyOpen']) {
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
          }

          let streamEnded = false;
          const sendEvent = (obj: object): void => {
            if (!streamEnded) reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
          };
          const endStream = (): void => {
            if (streamEnded) return;
            streamEnded = true;
            orchestrator.removeListener('agent:event', onChunk);
            reply.raw.end();
          };

          // Generate a runId upfront so we can correlate events.
          // Prefix with the Fastify request ID for end-to-end log correlation.
          const runId = `run-${req.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          registerRunRequestId(app, runId, String(req.id));

          // Save user message to conversation before run
          let activeConvId = conversationId;
          if (convStore) {
            if (!activeConvId) {
              const conv = convStore.createConversation(agentId);
              activeConvId = conv.id;
              sendEvent({ type: 'conversation', conversationId: conv.id, title: autoTitle });
              convStore.updateConversationTitle(conv.id, autoTitle);
            } else if (contextMessages.length === 0) {
              convStore.updateConversationTitle(activeConvId, autoTitle);
            }
            convStore.addMessage(activeConvId, 'user', input);
          }

          const convIdForRun = activeConvId;

          // Listen for stream events from this specific run
          const onChunk = (event: AgentEvent): void => {
            if (event.runId !== runId) return;

            if (event.type === 'run:stream:chunk') {
              const p = event.payload as { delta?: string; done?: boolean } | undefined;
              sendEvent({ type: 'delta', content: p?.delta ?? '', runId });
            } else if (event.type === 'run:completed') {
              const p = event.payload as { output?: string; modelUsed?: string; selectionReason?: string; fallbackOccurred?: boolean } | undefined;
              const output = p?.output ?? '';

              // Save assistant message to conversation
              if (convStore && convIdForRun) {
                convStore.addMessage(convIdForRun, 'assistant', output, p?.modelUsed);
              }

              sendEvent({ type: 'done', output, runId, requestId: req.id, conversationId: convIdForRun, modelUsed: p?.modelUsed, selectionReason: p?.selectionReason ?? null, fallbackOccurred: p?.fallbackOccurred ?? false });
              endStream();
            } else if (event.type === 'run:failed') {
              const p = event.payload as { error?: string } | undefined;
              sendEvent({ type: 'error', message: p?.error ?? 'Run failed' });
              endStream();
            } else if (event.type === 'run:stopped') {
              sendEvent({ type: 'done', output: '', runId, conversationId: convIdForRun });
              endStream();
            }
          };

          orchestrator.on('agent:event', onChunk);
          // Clean up listener if client disconnects before the run finishes
          reply.raw.on('close', endStream);

          // Start the run — don't await, events drive the response
          const runInput = { input, ...(resolvedModelId && { modelOverride: resolvedModelId }), ...(resolvedProviderId && { providerOverride: resolvedProviderId }), requestId: String(req.id) };
          orchestrator.runAgentStream(agentId, runInput, { contextMessages, runId }).catch(err => {
            const structured = classifyError(err);
            sendEvent({ type: 'error', message: structured.hint || structured.message });
            endStream();
          });

          return reply;
        }

        // Non-streaming (default)
        const startTime = Date.now();
        // Pre-generate runId so the requestId can be registered before the run emits events
        const { randomUUID: genNonStreamId } = await import('crypto');
        const nonStreamRunId = genNonStreamId();
        registerRunRequestId(app, nonStreamRunId, String(req.id));
        const nonStreamRunInput = { input, ...(resolvedModelId && { modelOverride: resolvedModelId }), ...(resolvedProviderId && { providerOverride: resolvedProviderId }), requestId: String(req.id), runId: nonStreamRunId };
        const run = await orchestrator.runAgent(agentId, nonStreamRunInput, { contextMessages });
        const output = run.output ?? '(no response)';

        // Save messages to conversation
        let activeConvId = conversationId;
        if (convStore) {
          if (!activeConvId) {
            const conv = convStore.createConversation(agentId);
            activeConvId = conv.id;
            convStore.updateConversationTitle(conv.id, autoTitle);
          } else if (contextMessages.length === 0) {
            convStore.updateConversationTitle(activeConvId, autoTitle);
          }
          convStore.addMessage(activeConvId, 'user', input);
          convStore.addMessage(activeConvId, 'assistant', output, run.modelUsed);
        }

        return reply.send({
          input,
          output,
          timestamp: new Date().toISOString(),
          processingTimeMs: run.completedAt ? run.completedAt - run.startedAt : Date.now() - startTime,
          modelUsed: run.modelUsed,
          agentId: run.agentId,
          runId: run.id,
          requestId: req.id,
          conversationId: activeConvId,
          status: run.status,
          selectionReason: run.selectionReason ?? null,
          fallbackOccurred: run.fallbackOccurred ?? false,
          error: run.status === 'failed'
            ? { code: 'RUN_FAILED', message: run.errorMessage ?? 'Run failed', hint: 'Check the Models tab and verify your provider is reachable.' }
            : undefined,
        });
      }

      // No agent — direct command via KrythorCore
      if (stream) {
        if (!(req as unknown as Record<string, unknown>)['_sseAlreadyOpen']) {
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
        }

        const startTime = Date.now();

        // Save user message
        let activeConvId = conversationId;
        if (convStore) {
          if (!activeConvId) {
            const conv = convStore.createConversation();
            activeConvId = conv.id;
            reply.raw.write(`data: ${JSON.stringify({ type: 'conversation', conversationId: conv.id, title: autoTitle })}\n\n`);
            convStore.updateConversationTitle(conv.id, autoTitle);
          }
          convStore.addMessage(activeConvId, 'user', input);
        }

        try {
          // Privacy routing: classify prompt and potentially re-route to local provider
          if (privacyRouter) {
            const privacyResult = await privacyRouter.infer(
              { messages: [{ role: 'user', content: input }], ...(resolvedModelId && { model: resolvedModelId }), ...(responseFormat && { responseFormat }) },
            );
            const output = privacyResult.content;
            const duration = Date.now() - startTime;
            if (convStore && activeConvId) {
              convStore.addMessage(activeConvId, 'assistant', output);
            }
            reply.raw.write(`data: ${JSON.stringify({ type: 'done', duration, output, conversationId: activeConvId, privacyDecision: privacyResult.privacyDecision })}\n\n`);
          } else {
            const result = await core.handleCommand(input, resolvedModelId ? { agentModelId: resolvedModelId, ...(resolvedProviderId && { providerId: resolvedProviderId }) } : undefined);
            const output = (result as { output?: string }).output ?? String(result);
            const duration = Date.now() - startTime;

            if (convStore && activeConvId) {
              convStore.addMessage(activeConvId, 'assistant', output);
            }

            reply.raw.write(`data: ${JSON.stringify({ type: 'done', duration, output, conversationId: activeConvId })}\n\n`);
          }
        } catch (err) {
          const structured = classifyError(err);
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: structured.hint || structured.message })}\n\n`);
        }

        reply.raw.end();
        return reply;
      }

      const startTime = Date.now();
      const result = await core.handleCommand(input, modelId ? { agentModelId: modelId } : undefined);

      // Save to conversation
      let activeConvId = conversationId;
      if (convStore) {
        const output = (result as { output?: string }).output ?? String(result);
        if (!activeConvId) {
          const conv = convStore.createConversation();
          activeConvId = conv.id;
          convStore.updateConversationTitle(conv.id, autoTitle);
        }
        convStore.addMessage(activeConvId, 'user', input);
        convStore.addMessage(activeConvId, 'assistant', output);
      }

      return reply.send({ ...result as object, conversationId: activeConvId });
    } catch (err) {
      const structured = classifyError(err);
      if (stream) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: structured.hint || structured.message })}\n\n`);
        reply.raw.end();
        return reply;
      }
      return reply.send({
        input,
        output: `${structured.code}: ${structured.hint}`,
        timestamp: new Date().toISOString(),
        processingTimeMs: 0,
        error: structured,
      });
    }
  });
}
